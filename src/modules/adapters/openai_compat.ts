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
  onDelta?: (texto: string) => void,
): Promise<SpawnResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  // Con streaming el timeout es de inactividad: cada trozo recibido lo rearma,
  // así una respuesta larga pero fluida no muere por el reloj total (que era
  // el motivo del «timeout 120000ms» en modelos lentos).
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const rearma = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  };
  const streaming = typeof onDelta === "function";
  try {
    const r = await fetch(`${normalizaBase(baseUrl)}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(streaming
        ? { model, stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: prompt }] }
        : { model, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    if (streaming) {
      const tipo = r.headers.get("content-type") ?? "";
      if (!r.ok || !r.body || !/text\/event-stream|stream/i.test(tipo)) {
        // El proveedor no aceptó el stream: caemos a la respuesta normal de una pieza.
        let j: { choices?: { message?: { content?: unknown } }[]; error?: { message?: unknown } } = {};
        try { j = (await r.json()) as typeof j; } catch { /* sin JSON */ }
        const content = j.choices?.[0]?.message?.content;
        if (!r.ok || typeof content !== "string") {
          const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
          return { ok: false, error: `${proveedor}: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor, model };
        }
        onDelta?.(content.slice(0, opts.maxChars));
        return { ok: true, text: content.slice(0, opts.maxChars), ms: Date.now() - t0, proveedor, model, truncada: content.length > opts.maxChars, uso: usoEstimado(prompt, content) };
      }
      let acumulado = "";
      let uso: UsoSpawn | undefined;
      const lector = r.body.getReader();
      const decod = new TextDecoder();
      let pendiente = "";
      const procesa = (evento: string): void => {
        const linea = evento.replace(/^data:\s?/, "").trim();
        if (!linea || linea === "[DONE]") return;
        let p: { choices?: { delta?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } };
        try { p = JSON.parse(linea) as typeof p; } catch { return; }
        const delta = p.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          acumulado += delta;
          if (acumulado.length > opts.maxChars) acumulado = acumulado.slice(0, opts.maxChars);
          try { onDelta?.(delta); } catch { /* el consumidor puede cerrar el canal */ }
        }
        const u = p.usage;
        if (typeof u?.prompt_tokens === "number" && typeof u?.completion_tokens === "number") {
          uso = { prompt: u.prompt_tokens, respuesta: u.completion_tokens, total: typeof u.total_tokens === "number" ? u.total_tokens : u.prompt_tokens + u.completion_tokens, fuente: "medido" };
        }
      };
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        rearma();
        pendiente += decod.decode(value, { stream: true });
        const eventos = pendiente.split("\n\n");
        pendiente = eventos.pop() ?? "";
        for (const ev of eventos) procesa(ev);
      }
      for (const ev of pendiente.split("\n\n")) procesa(ev);
      if (!acumulado) {
        return { ok: false, error: `${proveedor}: el stream llegó vacío (modelo sin salida)`, ms: Date.now() - t0, proveedor, model };
      }
      return { ok: true, text: acumulado, ms: Date.now() - t0, proveedor, model, truncada: false, uso: uso ?? usoEstimado(prompt, acumulado) };
    }
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
    if (timer) clearTimeout(timer);
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
      // Sin recorte: solo se guardan id/free (~16 KB con 462 modelos, medido contra
      // el catálogo real). El tope anterior de 300 dejaba fuera de la lista modelos
      // vivos por su posición —anthropic/claude-sonnet-4.5 iba en la 328— y parecía
      // que la key no se había tomado.
      if (modelos.length >= 2000) break;
    }
    return { ok: true, modelos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
