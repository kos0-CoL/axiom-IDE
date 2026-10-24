// Adapter ollama — LLM local vía HTTP nativo. Sin deps, sin estado, sin secretos.
import type { SpawnResult } from "./litellm.js";
import { usoEstimado } from "./litellm.js";
export type { SpawnResult };

export async function spawnOllama(
  baseUrl: string,
  model: string,
  prompt: string,
  opts: { timeoutMs: number; maxChars: number },
): Promise<SpawnResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: ctrl.signal,
    });
    let j: { response?: unknown; error?: unknown; prompt_eval_count?: unknown; eval_count?: unknown } = {};
    try {
      j = (await r.json()) as typeof j;
    } catch {
      return { ok: false, error: `ollama: HTTP ${r.status} sin JSON`, ms: Date.now() - t0, proveedor: "ollama", model };
    }
    if (!r.ok || typeof j.response !== "string") {
      const d = typeof j.error === "string" ? j.error : `HTTP ${r.status}`;
      return { ok: false, error: `ollama: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor: "ollama", model };
    }
    const full = j.response as string;
    const truncada = full.length > opts.maxChars;
    const uso = typeof j.prompt_eval_count === "number" && typeof j.eval_count === "number"
      ? { prompt: j.prompt_eval_count, respuesta: j.eval_count, total: j.prompt_eval_count + j.eval_count, fuente: "medido" as const }
      : usoEstimado(prompt, full);
    return { ok: true, text: truncada ? full.slice(0, opts.maxChars) : full, ms: Date.now() - t0, proveedor: "ollama", model, truncada, uso };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${opts.timeoutMs}ms` : e.message) : String(e);
    return { ok: false, error: `ollama: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor: "ollama", model };
  } finally {
    clearTimeout(timer);
  }
}
