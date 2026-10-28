// Tool `buscar` — búsqueda externa para enriquecer (enrich) al agente.
// Varios agentes del roster la declaran pero nada la ejecutaba: este módulo
// es el ejecutor. EXA server-side (la key nunca sale del servidor), timeout
// y tope de resultados; fail closed sin key. La autorización vive en el
// broker con contrato openWorld (riesgo alto: ask por defecto, nunca auto).
import { readSecrets } from "../../secrets.js";
import { autorizarUso } from "../agents/ejecucion.js";
import type { ToolContract } from "../../contracts.js";

export const BUSCAR_CONTRACT: ToolContract = {
  name: "buscar",
  description: "Busca referencias externas (EXA) para enriquecer el prompt del agente. Solo lectura de resultados acotados.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export interface ResultadoBusqueda {
  titulo: string;
  url: string;
  snippet: string;
}

export interface OpcionesBusqueda {
  maxResultados?: number;
  timeoutMs?: number;
  /** Solo tests: sustituye el fetch a EXA (sin red). */
  fetchFn?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

const MAX_RESULTADOS_DEFECTO = 5;
const MAX_RESULTADOS_TOPE = 10;
const TIMEOUT_DEFECTO = 15000;
const MAX_SNIPPET = 500;

export async function buscarExterno(root: string, consulta: string, opts: OpcionesBusqueda = {}): Promise<ResultadoBusqueda[]> {
  if (!consulta?.trim()) throw new Error("buscarExterno: consulta vacía");
  const key = (process.env.EXA_API_KEY ?? "").trim() || readSecrets(root).EXA_API_KEY;
  if (!key) throw new Error("buscarExterno: sin EXA_API_KEY (fail closed: define la key en el entorno o en Configuración)");
  const n = Math.min(Math.max(opts.maxResultados ?? MAX_RESULTADOS_DEFECTO, 1), MAX_RESULTADOS_TOPE);
  const hacer = opts.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_DEFECTO);
  try {
    const r = await (hacer as typeof fetch)("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query: consulta.slice(0, 500),
        numResults: n,
        contents: { text: { maxCharacters: 1200 }, highlights: { numSentences: 3, highlightsPerUrl: 2 } },
      }),
      signal: ctrl.signal,
    } as Parameters<typeof fetch>[1]);
    if (!r.ok) throw new Error(`buscarExterno: EXA HTTP ${(r as Response).status}`);
    const j = (await r.json()) as { results?: { title?: unknown; url?: unknown; text?: unknown; highlights?: unknown }[] };
    return (j.results ?? []).slice(0, n).map((x) => {
      // Highlights primero (concisos y ajustados a relevancia); texto crudo si no hay.
      const hl = Array.isArray(x.highlights) ? x.highlights.filter((h) => typeof h === "string").join(" … ") : "";
      const snippet = (hl || String(x.text ?? "")).slice(0, MAX_SNIPPET);
      return {
        titulo: String(x.title ?? "(sin título)").slice(0, 160),
        url: String(x.url ?? "").slice(0, 300),
        snippet,
      };
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("buscarExterno: timeout de EXA");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Enrich para el modo Plan: antepone referencias al prompt cuando el broker
 * lo permite; si no, devuelve nota (sin secretos) para que el plan salga
 * igual que hoy pero avisando. Best-effort: nunca lanza.
 */
export async function enriquecerPromptPlan(
  root: string,
  consulta: string,
  opts: OpcionesBusqueda & { por?: string; agenteId?: string } = {},
): Promise<{ contexto: string; nota?: string }> {
  try {
    const r = await enriquecerConBusqueda(root, opts.agenteId ?? "planificador", consulta, opts);
    if (r.estado === "ok" && r.contexto) return { contexto: `\n\n${r.contexto}` };
    if (r.estado === "pendiente") {
      return { contexto: "", nota: `búsqueda externa pendiente de aprobación (${r.approvalId}): el plan sale sin referencias` };
    }
    if (r.estado === "denegado") return { contexto: "", nota: `sin referencias externas: ${r.motivo}` };
    return { contexto: "" };
  } catch (e) {
    return { contexto: "", nota: `enrich no disponible: ${e instanceof Error ? e.message : e}` };
  }
}

export type Enriquecimiento =
  | { estado: "ok"; contexto: string; resultados: ResultadoBusqueda[] }
  | { estado: "pendiente"; approvalId: string; motivo: string }
  | { estado: "denegado"; motivo: string };

/**
 * Enrich gateado: autoriza `buscar` del agente en el broker y, si es allow,
 * busca y devuelve el bloque de contexto listo para anteponer al prompt. Con
 * ask devuelve el approvalId sin tocar la red; con deny o sin key, motivo.
 */
export async function enriquecerConBusqueda(
  root: string,
  agenteId: string,
  consulta: string,
  opts: OpcionesBusqueda & { por?: string } = {},
): Promise<Enriquecimiento> {
  const uso = autorizarUso(root, agenteId, "buscar", BUSCAR_CONTRACT, opts.por ?? `enrich ${agenteId}`);
  if (uso.decision === "deny") return { estado: "denegado", motivo: uso.motivo };
  if (uso.decision === "ask") {
    return { estado: "pendiente", approvalId: uso.id ?? "", motivo: `${uso.motivo}${uso.id ? ` (aprobación ${uso.id})` : ""}` };
  }
  try {
    const resultados = await buscarExterno(root, consulta, opts);
    if (!resultados.length) return { estado: "ok", contexto: "", resultados };
    const contexto = ["--- referencias externas (EXA) ---", ...resultados.map((r, i) => `[${i + 1}] ${r.titulo}\n${r.url}\n${r.snippet}`)].join("\n");
    return { estado: "ok", contexto, resultados };
  } catch (e) {
    return { estado: "denegado", motivo: e instanceof Error ? e.message : String(e) };
  }
}
