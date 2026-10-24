// Módulo telegram — transporte: formato + Bot API HTTP. Sin broker, sin SQLite.
// El token NUNCA va en repo/args/logs: solo env AXIOM_TELEGRAM_BOT_TOKEN.
export interface ApprovalMsg { id: string; tool: string; riesgo: string; motivo: string; expiraMin: number }

export function formatApproval(m: ApprovalMsg): string {
  return [
    `🚨 [${m.riesgo.toUpperCase()}] ${m.tool} requiere aprobación`,
    `ID ${m.id} — ${m.motivo}`,
    `Aprobar: axiom approve ${m.id} | telegram approve ${m.id}`,
    `Rechazar: axiom reject ${m.id} | telegram reject ${m.id}`,
    `(expira ${m.expiraMin}min; primera respuesta gana; Telegram es canal)`,
  ].join("\n");
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

// callback_data ≤64 bytes (límite Bot API): "approve:<id>" / "reject:<id>".
export function inlineKeyboardFor(id: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Aprobar", callback_data: `approve:${id}` },
        { text: "❌ Rechazar", callback_data: `reject:${id}` },
      ],
    ],
  };
}

export function formatDecision(id: string, ok: boolean, detail: string): string {
  return `${id} ${ok ? "aprobada" : "rechazada"} — ${detail}`;
}

export function approvalPayload(m: ApprovalMsg): { text: string; reply_markup: InlineKeyboard } {
  return { text: formatApproval(m), reply_markup: inlineKeyboardFor(m.id) };
}

export function parseCallbackData(data?: string): { action: "approve" | "reject"; id: string } | null {
  if (!data) return null;
  const m = /^(approve|reject):([A-Za-z0-9_-]{1,64})$/.exec(data.trim());
  if (!m) return null;
  return { action: m[1] as "approve" | "reject", id: m[2] };
}

// --- Updates entrantes (webhook o polling) ---
export type ParsedUpdate =
  | { kind: "message"; chatId: string; text: string; messageId?: number }
  | { kind: "callback"; chatId: string; data: string; callbackId: string; messageId?: number }
  | { kind: "unknown" };

export function parseUpdate(body: unknown): ParsedUpdate {
  if (!body || typeof body !== "object") return { kind: "unknown" };
  const u = body as Record<string, unknown>;
  const cb = u.callback_query as Record<string, unknown> | undefined;
  if (cb && typeof cb === "object") {
    const msg = cb.message as Record<string, unknown> | undefined;
    const chat = msg?.chat as Record<string, unknown> | undefined;
    const chatId = chat?.id !== undefined ? String(chat.id) : undefined;
    const data = typeof cb.data === "string" ? cb.data : undefined;
    const callbackId = typeof cb.id === "string" ? cb.id : undefined;
    if (chatId && data && callbackId) {
      const mid = typeof msg?.message_id === "number" ? (msg.message_id as number) : undefined;
      return { kind: "callback", chatId, data, callbackId, messageId: mid };
    }
    return { kind: "unknown" };
  }
  const msg = u.message as Record<string, unknown> | undefined;
  if (msg && typeof msg === "object") {
    const chat = msg.chat as Record<string, unknown> | undefined;
    const chatId = chat?.id !== undefined ? String(chat.id) : undefined;
    const text = typeof msg.text === "string" ? msg.text : "";
    if (chatId) {
      const mid = typeof msg.message_id === "number" ? (msg.message_id as number) : undefined;
      return { kind: "message", chatId, text, messageId: mid };
    }
  }
  return { kind: "unknown" };
}

// --- Bot API (fetch nativo, sin deps) ---
export function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const t = (env.AXIOM_TELEGRAM_BOT_TOKEN ?? "").trim();
  return t ? t : undefined;
}

export function webhookSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const s = (env.AXIOM_TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  return s ? s : undefined;
}

interface ApiResult {
  ok: boolean;
  description?: string;
}

async function apiCall(token: string, method: string, payload: Record<string, unknown>): Promise<ApiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    let j: { ok?: boolean; description?: string } = {};
    try {
      j = (await r.json()) as typeof j;
    } catch {
      return { ok: false, description: `HTTP ${r.status} sin JSON` };
    }
    // Nunca se registra ni devuelve el token.
    if (!r.ok || j.ok !== true) return { ok: false, description: j.description ?? `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<ApiResult> {
  return apiCall(token, "sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

export async function answerCallback(token: string, callbackId: string, text?: string): Promise<ApiResult> {
  return apiCall(token, "answerCallbackQuery", { callback_query_id: callbackId, text: text?.slice(0, 200) });
}

export async function setWebhook(token: string, url: string, secret?: string): Promise<ApiResult> {
  const payload: Record<string, unknown> = { url, drop_pending_updates: false };
  if (secret) payload.secret_token = secret;
  return apiCall(token, "setWebhook", payload);
}

export interface TgUpdate {
  update_id: number;
  [k: string]: unknown;
}

export async function fetchUpdates(
  token: string,
  offset?: number,
  timeout = 25,
): Promise<{ ok: boolean; updates?: TgUpdate[]; description?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (timeout + 10) * 1000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offset, timeout, allowed_updates: ["message", "callback_query"] }),
      signal: ctrl.signal,
    });
    const j = (await r.json()) as { ok?: boolean; result?: TgUpdate[]; description?: string };
    if (!r.ok || j.ok !== true) return { ok: false, description: j.description ?? `HTTP ${r.status}` };
    return { ok: true, updates: j.result ?? [] };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export function statusText(root: string, expiraMin = 30): string {
  return `AXIOM status\nroot=${root}\ncomandos: /status /bloqueos /consumo\naprobaciones: axiom approve|reject <id> (expira ${expiraMin}min)`;
}

export function formatBloqueos(list: { id: string; task_id: string; causa: string }[]): string {
  if (list.length === 0) return `bloqueos: 0 — sin tareas bloqueadas`;
  const lines = list.map((b) => `/// ${b.task_id} — ${b.causa}`);
  return `bloqueos: ${list.length}\n${lines.join("\n")}`;
}

export function formatConsumo(c: { tokens: number; calls: number }, techo: { tokens: number; calls: number }): string {
  const resT = techo.tokens - c.tokens;
  const pct = techo.tokens > 0 ? Math.round((c.tokens / techo.tokens) * 100) : 0;
  return `consumo global: tokens=${c.tokens}/${techo.tokens} (${pct}%) calls=${c.calls}/${techo.calls} reserva=${resT} (bloquea nueva unidad si <20%)`;
}
