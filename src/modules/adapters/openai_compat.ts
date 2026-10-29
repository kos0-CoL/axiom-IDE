// Driver OpenAI-compatible: openai, openrouter, litellm gateway.
// Key solo desde servidor (env o .axiom-secrets.json). Nunca en logs/respuestas.
import type { SpawnResult, UsoSpawn, UsoOpenAIBruto } from "./litellm.js";
import { normalizaBase, usoEstimado, usoOpenAI } from "./litellm.js";

// Tool call nativo detrás de flag: solo se activa cuando el llamador lo pide y
// el proveedor lo admite; si no hay herramientas o el flag no está, se manda el
// prompt simple y se sigue el protocolo de bloques ````tool JSON` del loop.
export interface ToolDefinicion {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object;
  };
}

export interface ToolCallNativo {
  name: string;
  arguments: string;
}

export interface SpawnAbierto {
  herramientas?: ToolDefinicion[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export async function spawnOpenAICompat(
  proveedor: string,
  baseUrl: string,
  model: string,
  prompt: string,
  key: string,
  opts: { timeoutMs: number; maxChars: number },
  extraHeaders: Record<string, string> = {},
  onDelta?: (texto: string) => void,
  abierto?: SpawnAbierto,
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
  const conNativo = Boolean(abierto?.herramientas?.length) || typeof abierto?.toolChoice === "object";
  const bodyBase: object = { model, messages: [{ role: "user", content: prompt }] };
  if (conNativo) {
    (bodyBase as Record<string, unknown>).tools = abierto?.herramientas;
    (bodyBase as Record<string, unknown>).tool_choice = abierto?.toolChoice;
  }
  try {
    const r = await fetch(`${normalizaBase(baseUrl)}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(streaming
        ? { model, stream: true, stream_options: { include_usage: true }, tools: abierto?.herramientas, tool_choice: abierto?.toolChoice, messages: [{ role: "user", content: prompt }] }
        : bodyBase),
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
      const acumuladoTool: Record<number, ToolCallNativo> = {};
      const procesa = (evento: string): void => {
        const linea = evento.replace(/^data:\s?/, "").trim();
        if (!linea || linea === "[DONE]") return;
        let p: { choices?: { delta?: { content?: unknown; tool_calls?: unknown } }[]; usage?: UsoOpenAIBruto };
        try { p = JSON.parse(linea) as typeof p; } catch { return; }
        const delta = p.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          acumulado += delta;
          if (acumulado.length > opts.maxChars) acumulado = acumulado.slice(0, opts.maxChars);
          try { onDelta?.(delta); } catch { /* el consumidor puede cerrar el canal */ }
        }
        // Tool call parcial en stream: el delta puede venir en `tool_calls` en vez
        // de `content`; lo recogemos sin cambiar el resto del procesamiento.
        if (conNativo) {
          const toolDelta = p.choices?.[0]?.delta?.tool_calls;
          if (Array.isArray(toolDelta)) {
            for (const tc of toolDelta) {
              const idx = typeof tc.index === "number" ? tc.index : -1;
              if (idx < 0) continue;
              const fn = tc.function;
              if (!fn || typeof fn.arguments !== "string") continue;
              if (!acumuladoTool[idx]) acumuladoTool[idx] = { name: fn.name, arguments: "" };
              acumuladoTool[idx].arguments += fn.arguments;
            }
          }
        }
        // El último evento trae el `usage` completo (include_usage): la medición
        // reemplaza a la anterior, nunca se suma por trozo.
        const medido = usoOpenAI(p.usage);
        if (medido) uso = medido;
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
      if (!acumulado && (!conNativo || !Object.keys(acumuladoTool).length)) {
        return { ok: false, error: `${proveedor}: el stream llegó vacío (modelo sin salida)`, ms: Date.now() - t0, proveedor, model };
      }
      const toolCalls: ToolCallNativo[] = conNativo
        ? Object.values(acumuladoTool).map((tc) => ({ name: tc.name, arguments: tc.arguments }))
        : [];
      return { ok: true, text: acumulado, ms: Date.now() - t0, proveedor, model, truncada: false, uso: uso ?? usoEstimado(prompt, acumulado), toolCalls } as SpawnResult & { toolCalls?: ToolCallNativo[] };
    }
    let j: { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[]; error?: { message?: unknown; code?: unknown }; usage?: UsoOpenAIBruto } = {};
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
    // En modo nativo, el texto puede venir solo en tool_calls; si no hay
    // contenido ni tool_calls, lo manejamos como error anterior.
    const content = j.choices?.[0]?.message?.content;
    let toolCalls: ToolCallNativo[] = [];
    if (conNativo) {
      const raw = j.choices?.[0]?.message?.tool_calls;
      if (Array.isArray(raw)) {
        toolCalls = raw
          .filter((tc): tc is { function: { name?: unknown; arguments?: unknown } } => Boolean(tc.function))
          .map((tc) => ({
            name: typeof tc.function?.name === "string" ? tc.function.name : String(tc.function?.name ?? ""),
            arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : "",
          }))
          .filter((tc) => tc.name);
      }
    }
    // `SpawnResult` no tiene `toolCalls`, pero el backend lo devuelve cuando
    // el modo abierto está activo; el cast de retorno lo incluye. Sin el cast
    // la asignación cae en error de tipo por ser una propiedad extra.
    if (!r.ok || (typeof content !== "string" && !toolCalls.length)) {
      const d = typeof j.error?.message === "string" ? j.error.message : `HTTP ${r.status}`;
      return { ok: false, error: `${proveedor}: ${d}`.slice(0, 300), ms: Date.now() - t0, proveedor, model };
    }
    const textoFinal = typeof content === "string" ? content : "";
    const truncada = textoFinal.length > opts.maxChars;
    const uso: UsoSpawn = usoOpenAI(j.usage) ?? usoEstimado(prompt, textoFinal || toolCalls.map((tc) => tc.arguments).join(" "));
    return { ok: true, text: truncada ? textoFinal.slice(0, opts.maxChars) : textoFinal, ms: Date.now() - t0, proveedor, model, truncada, uso, toolCalls } as SpawnResult & { toolCalls?: ToolCallNativo[] };
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
