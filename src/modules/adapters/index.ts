// Módulo adapters — una sola integración activa (AXM-062).
// Cambiar de proveedor es solo config: `adapters use ollama|litellm|off`.
import { AdaptersConfig, baseUrlDe, loadConfig, MODELOS, Proveedor, saveConfig } from "./config.js";
import { openDb } from "../../store.js";
import { getConsumo } from "../../store.js";
import { spawnOllama, SpawnResult } from "./ollama.js";
import { litellmKeyFromEnv, spawnLiteLLM, usoEstimado } from "./litellm.js";
import type { UsoSpawn } from "./litellm.js";
import { spawnOpenAICompat, fetchOpenRouterModels } from "./openai_compat.js";
import { getSecret } from "../../secrets.js";

export type { SpawnResult, UsoSpawn };
export { usoEstimado };
export { loadConfig };
export { baseUrlDe, litellmKeyFromEnv };

export function configText(root: string): string {
  const r = loadConfig(root);
  if (!r.ok) return r.error;
  const c = r.config;
  return `adapters.config.json: proveedor=${c.proveedor} model=${c.model} base=${baseUrlDe(c)} timeout=${c.timeoutMs}ms maxChars=${c.maxChars}`;
}

export function datosModulo(root: string): { proveedor: string; modelo: string; consumo: { totalTokens: number; totalCalls: number; ultimos: { prompt: number; respuesta: number; total: number; fuente: string }[] } } {
  const cfg = loadConfig(root);
  const c = cfg.ok ? cfg.config : { proveedor: "off", model: "‑", timeoutMs: 0, maxChars: 0 };
  const prov = c.proveedor === "off" ? "sin proveedor" : c.proveedor;
  const model = c.model || "‑";
  const uso = getConsumo(root, "global");
  const db = openDb(root);
  const ultimos = db
    .prepare("SELECT prompt, respuesta, total, fuente, created_at FROM uso_log ORDER BY id DESC LIMIT 5")
    .all() as { prompt: number; respuesta: number; total: number; fuente: string; created_at: string }[];
  db.close();
  return { proveedor: prov, modelo: model, consumo: { totalTokens: uso.tokens, totalCalls: uso.calls, ultimos } };
}

const KEY_POR_PROVEEDOR: Record<string, "AXIOM_LITELLM_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_API_KEY" | "OPENROUTER_API_KEY"> = {
  litellm: "AXIOM_LITELLM_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function keyPara(proveedor: string, root: string): string | undefined {
  const k = KEY_POR_PROVEEDOR[proveedor];
  if (!k) return undefined;
  return getSecret(root, k) ?? (proveedor === "litellm" ? litellmKeyFromEnv() : undefined);
}

// Formato que OpenRouter reconoce (docs: sk-or-v1- + hex). Con otra forma
// (p. ej. una clave tsk-or-v1-… pegada por error) la API responde 401
// «Missing Authentication header» sin explicación útil: se detecta antes.
export function formatoOpenRouter(key: string): boolean {
  return /^sk-or-v1-[0-9a-f]{48,}$/.test(key);
}
export function errorKeyOpenRouter(key: string): string {
  return `OPENROUTER_API_KEY inválida: la guardada empieza por "${key.slice(0, 4)}…" pero debe ser sk-or-v1- seguido de hex (créala en openrouter.ai/keys) — guárdala otra vez en Configuración → Clave API`;
}

export function modelosPara(proveedor: string, filtro: "todos" | "free" | "recomendados" = "todos"): { id: string; free?: boolean; recomendado?: boolean; nota?: string }[] {
  const lista = (MODELOS as Record<string, { id: string; free?: boolean; recomendado?: boolean; nota?: string }[]>)[proveedor] ?? [];
  if (filtro === "free") return lista.filter((m) => m.free);
  if (filtro === "recomendados") return lista.filter((m) => m.recomendado);
  return lista;
}

export async function modelosOpenRouter(root: string, filtro: "todos" | "free" | "recomendados" = "todos"): Promise<{ ok: boolean; modelos?: { id: string; free?: boolean; recomendado?: boolean }[]; error?: string }> {
  const r = loadConfig(root);
  if (!r.ok) return { ok: false, error: r.error };
  const key = keyPara("openrouter", root);
  if (!key) return { ok: false, error: "sin key (fail closed): guarda OPENROUTER_API_KEY en Configuración" };
  if (!formatoOpenRouter(key)) return { ok: false, error: errorKeyOpenRouter(key) };
  const live = await fetchOpenRouterModels(baseUrlDe({ ...r.config, proveedor: "openrouter" }), key);
  if (!live.ok) return live;
  const lista = live.modelos ?? [];
  if (filtro === "free") return { ok: true, modelos: lista.filter((m) => m.free) };
  if (filtro === "recomendados") {
    const ids = new Set(modelosPara("openrouter", "recomendados").map((m) => m.id));
    return { ok: true, modelos: lista.filter((m) => ids.has(m.id)).map((m) => ({ ...m, recomendado: true })) };
  }
  return { ok: true, modelos: lista };
}

export function usarProveedor(root: string, p?: string): string {
  if (!p) return "uso: axiom adapters use <off|ollama|litellm|openai|anthropic|google|openrouter>";
  const r = Proveedor.safeParse(p);
  if (!r.success) return `proveedor inválido: ${p} (off|ollama|litellm)`;
  const cur = loadConfig(root);
  if (!cur.ok) return `config inválida (fail closed): ${cur.error}`;
  saveConfig(root, { ...cur.config, proveedor: r.data });
  return `proveedor: ${r.data} (base ${baseUrlDe({ ...cur.config, proveedor: r.data })}) — sin tocar specs`;
}

export function ponerModelo(root: string, m?: string): string {
  if (!m || m.length > 128) return "uso: axiom adapters model <nombre> (1-128 caracteres)";
  const cur = loadConfig(root);
  if (!cur.ok) return `config inválida (fail closed): ${cur.error}`;
  saveConfig(root, { ...cur.config, model: m });
  return `model: ${m}`;
}

export function ponerUrl(root: string, u?: string): string {
  if (!u) return "uso: axiom adapters url <https?://...> (vacío con - para volver al defecto local)";
  const cur = loadConfig(root);
  if (!cur.ok) return `config inválida (fail closed): ${cur.error}`;
  if (u === "-") {
    const { baseUrl: _drop, ...resto } = cur.config;
    void _drop;
    saveConfig(root, resto as AdaptersConfig);
    return `base: defecto (${baseUrlDe(resto as AdaptersConfig)})`;
  }
  try {
    new URL(u);
  } catch {
    return `url inválida: ${u}`;
  }
  if (u.length > 256) return `url inválida: ${u}`;
  saveConfig(root, { ...cur.config, baseUrl: u });
  return `base: ${u}`;
}

export function ponerTimeoutMs(root: string, ms?: string): string {
  if (ms === undefined) return "uso: axiom adapters timeout <ms 100-600000>";
  const n = parseInt(ms, 10);
  if (!Number.isInteger(n) || n < 100 || n > 600000) return `timeout inválido: ${ms} (entero 100-600000)`;
  const cur = loadConfig(root);
  if (!cur.ok) return `config inválida (fail closed): ${cur.error}`;
  saveConfig(root, { ...cur.config, timeoutMs: n });
  return `timeout: ${n}ms`;
}

export function ponerMaxChars(root: string, n?: string): string {
  if (n === undefined) return "uso: axiom adapters maxchars <256-100000>";
  const v = parseInt(n, 10);
  if (!Number.isInteger(v) || v < 256 || v > 100000) return `maxchars inválido: ${n} (entero 256-100000)`;
  const cur = loadConfig(root);
  if (!cur.ok) return `config inválida (fail closed): ${cur.error}`;
  saveConfig(root, { ...cur.config, maxChars: v });
  return `maxChars: ${v}`;
}

export async function spawn(
  root: string,
  task: string,
  override: { timeoutMs?: number; maxChars?: number; key?: string; onDelta?: (texto: string) => void } = {},
): Promise<SpawnResult> {
  const r = loadConfig(root);
  if (!r.ok) return { ok: false, error: `config inválida (fail closed): ${r.error}`, ms: 0, proveedor: "?", model: "?" };
  const c = r.config;
  const budget = {
    timeoutMs: override.timeoutMs ?? c.timeoutMs,
    maxChars: override.maxChars ?? c.maxChars,
  };
  if (c.proveedor === "off") {
    return { ok: false, error: "apagado (fail closed): elige un proveedor en Configuración", ms: 0, proveedor: "off", model: c.model };
  }
  if (c.proveedor === "ollama") return spawnOllama(baseUrlDe(c), c.model, task, budget);
  if (c.proveedor === "anthropic") {
    const key = override.key ?? keyPara("anthropic", root);
    if (!key) return { ok: false, error: "sin key (fail closed): guarda ANTHROPIC_API_KEY en Configuración", ms: 0, proveedor: "anthropic", model: c.model };
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget.timeoutMs);
    try {
      const r = await fetch(`${baseUrlDe(c).replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: c.model, max_tokens: Math.min(c.maxChars, 4096), messages: [{ role: "user", content: task }] }),
        signal: ctrl.signal,
      });
      const j = (await r.json()) as { content?: { text?: unknown }[]; error?: { message?: unknown }; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
      const text = j.content?.map((b) => (typeof b.text === "string" ? b.text : "")).join("") ?? "";
      if (!r.ok || !text) {
        const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
        return { ok: false, error: `anthropic: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor: "anthropic", model: c.model };
      }
      const truncada = text.length > budget.maxChars;
      const usoA: UsoSpawn = typeof (j.usage?.input_tokens) === "number" && typeof (j.usage?.output_tokens) === "number"
        ? { prompt: j.usage.input_tokens as number, respuesta: j.usage.output_tokens as number, total: (j.usage.input_tokens as number) + (j.usage.output_tokens as number), fuente: "medido" }
        : usoEstimado(task, text);
      return { ok: true, text: truncada ? text.slice(0, budget.maxChars) : text, ms: Date.now() - t0, proveedor: "anthropic", model: c.model, truncada, uso: usoA };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${budget.timeoutMs}ms` : e.message) : String(e);
      return { ok: false, error: `anthropic: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "anthropic", model: c.model };
    } finally {
      clearTimeout(timer);
    }
  }
  if (c.proveedor === "google") {
    const key = override.key ?? keyPara("google", root);
    if (!key) return { ok: false, error: "sin key (fail closed): guarda GOOGLE_API_KEY en Configuración", ms: 0, proveedor: "google", model: c.model };
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget.timeoutMs);
    try {
      const r = await fetch(`${baseUrlDe(c).replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(c.model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: task }] }] }),
        signal: ctrl.signal,
      });
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[]; error?: { message?: unknown }; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown } };
      const text = j.candidates?.map((cd) => (cd.content?.parts ?? []).map((p) => (typeof p.text === "string" ? p.text : "")).join("")).join("") ?? "";
      if (!r.ok || !text) {
        const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
        return { ok: false, error: `google: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor: "google", model: c.model };
      }
      const truncada = text.length > budget.maxChars;
      const ug = j.usageMetadata;
      const usoG: UsoSpawn = typeof ug?.promptTokenCount === "number" && typeof ug?.candidatesTokenCount === "number"
        ? { prompt: ug.promptTokenCount, respuesta: ug.candidatesTokenCount, total: typeof ug.totalTokenCount === "number" ? ug.totalTokenCount : (ug.promptTokenCount as number) + (ug.candidatesTokenCount as number), fuente: "medido" }
        : usoEstimado(task, text);
      return { ok: true, text: truncada ? text.slice(0, budget.maxChars) : text, ms: Date.now() - t0, proveedor: "google", model: c.model, truncada, uso: usoG };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${budget.timeoutMs}ms` : e.message) : String(e);
      return { ok: false, error: `google: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "google", model: c.model };
    } finally {
      clearTimeout(timer);
    }
  }
  const keyName = c.proveedor === "litellm" ? "AXIOM_LITELLM_KEY" : c.proveedor === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
  const key = override.key ?? keyPara(c.proveedor, root);
  if (!key) {
    return { ok: false, error: `sin key (fail closed): guarda ${keyName} en Configuración`, ms: 0, proveedor: c.proveedor, model: c.model };
  }
  if (c.proveedor === "openrouter" && !formatoOpenRouter(key)) {
    return { ok: false, error: errorKeyOpenRouter(key), ms: 0, proveedor: c.proveedor, model: c.model };
  }
  if (c.proveedor === "litellm") return spawnLiteLLM(baseUrlDe(c), c.model, task, key, budget);
  const extra: Record<string, string> = c.proveedor === "openrouter" ? { "HTTP-Referer": "http://127.0.0.1/", "X-Title": "Axiom" } : {};
  const s = await spawnOpenAICompat(c.proveedor, baseUrlDe(c), c.model, task, key, budget, extra, override.onDelta);
  // Key bien formada pero rechazada (revocada/de otra cuenta): el 401 de
  // OpenRouter llega sin pista; se lo explicamos en el propio error.
  if (!s.ok && s.error && /Missing Authentication header/i.test(s.error)) s.error += " — OpenRouter no reconoce esta key: crea una sk-or-v1-… en openrouter.ai/keys y guárdala en Configuración";
  return s;
}

export function formatSpawn(s: SpawnResult): string {
  const tok = s.uso ? ` +${s.uso.total}tok(${s.uso.fuente})` : "";
  if (!s.ok) return `spawn ${s.proveedor}/${s.model}: ERROR — ${s.error} (${s.ms}ms)${tok}`;
  const extra = s.truncada ? " [truncada a cap]" : "";
  return `spawn ${s.proveedor}/${s.model} (${s.ms}ms${tok})${extra}:\n${s.text ?? ""}`;
}
