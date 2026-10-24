// Módulo telegram — adaptador: correlaciona callback → broker.decide.
// Single-use, idempotente, primera respuesta gana (lo garantiza broker por estado).
import { check, decide } from "../../broker.js";
import { formatApproval, formatBloqueos, formatConsumo, formatDecision, statusText as statusBase } from "./transport.js";
import { allowedChat } from "./auth.js";
import { loadConfig, saveConfig } from "./config.js";
import { getConsumo, listBloqueos, listUsos } from "../../store.js";
import { loadPolicies } from "../../policy.js";

export function expiracion(root: string): number {
  const c = loadConfig(root);
  return c.ok ? c.config.expiracionMin : 30;
}

export function notifyApproval(root: string, tool: string): string {
  const r = check(root, tool);
  if (r.decision !== "ask" || !r.id) return `check ${tool}: ${r.decision} — ${r.motivo}`;
  return formatApproval({ id: r.id, tool, riesgo: r.riesgo, motivo: r.motivo, expiraMin: expiracion(root) });
}

export function handleCallback(root: string, id: string, action: "approve" | "reject", chatId?: string): string {
  const cfg = loadConfig(root);
  if (!cfg.ok) return `config inválida (fail closed): ${cfg.error}`;
  if (!allowedChat(root, chatId)) return `origen no autorizado (fail closed)`;
  const r = decide(root, id, action === "approve", chatId ?? "cli", cfg.config.expiracionMin);
  return formatDecision(id, r.ok, r.msg);
}

export function statusText(root: string): string {
  return statusBase(root, expiracion(root));
}

// Gestión de la config propia desde el CLI (no se edita a mano).
export function allowChatId(root: string, chatId?: string): string {
  const id = (chatId ?? "").trim();
  if (!id) return "uso: axiom telegram allow <chat-id>";
  if (/\s/.test(id) || id.length > 64) return `chat-id inválido: ${id} (1-64 caracteres, sin espacios)`;
  const cfg = loadConfig(root);
  if (!cfg.ok) return `config inválida (fail closed): ${cfg.error}`;
  if (cfg.config.allowlist.includes(id)) return `${id} ya estaba en allowlist`;
  saveConfig(root, { enabled: cfg.config.enabled, allowlist: [...cfg.config.allowlist, id], expiracionMin: cfg.config.expiracionMin });
  return `${id} autorizado${cfg.migrated ? " (config creada; se adoptó telegram.allowlist.json legado)" : ""} — remoto habilitado solo para este chat`;
}

export function unallowChatId(root: string, chatId?: string): string {
  const id = (chatId ?? "").trim();
  if (!id) return "uso: axiom telegram unallow <chat-id>";
  const cfg = loadConfig(root);
  if (!cfg.ok) return `config inválida (fail closed): ${cfg.error}`;
  if (!cfg.config.allowlist.includes(id)) return `${id} no estaba en allowlist`;
  saveConfig(root, { enabled: cfg.config.enabled, allowlist: cfg.config.allowlist.filter((x) => x !== id), expiracionMin: cfg.config.expiracionMin });
  return `${id} eliminado de allowlist (remoto denegado desde ahora)`;
}

export function setExpiracion(root: string, min?: string): string {
  if (min === undefined) return "uso: axiom telegram expira <minutos>";
  const n = parseInt(min, 10);
  if (!Number.isInteger(n) || n < 1 || n > 1440) return `minutos inválidos: ${min} (entero 1-1440)`;
  const cfg = loadConfig(root);
  if (!cfg.ok) return `config inválida (fail closed): ${cfg.error}`;
  saveConfig(root, { enabled: cfg.config.enabled, allowlist: cfg.config.allowlist, expiracionMin: n });
  return `expiración: ${n}min — el canal telegram la aplica al decidir; el resto usa 30min por defecto`;
}

export function setEnabled(root: string, on?: string): string {
  if (on === undefined) return "uso: axiom telegram on|off";
  const v = on === "on" ? true : on === "off" ? false : undefined;
  if (v === undefined) return `valor inválido: ${on} (on|off)`;
  const cfg = loadConfig(root);
  if (!cfg.ok) return `config inválida (fail closed): ${cfg.error}`;
  saveConfig(root, { enabled: v, allowlist: cfg.config.allowlist, expiracionMin: cfg.config.expiracionMin });
  return v ? "telegram: activado (requiere token + allowlist)" : "telegram: desactivado (canal en pausa, config conservada)";
}

export function configText(root: string): string {
  const cfg = loadConfig(root);
  if (!cfg.ok) return cfg.error;
  const c = cfg.config;
  return `telegram.config.json: enabled=${c.enabled ? "on" : "off"} allowlist=[${c.allowlist.join(", ") || "vacía"}] expiracionMin=${c.expiracionMin}${cfg.migrated ? " (nuevo archivo; se adoptó telegram.allowlist.json legado)" : ""}`;
}

export function bloqueosText(root: string): string {
  return formatBloqueos(listBloqueos(root));
}

export function consumoText(root: string): string {
  const { global } = loadPolicies(root);
  const base = formatConsumo(getConsumo(root), global.techo);
  const ult = (() => { try { return listUsos(root, 3); } catch { return []; } })();
  if (!ult.length) return base;
  return `${base} usos: ${ult.map((u) => `+${u.total}tok(${u.fuente})`).join(" ")}`;
}
