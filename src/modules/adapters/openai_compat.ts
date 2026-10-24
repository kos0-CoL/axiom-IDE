// Driver OpenAI-compatible: openai, openrouter, litellm gateway.
// Key solo desde servidor (env o .axiom-secrets.json). Nunca en logs/respuestas.
import type { SpawnResult, UsoSpawn } from "./litellm.js";
import { normalizaBase, usoEstimado } from "./litellm.js";

export async function spawnOpenAICompat(
  proveedor: string,
  baseUrl: string,
  model: string,
  prompt: string,
  key: string,
  opts: { timeoutMs: number; maxChars: number },
  extraHeaders: Record<string, string> = {},
): Promise<SpawnResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const r = await fetch(`${normalizaBase(baseUrl)}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    let j: { choices?: { message?: { content?: unknown } }[]; error?: { message?: unknown; code?: unknown }; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } } = {};
    try {
      j = (await r.json()) as typeof j;
    } catch (e) {
      // El aborto del timeout al leer el cuerpo no es «respuesta sin JSON»:
      // decirlo así oculta que el modelo tardó más que el Timeout configurado.
      const motivo = ctrl.signal.aborted
        ? `timeout ${opts.timeoutMs}ms al leer la respuesta (sube Timeout en Ajustes → Proveedor LLM si el modelo tarda más)`
        : `${proveedor}: HTTP ${r.status} sin JSON (${e instanceof Error ? e.message.slice(0, 120) : "cuerpo ilegible"})`;
      return { ok: false, error: motivo.slice(0, 300), ms: Date.now() - t0, proveedor, model };
    }
    const content = j.choices?.[0]?.message?.content;
    if (!r.ok || typeof content !== "string") {
      const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
      return { ok: false, error: `${proveedor}: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor, model };
    }
    const truncada = content.length > opts.maxChars;
    const u = j.usage;
    const uso: UsoSpawn = typeof u?.prompt_tokens === "number" && typeof u?.completion_tokens === "number"
      ? { prompt: u.prompt_tokens, respuesta: u.completion_tokens, total: typeof u.total_tokens === "number" ? u.total_tokens : u.prompt_tokens + u.completion_tokens, fuente: "medido" }
      : usoEstimado(prompt, content);
    return { ok: true, text: truncada ? content.slice(0, opts.maxChars) : content, ms: Date.now() - t0, proveedor, model, truncada, uso };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout ${opts.timeoutMs}ms` : e.message) : String(e);
    return { ok: false, error: `${proveedor}: ${msg}`.slice(0, 300), ms: Date.now() - t0, proveedor, model };
  } finally {
    clearTimeout(timer);
  }
}

export interface OpenRouterModelo {
  id: string;
  free?: boolean;
}

// Gratis = sufijo :free o pricing.prompt 0 (OpenRouter marca ambos; el sufijo
// solo cubre una parte del catálogo, el pricing cubre el resto).
function esGratis(id: string, pricing?: { prompt?: unknown; completion?: unknown }): boolean {
  if (id.endsWith(":free")) return true;
  const p = typeof pricing?.prompt === "string" ? Number(pricing.prompt) : typeof pricing?.prompt === "number" ? pricing.prompt : NaN;
  return p === 0;
}

export async function fetchOpenRouterModels(baseUrl: string, key: string, timeoutMs = 15000): Promise<{ ok: boolean; modelos?: OpenRouterModelo[]; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${normalizaBase(baseUrl)}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    const j = (await r.json()) as { data?: { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }[]; error?: { message?: unknown } };
    if (!r.ok || !Array.isArray(j.data)) {
      const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
      return { ok: false, error: d.slice(0, 200) };
    }
    const modelos: OpenRouterModelo[] = [];
    for (const m of j.data) {
      const id = String(m.id ?? "");
      if (!id) continue;
      const out: OpenRouterModelo = { id };
      if (esGratis(id, m.pricing)) out.free = true;
      modelos.push(out);
      if (modelos.length >= 300) break;
    }
    return { ok: true, modelos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
