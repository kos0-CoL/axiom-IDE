// Compat: Telegram ahora es módulo por defecto en src/modules/telegram/.
// Este archivo solo re-exporta para no romper imports existentes.
export { notifyApproval, handleCallback, bloqueosText, consumoText, statusText, allowChatId, unallowChatId, setExpiracion, setEnabled, configText } from "./modules/telegram/adapter.js";
export { routeText, handleUpdate, deliver, notifyChat, runPolling } from "./modules/telegram/bot.js";
export { inlineKeyboardFor, approvalPayload, parseCallbackData, parseUpdate, tokenFromEnv, webhookSecretFromEnv, sendMessage, answerCallback, setWebhook, fetchUpdates } from "./modules/telegram/transport.js";
