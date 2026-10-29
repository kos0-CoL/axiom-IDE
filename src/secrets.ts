// Secrets locales: nunca en repo, nunca en logs, nunca viajan al navegador como valores.
// UI solo ve presencia booleana. Se guardan en <root>/.axiom-secrets.json (gitignored, 0600).
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { valorEnv } from "./env.js";

export const SECRET_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "AXIOM_LITELLM_KEY",
  "AXIOM_TELEGRAM_BOT_TOKEN",
  "AXIOM_TELEGRAM_WEBHOOK_SECRET",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const FILE = ".axiom-secrets.json";

// Validación mínima de formato al guardar: una key mal pegada (p. ej. una
// "tsk-or-v1-..." de OpenRouter o una de otro proveedor) no debe quedarse en el
// archivo y fallar después con un 401 ilegible ("Missing Authentication header").
// OpenRouter solo acepta claves sk-or-v1- + hex (docs: openrouter.ai/keys).
const FORMATO_POR_CLAVE: Partial<Record<SecretKey, { rgx: RegExp; pista: string }>> = {
  OPENROUTER_API_KEY: {
    rgx: /^sk-or-v1-[0-9a-f]{48,}$/,
    pista: "debe empezar por sk-or-v1- seguido de 64 caracteres hexadecimales (créala en openrouter.ai/keys)",
  },
};

export function errorDeFormato(key: SecretKey, valor: string): string | undefined {
  const f = FORMATO_POR_CLAVE[key];
  if (!f || f.rgx.test(valor)) return undefined;
  const ecabezada = valor.slice(0, 4);
  return `${key} rechazada por formato: la que intentaste guardar empieza por "${ecabezada}…" pero ${f.pista}. OpenRouter respondería 401 (Missing Authentication header) a esa clave.`;
}

export function secretsPath(root: string): string {
  return join(root, FILE);
}

const envKey = (k: SecretKey): string => valorEnv(k) ?? "";

// Una env exportada hace tiempo puede ocultar para siempre la clave guardada
// desde la web (así «la carga de api en proveedores no hace nada»). Si el valor
// de env tiene formato inválido para esa clave, no cuenta: gana el archivo.
const envValida = (k: SecretKey): boolean => {
  const v = envKey(k);
  if (!v) return false;
  return errorDeFormato(k, v) === undefined;
};

export function readSecrets(root: string): Record<string, string> {
  try {
    const p = secretsPath(root);
    if (!existsSync(p)) return {};
    const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of SECRET_KEYS) if (typeof j[k] === "string" && (j[k] as string).length > 0) out[k] = j[k] as string;
    return out;
  } catch {
    return {};
  }
}

export function secretPresence(root: string): Record<string, boolean> {
  const file = readSecrets(root);
  const out: Record<string, boolean> = {};
  for (const k of SECRET_KEYS) out[k] = Boolean(envValida(k) || file[k]);
  return out;
}

export function getSecret(root: string, key: SecretKey): string | undefined {
  const e = envKey(key);
  // env solo si el formato es válido (errorDeFormato define el formato); si no,
  // se ignora esa env rota y se usa la del archivo.
  if (e && errorDeFormato(key, e) === undefined) return e;
  return readSecrets(root)[key];
}

export function setSecrets(root: string, patch: Record<string, string>): { saved: string[]; cleared: string[]; error?: string } {
  const cur = readSecrets(root);
  const saved: string[] = [];
  const cleared: string[] = [];
  // Valida todo el lote antes de tocar el archivo (o se guardaría la mitad).
  for (const k of SECRET_KEYS) {
    if (!(k in patch)) continue;
    const v = (patch[k] ?? "").trim();
    if (v) {
      const err = errorDeFormato(k, v);
      if (err) return { saved: [], cleared: [], error: err };
    }
  }
  for (const k of SECRET_KEYS) {
    if (!(k in patch)) continue;
    const v = (patch[k] ?? "").trim();
    if (v) {
      cur[k] = v;
      saved.push(k);
    } else {
      delete cur[k];
      cleared.push(k);
    }
  }
  writeFileSync(secretsPath(root), JSON.stringify(cur, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(secretsPath(root), 0o600);
  } catch {
    /* best effort */
  }
  return { saved, cleared };
}
