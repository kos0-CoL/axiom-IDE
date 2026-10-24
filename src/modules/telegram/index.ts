export const manifest = { name: "telegram", version: "0.2.0", scope: "global", default: true };
export * from "./config.js";
export * from "./auth.js";
export { notifyApproval, handleCallback, bloqueosText, consumoText, statusText, allowChatId, unallowChatId, setExpiracion, configText, expiracion } from "./adapter.js";
export { formatApproval, formatBloqueos, formatConsumo, formatDecision } from "./transport.js";
