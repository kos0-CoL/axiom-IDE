// Adapter litellm — gateway OpenAI-compatible vía HTTP nativo.
// La key SOLO por env AXIOM_LITELLM_KEY: nunca en repo, args, config ni logs.
import { ENV, valorEnv } from "../../env.js";

export interface UsoSpawn {
  prompt: number;
  respuesta: number;
  total: number;
  fuente: "medido" | "estimado";
  /** Subconjunto de `prompt` leído de cache (OpenAI/Google) ya sumado en `prompt`. */
  cacheLectura?: number;
  /** Tokens escritos en cache (Anthropic). Ya sumados en `prompt`. */
  cacheEscritura?: number;
  /** USD de esta llamada, solo si `pricing.json` declara precio para el modelo. */
  costoUsd?: number;
}

export interface UsoOpenAIBruto {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown };
}

/**
 * `usage` de un cuerpo OpenAI-compatible → `UsoSpawn`.
 * `prompt_tokens` ya incluye los cacheados; `cached_tokens` es su subconjunto.
 * Sin prompt y completion numéricos no hay medición: devuelve undefined para que
 * el llamador estime en vez de inventar ceros.
 */
export function usoOpenAI(u: UsoOpenAIBruto | undefined): UsoSpawn | undefined {
  if (typeof u?.prompt_tokens !== "number" || typeof u?.completion_tokens !== "number") return undefined;
  const uso: UsoSpawn = {
    prompt: u.prompt_tokens,
    respuesta: u.completion_tokens,
    total: typeof u.total_tokens === "number" ? u.total_tokens : u.prompt_tokens + u.completion_tokens,
    fuente: "medido",
  };
  const cache = u.prompt_tokens_details?.cached_tokens;
  if (typeof cache === "number" && cache > 0) uso.cacheLectura = cache;
  return uso;
}

export interface SpawnResult {
  ok: boolean;
  text?: string;
  error?: string;
  ms: number;
  proveedor: string;
  model: string;
  truncada?: boolean;
  uso?: UsoSpawn;
}

// Estimación honesta cuando el proveedor no reporta usage: ~4 caracteres por token.
export function estimarTokens(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 4));
}

export function usoEstimado(prompt: string, respuesta: string): UsoSpawn {
  const p = estimarTokens(prompt);
  const r = estimarTokens(respuesta);
  return { prompt: p, respuesta: r, total: p + r, fuente: "estimado" };
}

// Los drivers OpenAI-compat añaden /v1/...: acepta la base con /v1 pegado (formato que
// dan OpenRouter/OpenAI al copiar) sin producir .../v1/v1/... (404). Identidad si no lleva /v1.
export function normalizaBase(baseUrl: string): string {
  // El usuario pega la base desde Ajustes → Proveedor LLM. Si arrastra
  // espacios finales (copiar y pegar), terminar en `/v1` o en `/` se vuelve
  // invisible y la concatenación da `.../api/v1  /v1/chat/completions`:
  // el proveedor responde «Not Found» y parece un fallo del modelo o de la
  // key. Se recorta antes de comparar para que el resultado no dependa de
  // un espacio de más; el orden cubre `.../v1/` y `.../v1`.
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// `env` opcional: sin argumento, `valorEnv` resuelve `process.env` en `src/env.ts`.
export function litellmKeyFromEnv(env?: NodeJS.ProcessEnv): string | undefined {
  return valorEnv(ENV.AXIOM_LITELLM_KEY, env);
}

export async function spawnLiteLLM(
  baseUrl: string,
  model: string,
  prompt: string,
  key: string,
  opts: { timeoutMs: number; maxChars: number },
): Promise<SpawnResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const r = await fetch(`${normalizaBase(baseUrl)}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    let j: { choices?: { message?: { content?: unknown } }[]; error?: { message?: unknown }; usage?: UsoOpenAIBruto } = {};
    try {
      j = (await r.json()) as typeof j;
    } catch {
      return { ok: false, error: `litellm: HTTP ${r.status} sin JSON`, ms: Date.now() - t0, proveedor: "litellm", model };
    }
    const content = j.choices?.[0]?.message?.content;
    if (!r.ok || typeof content !== "string") {
      const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
      const up = estimarTokens(prompt);
      return { ok: false, error: `litellm: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor: "litellm", model, uso: { prompt: up, respuesta: 0, total: up, fuente: "estimado" } };
    }
    const truncada = content.length > opts.maxChars;
    const uso: UsoSpawn = usoOpenAI(j.usage) ?? usoEstimado(prompt, content);
    return { ok: true, text: truncada ? content.slice(0, opts.maxChars) : content, ms: Date.now() - t0, proveedor: "litellm", model, truncada, uso };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${opts.timeoutMs}ms` : e.message) : String(e);
    // Nunca se registra ni devuelve la key.
    return { ok: false, error: `litellm: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "litellm", model };
  } finally {
    clearTimeout(timer);
  }
}
