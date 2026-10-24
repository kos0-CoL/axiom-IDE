// Módulo telegram — bot: enruta updates (webhook y polling) al broker vía adapter.
// Decide siempre el broker (first-response-wins, single-use, expiración). Fail closed.
import { allowedChat } from "./auth.js";
import { loadConfig } from "./config.js";
import { bloqueosText, consumoText, notifyApproval, statusText, handleCallback } from "./adapter.js";
import {
  answerCallback,
  fetchUpdates,
  InlineKeyboard,
  inlineKeyboardFor,
  parseCallbackData,
  ParsedUpdate,
  sendMessage,
  tokenFromEnv,
} from "./transport.js";

export interface Handled {
  chatId: string;
  text: string;
  replyMarkup?: InlineKeyboard;
  callbackId?: string;
  callbackAnswer?: string;
}

// Comandos de texto: /start /status /bloqueos /consumo, "approve <id>", "reject <id>".
export function routeText(root: string, chatId: string, raw: string): { text: string; replyMarkup?: InlineKeyboard } {
  const cfg = loadConfig(root);
  if (!cfg.ok) return { text: `config inválida (fail closed): ${cfg.error}` };
  if (!allowedChat(root, chatId)) return { text: `origen no autorizado (fail closed)` };
  const text = raw.trim();
  const cmd = text.split(/\s+/)[0]?.toLowerCase() ?? "";
  const arg = text.split(/\s+/)[1] ?? "";
  if (cmd === "/start" || cmd === "/help" || cmd === "ayuda") {
    return {
      text: [
        `AXIOM — aprobaciones por Telegram (canal, no permiso)`,
        `Comandos: /status /bloqueos /consumo`,
        `Aprobar desde el aviso con los botones, o: approve <id> / reject <id>`,
        `Sin respuesta no hay aprobación. Primera respuesta gana.`,
      ].join("\n"),
    };
  }
  if (cmd === "/status" || cmd === "status") return { text: statusText(root) };
  if (cmd === "/bloqueos" || cmd === "bloqueos") return { text: bloqueosText(root) };
  if (cmd === "/consumo" || cmd === "consumo") return { text: consumoText(root) };
  if ((cmd === "approve" || cmd === "/approve" || cmd === "apruebo") && arg) {
    const m = handleCallback(root, arg, "approve", chatId);
    return { text: m };
  }
  if ((cmd === "reject" || cmd === "/reject" || cmd === "rechazo") && arg) {
    const m = handleCallback(root, arg, "reject", chatId);
    return { text: m };
  }
  if (cmd === "/notify" && arg) {
    // Genera el aviso con botones para una tool (útil sin webhook entrante).
    const t = notifyApproval(root, arg);
    const id = /ID (\S+)/.exec(t)?.[1];
    if (id && !t.startsWith("check ")) return { text: t, replyMarkup: inlineKeyboardFor(id) };
    return { text: t };
  }
  return {
    text: `comando no reconocido. Usa /status /bloqueos /consumo o approve <id> / reject <id>`,
  };
}

export function handleUpdate(root: string, u: ParsedUpdate): Handled | null {
  if (u.kind === "unknown") return null;
  const cfg0 = loadConfig(root);
  if (cfg0.ok && cfg0.config.enabled === false) {
    const chat = u.kind === "message" ? u.chatId : u.chatId;
    const cb = u.kind === "callback" ? u.callbackId : undefined;
    return { chatId: chat, text: "telegram desactivado (usa el toggle)", callbackId: cb, callbackAnswer: "desactivado" };
  }
  if (u.kind === "message") {
    const r = routeText(root, u.chatId, u.text);
    return { chatId: u.chatId, text: r.text, replyMarkup: r.replyMarkup };
  }
  // callback de botón inline
  const cfg = loadConfig(root);
  if (!cfg.ok) {
    return { chatId: u.chatId, text: `config inválida (fail closed): ${cfg.error}`, callbackId: u.callbackId, callbackAnswer: "error de configuración" };
  }
  if (!allowedChat(root, u.chatId)) {
    return { chatId: u.chatId, text: `origen no autorizado (fail closed)`, callbackId: u.callbackId, callbackAnswer: "no autorizado" };
  }
  const p = parseCallbackData(u.data);
  if (!p) {
    return { chatId: u.chatId, text: `callback no reconocido`, callbackId: u.callbackId, callbackAnswer: "no reconocido" };
  }
  const m = handleCallback(root, p.id, p.action, u.chatId);
  return { chatId: u.chatId, text: m, callbackId: u.callbackId, callbackAnswer: m.slice(0, 190) };
}

// Envía lo enrutado por Bot API (webhook y polling comparten esto).
export async function deliver(root: string, h: Handled, token?: string): Promise<string> {
  const t = token ?? tokenFromEnv();
  if (!t) return `sin token (fail closed): define AXIOM_TELEGRAM_BOT_TOKEN — estado ya decidido: ${h.text}`;
  const s = await sendMessage(t, h.chatId, h.text, h.replyMarkup);
  let extra = s.ok ? `enviado a ${h.chatId}` : `Bot API error: ${s.description ?? "desconocido"}`;
  if (h.callbackId) {
    const a = await answerCallback(t, h.callbackId, h.callbackAnswer);
    if (!a.ok) extra += ` (answerCallback: ${a.description ?? "error"})`;
  }
  void root;
  return extra;
}

// Notifica una aprobación a un chat con botones inline. Sin token: dry-run (texto).
export async function notifyChat(
  root: string,
  tool: string,
  chatId: string,
  token?: string,
  sender: typeof sendMessage = sendMessage,
): Promise<string> {
  const cfg = loadConfig(root);
  if (!cfg.ok) return `config inválida (fail closed): ${cfg.error}`;
  if (!allowedChat(root, chatId)) return `origen no autorizado (fail closed)`;
  const t = notifyApproval(root, tool);
  if (t.startsWith("check ")) return t;
  const id = /ID (\S+)/.exec(t)?.[1] ?? "";
  // Texto del aviso + botones inline con el mismo id (primera respuesta gana en broker).
  const text = t;
  const markup = inlineKeyboardFor(id);
  const tok = token ?? tokenFromEnv();
  if (!tok) return `${text}\n[botones: Aprobar/Rechazar ${id}] (sin token: dry-run)`;
  const s = await sender(tok, chatId, text, markup);
  return s.ok ? `aviso ${id} enviado a ${chatId} con botones` : `Bot API error: ${s.description ?? "desconocido"}`;
}

// Bucle de polling (getUpdates long-poll). --once hace una sola tanda (tests/CI).
export async function runPolling(root: string, opts: { once?: boolean; token?: string } = {}): Promise<string> {
  const token = opts.token ?? tokenFromEnv();
  if (!token) {
    console.error(`sin token (fail closed): define AXIOM_TELEGRAM_BOT_TOKEN`);
    process.exit(1);
  }
  let offset: number | undefined;
  let total = 0;
  for (;;) {
    const r = await fetchUpdates(token as string, offset, opts.once ? 0 : 25);
    if (!r.ok) {
      console.error(`poll error: ${r.description ?? "desconocido"}`);
      if (opts.once) process.exit(1);
      await new Promise((res) => setTimeout(res, 5000));
      continue;
    }
    for (const u of r.updates ?? []) {
      offset = (u.update_id ?? 0) + 1;
      const { parseUpdate } = await import("./transport.js");
      const h = handleUpdate(root, parseUpdate(u));
      if (h) {
        console.log(await deliver(root, h, token as string));
        total++;
      }
    }
    if (opts.once) return `poll once: ${total} updates procesados`;
    if ((r.updates ?? []).length === 0) continue;
  }
}
