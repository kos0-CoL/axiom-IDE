// Módulo telegram — autorización de origen (allowlist de la config propia). Fail closed.
import { loadConfig } from "./config.js";

export function allowedChat(root: string, chatId?: string): boolean {
  if (!chatId) return true; // CLI local sin chat: lo decide el broker igual
  const r = loadConfig(root);
  if (!r.ok) return false; // config corrupta: sin remoto
  return r.config.allowlist.includes(chatId);
}
