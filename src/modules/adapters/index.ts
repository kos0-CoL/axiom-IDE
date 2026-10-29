// Módulo adapters — una sola integración activa (AXM-062).
// Cambiar de proveedor es solo config: `adapters use ollama|litellm|off`.
import { AdaptersConfig, baseUrlDe, defaultBaseUrl, loadConfig, MODELOS, Proveedor, saveConfig } from "./config.js";
import { openDb } from "../../store.js";
import { getConsumo } from "../../store.js";
import { spawnOllama, SpawnResult } from "./ollama.js";
import { litellmKeyFromEnv, spawnLiteLLM, usoEstimado } from "./litellm.js";
import type { UsoSpawn } from "./litellm.js";
import type { ToolDefinicion, ToolCallNativo, SpawnAbierto } from "./openai_compat.js";
import { spawnOpenAICompat, fetchOpenRouterModels } from "./openai_compat.js";
import { getSecret } from "../../secrets.js";
import { conCosto } from "../../pricing.js";

export type { SpawnResult, UsoSpawn };
export type { ToolDefinicion, ToolCallNativo, SpawnAbierto } from "./openai_compat.js";
export { usoEstimado };
export { loadConfig };
export { baseUrlDe, litellmKeyFromEnv };

export function configText(root: string): string {
  const r = loadConfig(root);
  if (!r.ok) return r.error;
  const c = r.config;
  return `adapters.config.json: proveedor=${c.proveedor} model=${c.model} base=${baseUrlDe(c)} timeout=${c.timeoutMs}ms maxChars=${c.maxChars}`;
}

export function datosModulo(root: string): { proveedor: string; modelo: string; consumo: { totalTokens: number; totalCalls: number; costoTotal: number; ultimos: { prompt: number; respuesta: number; total: number; fuente: string; cache_lectura: number; costo_usd: number | null }[] } } {
  const cfg = loadConfig(root);
  const c = cfg.ok ? cfg.config : { proveedor: "off", model: "‑", timeoutMs: 0, maxChars: 0 };
  const prov = c.proveedor === "off" ? "sin proveedor" : c.proveedor;
  const model = c.model || "‑";
  const uso = getConsumo(root, "global");
  const db = openDb(root);
  const ultimos = db
    .prepare("SELECT prompt, respuesta, total, fuente, cache_lectura, costo_usd, created_at FROM uso_log ORDER BY id DESC LIMIT 5")
    .all() as { prompt: number; respuesta: number; total: number; fuente: string; cache_lectura: number; costo_usd: number | null; created_at: string }[];
  db.close();
  return { proveedor: prov, modelo: model, consumo: { totalTokens: uso.tokens, totalCalls: uso.calls, costoTotal: uso.costo, ultimos } };
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

// Filtra el catálogo vivo del proveedor. «recomendados» = los ids curados que
// siguen vivos; si el proveedor retiró todos (pasa: el catálogo rota) devuelve el
// catálogo entero, porque un desplegable vacío no distingue «no hay curados» de
// «la key no se tomó». Exportada para los tests: el filtro es contrato de la vista.
export function filtrarModelosLive(
  modelos: { id: string; free?: boolean }[],
  filtro: "todos" | "free" | "recomendados",
  curados: string[],
): { id: string; free?: boolean; recomendado?: boolean }[] {
  if (filtro === "free") return modelos.filter((m) => m.free);
  if (filtro === "recomendados") {
    const ids = new Set(curados);
    const vivos = modelos.filter((m) => ids.has(m.id)).map((m) => ({ ...m, recomendado: true }));
    return vivos.length ? vivos : modelos;
  }
  return modelos;
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
  const curados = modelosPara("openrouter", "recomendados").map((m) => m.id);
  return { ok: true, modelos: filtrarModelosLive(lista, filtro, curados) };
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

async function spawnSinCosto(
  root: string,
  task: string,
  override: { timeoutMs?: number; maxChars?: number; key?: string; model?: string; proveedor?: Proveedor; baseUrl?: string; onDelta?: (texto: string) => void; abierto?: SpawnAbierto } = {},
): Promise<SpawnResult> {
  const r = loadConfig(root);
  if (!r.ok) return { ok: false, error: `config inválida (fail closed): ${r.error}`, ms: 0, proveedor: "?", model: "?" };
  const c = r.config;
  // `proveedor`/`baseUrl` viajan en el override para poder probar la conexión del
  // proveedor que está en el formulario sin guardarlo antes (guardar algo que
  // todavía no funciona rompería el chat en marcha). Si el proveedor probado es
  // otro que el guardado, la base guardada no aplica —es de aquel— y se usa la
  // del proveedor, salvo que el override traiga una explícita.
  const budget = {
    timeoutMs: override.timeoutMs ?? c.timeoutMs,
    maxChars: override.maxChars ?? c.maxChars,
  };
  // Modelo efectivo: el del agente si lo trae, el global si no. Sin fallback
  // silencioso al global cuando el modelo pedido falla: el proveedor responde y
  // su error se propaga tal cual (se ve qué agente y qué modelo lo causaron).
  const modelo = typeof override.model === "string" && override.model.trim() ? override.model.trim() : c.model;
  const prov: Proveedor = override.proveedor ?? c.proveedor;
  const cfg: AdaptersConfig = prov === c.proveedor
    ? { ...c, baseUrl: override.baseUrl ?? c.baseUrl }
    : { ...c, proveedor: prov, baseUrl: override.baseUrl ?? defaultBaseUrl(prov) };
  if (prov === "off") {
    return { ok: false, error: "apagado (fail closed): elige un proveedor en Configuración", ms: 0, proveedor: "off", model: modelo };
  }
  if (prov === "ollama") return spawnOllama(baseUrlDe(cfg), modelo, task, budget);
  if (prov === "anthropic") {
    const key = override.key ?? keyPara("anthropic", root);
    if (!key) return { ok: false, error: "sin key (fail closed): guarda ANTHROPIC_API_KEY en Configuración", ms: 0, proveedor: "anthropic", model: modelo };
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget.timeoutMs);
    try {
      const r = await fetch(`${baseUrlDe(cfg).replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: modelo, max_tokens: Math.min(c.maxChars, 4096), messages: [{ role: "user", content: task }] }),
        signal: ctrl.signal,
      });
      const j = (await r.json()) as { content?: { text?: unknown }[]; error?: { message?: unknown }; usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown } };
      const text = j.content?.map((b) => (typeof b.text === "string" ? b.text : "")).join("") ?? "";
      if (!r.ok || !text) {
        const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
        return { ok: false, error: `anthropic: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor: "anthropic", model: modelo };
      }
      const truncada = text.length > budget.maxChars;
      // Anthropic informa la entrada en tres campos: `input_tokens` (fresca),
      // `cache_read_input_tokens` y `cache_creation_input_tokens`. El prompt total
      // facturable es la suma; los de cache quedan como desglose, igual que en
      // OpenAI y Google, para que el costo se calcule con una sola fórmula.
      const ua = j.usage;
      let usoA: UsoSpawn;
      if (typeof ua?.input_tokens === "number" && typeof ua?.output_tokens === "number") {
        const lectura = typeof ua.cache_read_input_tokens === "number" && ua.cache_read_input_tokens > 0 ? ua.cache_read_input_tokens : 0;
        const escritura = typeof ua.cache_creation_input_tokens === "number" && ua.cache_creation_input_tokens > 0 ? ua.cache_creation_input_tokens : 0;
        const promptTotal = ua.input_tokens + lectura + escritura;
        usoA = { prompt: promptTotal, respuesta: ua.output_tokens, total: promptTotal + ua.output_tokens, fuente: "medido" };
        if (lectura) usoA.cacheLectura = lectura;
        if (escritura) usoA.cacheEscritura = escritura;
      } else {
        usoA = usoEstimado(task, text);
      }
      return { ok: true, text: truncada ? text.slice(0, budget.maxChars) : text, ms: Date.now() - t0, proveedor: "anthropic", model: modelo, truncada, uso: usoA };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${budget.timeoutMs}ms` : e.message) : String(e);
      return { ok: false, error: `anthropic: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "anthropic", model: modelo };
    } finally {
      clearTimeout(timer);
    }
  }
  if (prov === "google") {
    const key = override.key ?? keyPara("google", root);
    if (!key) return { ok: false, error: "sin key (fail closed): guarda GOOGLE_API_KEY en Configuración", ms: 0, proveedor: "google", model: modelo };
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget.timeoutMs);
    try {
      const r = await fetch(`${baseUrlDe(cfg).replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: task }] }] }),
        signal: ctrl.signal,
      });
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[]; error?: { message?: unknown }; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown; cachedContentTokenCount?: unknown } };
      const text = j.candidates?.map((cd) => (cd.content?.parts ?? []).map((p) => (typeof p.text === "string" ? p.text : "")).join("")).join("") ?? "";
      if (!r.ok || !text) {
        const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
        return { ok: false, error: `google: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor: "google", model: modelo };
      }
      const truncada = text.length > budget.maxChars;
      const ug = j.usageMetadata;
      let usoG: UsoSpawn;
      if (typeof ug?.promptTokenCount === "number" && typeof ug?.candidatesTokenCount === "number") {
        usoG = { prompt: ug.promptTokenCount, respuesta: ug.candidatesTokenCount, total: typeof ug.totalTokenCount === "number" ? ug.totalTokenCount : ug.promptTokenCount + ug.candidatesTokenCount, fuente: "medido" };
        // `promptTokenCount` ya incluye los cacheados; el detalle es el subconjunto.
        if (typeof ug.cachedContentTokenCount === "number" && ug.cachedContentTokenCount > 0) usoG.cacheLectura = ug.cachedContentTokenCount;
      } else {
        usoG = usoEstimado(task, text);
      }
      return { ok: true, text: truncada ? text.slice(0, budget.maxChars) : text, ms: Date.now() - t0, proveedor: "google", model: modelo, truncada, uso: usoG };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${budget.timeoutMs}ms` : e.message) : String(e);
      return { ok: false, error: `google: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "google", model: modelo };
    } finally {
      clearTimeout(timer);
    }
  }
  const keyName = prov === "litellm" ? "AXIOM_LITELLM_KEY" : prov === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
  const key = override.key ?? keyPara(prov, root);
  if (!key) {
    return { ok: false, error: `sin key (fail closed): guarda ${keyName} en Configuración`, ms: 0, proveedor: prov, model: modelo };
  }
  if (prov === "openrouter" && !formatoOpenRouter(key)) {
    return { ok: false, error: errorKeyOpenRouter(key), ms: 0, proveedor: prov, model: modelo };
  }
  if (prov === "litellm") return spawnLiteLLM(baseUrlDe(cfg), modelo, task, key, budget);
  const extra: Record<string, string> = prov === "openrouter" ? { "HTTP-Referer": "http://127.0.0.1/", "X-Title": "Axiom" } : {};
  const s: SpawnResult = await spawnOpenAICompat(
    prov,
    baseUrlDe(cfg),
    modelo,
    task,
    key,
    budget,
    extra,
    override.onDelta,
    override.abierto,
  );
  // Key bien formada pero rechazada (revocada/de otra cuenta): el 401 de
  // OpenRouter llega sin pista; se lo explicamos en el propio error.
  if (!s.ok && s.error && /Missing Authentication header/i.test(s.error)) s.error += " — OpenRouter no reconoce esta key: crea una sk-or-v1-… en openrouter.ai/keys y guárdala en Configuración";
  return s;
}

// Único punto donde se agrega el costo: los drivers no leen `pricing.json` (no
// tienen root) y devuelven uso crudo; acá se enriquece antes de que el resultado
// salga al llamador.
export async function spawn(
  root: string,
  task: string,
  override: { timeoutMs?: number; maxChars?: number; key?: string; model?: string; proveedor?: Proveedor; baseUrl?: string; onDelta?: (texto: string) => void; abierto?: SpawnAbierto } = {},
): Promise<SpawnResult> {
  return conCosto(root, await spawnSinCosto(root, task, override));
}

/**
 * Equivalente de `spawn` con herramientas nativas. Detecta automáticamente el
 * proveedor; si es un OpenAI-compatible que admita tool calls (openai/openrouter/
 * litellm gateway), las manda como `tools` y el resultado incluye `toolCalls`
 * cuando el modelo las emite. Anthropic, Google y Ollama devuelven herramientas
 * vacías porque hoy no las envían por esta ruta.
 */
export async function spawnConTool(
  root: string,
  task: string,
  herramientas: ToolDefinicion[],
  override: { timeoutMs?: number; maxChars?: number; key?: string; model?: string; proveedor?: Proveedor; baseUrl?: string; onDelta?: (texto: string) => void; toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } } } = {},
): Promise<SpawnResult & { toolCalls?: ToolCallNativo[] }> {
  const abierto: SpawnAbierto = {
    herramientas,
    toolChoice: override.toolChoice ?? undefined,
  };
  const s = await spawn(root, task, { ...override, abierto });
  return {
    ...s,
    toolCalls: (s as SpawnResult & { toolCalls?: ToolCallNativo[] }).toolCalls,
  };
}

export function formatSpawn(s: SpawnResult): string {
  const tok = s.uso ? ` +${s.uso.total}tok(${s.uso.fuente})${s.uso.costoUsd !== undefined ? ` $${s.uso.costoUsd}` : ""}` : "";
  if (!s.ok) return `spawn ${s.proveedor}/${s.model}: ERROR — ${s.error} (${s.ms}ms)${tok}`;
  const extra = s.truncada ? " [truncada a cap]" : "";
  return `spawn ${s.proveedor}/${s.model} (${s.ms}ms${tok})${extra}:\n${s.text ?? ""}`;
}
