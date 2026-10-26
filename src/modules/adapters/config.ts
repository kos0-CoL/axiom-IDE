// Módulo adapters — configuración del proveedor LLM activo (AXM-062).
// Una sola integración activa. Sin config válida no hay spawn (fail closed).
// El cambio de proveedor es solo config: ninguna spec ni código cambia.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const Proveedor = z.enum(["off", "ollama", "litellm", "openai", "anthropic", "google", "openrouter"]);
export type Proveedor = z.infer<typeof Proveedor>;

export const AdaptersConfig = z.object({
  proveedor: Proveedor.default("off"),
  model: z.string().min(1).max(128).default("llama3.1"),
  baseUrl: z.string().url().max(256).optional(),
  timeoutMs: z.number().int().min(100).max(600000).default(30000),
  maxChars: z.number().int().min(256).max(100000).default(8000),
});
export type AdaptersConfig = z.infer<typeof AdaptersConfig>;

export const CONFIG_FILE = "adapters.config.json";

export function defaultBaseUrl(p: Proveedor): string {
  if (p === "litellm") return "http://127.0.0.1:4000";
  if (p === "ollama") return "http://127.0.0.1:11434";
  if (p === "openai") return "https://api.openai.com";
  if (p === "anthropic") return "https://api.anthropic.com";
  if (p === "google") return "https://generativelanguage.googleapis.com";
  // OpenRouter sirve en /api/v1 (no /v1): el driver concatena /v1/... → esta base evita el 404.
  if (p === "openrouter") return "https://openrouter.ai/api";
  return "http://127.0.0.1:11434";
}

export interface ModeloInfo {
  id: string;
  free?: boolean;
  recomendado?: boolean;
  nota?: string;
}

// Catálogo curado mínimo. OpenRouter lista real vía /api/adapters/modelos cuando hay key.
export const MODELOS: Record<Exclude<Proveedor, "off">, ModeloInfo[]> = {
  ollama: [
    { id: "llama3.1", free: true, recomendado: true, nota: "local" },
    { id: "mistral", free: true, recomendado: true, nota: "local" },
    { id: "codellama", free: true, recomendado: true, nota: "code local" },
    { id: "qwen2.5-coder", free: true, recomendado: true, nota: "code local" },
  ],
  litellm: [{ id: "gpt-4o-mini", nota: "vía gateway local" }],
  openai: [
    { id: "gpt-4o-mini", recomendado: true, nota: "code" },
    { id: "gpt-4o", nota: "general" },
    { id: "o3-mini", recomendado: true, nota: "razonamiento code" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5", recomendado: true, nota: "rápido code" },
    { id: "claude-sonnet-4-5", recomendado: true, nota: "code" },
    { id: "claude-opus-4-1", nota: "máximo" },
  ],
  google: [
    { id: "gemini-2.5-flash", free: true, recomendado: true, nota: "cuota free" },
    { id: "gemini-2.5-pro", recomendado: true, nota: "code" },
  ],
  openrouter: [
    { id: "meta-llama/llama-3.1-8b-instruct:free", free: true, recomendado: true, nota: "free" },
    { id: "qwen/qwen-2.5-coder-32b-instruct:free", free: true, recomendado: true, nota: "free code" },
    { id: "google/gemini-2.0-flash-001", recomendado: true, nota: "barato code" },
    { id: "anthropic/claude-sonnet-4.5", recomendado: true, nota: "code" },
  ],
};

export function baseUrlDe(c: AdaptersConfig): string {
  return c.baseUrl ?? defaultBaseUrl(c.proveedor);
}

export function configPath(root: string): string {
  return join(root, CONFIG_FILE);
}

export function loadConfig(root: string): { ok: true; config: AdaptersConfig } | { ok: false; error: string } {
  const p = configPath(root);
  if (!existsSync(p)) return { ok: true, config: { proveedor: "off", model: "llama3.1", timeoutMs: 120000, maxChars: 8000 } };
  try {
    const r = AdaptersConfig.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (!r.success) return { ok: false, error: `adapters.config.json inválido: ${r.error.issues.map((i) => i.message).join("; ")}` };
    return { ok: true, config: r.data };
  } catch (e) {
    return { ok: false, error: `adapters.config.json ilegible: ${e instanceof Error ? e.message : e}` };
  }
}

export function saveConfig(root: string, cfg: AdaptersConfig): void {
  writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + "\n");
}
