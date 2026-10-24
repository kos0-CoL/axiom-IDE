// Adapter litellm — gateway OpenAI-compatible vía HTTP nativo.
// La key SOLO por env AXIOM_LITELLM_KEY: nunca en repo, args, config ni logs.
export interface UsoSpawn {
  prompt: number;
  respuesta: number;
  total: number;
  fuente: "medido" | "estimado";
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
  return baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
}

export function litellmKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const k = (env.AXIOM_LITELLM_KEY ?? "").trim();
  return k ? k : undefined;
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
    let j: { choices?: { message?: { content?: unknown } }[]; error?: { message?: unknown }; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } } = {};
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
    const u = j.usage;
    const uso: UsoSpawn = typeof u?.prompt_tokens === "number" && typeof u?.completion_tokens === "number"
      ? { prompt: u.prompt_tokens, respuesta: u.completion_tokens, total: typeof u.total_tokens === "number" ? u.total_tokens : u.prompt_tokens + u.completion_tokens, fuente: "medido" }
      : usoEstimado(prompt, content);
    return { ok: true, text: truncada ? content.slice(0, opts.maxChars) : content, ms: Date.now() - t0, proveedor: "litellm", model, truncada, uso };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${opts.timeoutMs}ms` : e.message) : String(e);
    // Nunca se registra ni devuelve la key.
    return { ok: false, error: `litellm: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "litellm", model };
  } finally {
    clearTimeout(timer);
  }
}
