// Investigar + entrevistar sobre un plan ya escrito (botón de la tarjeta del
// plan). El orden importa: primero se buscan referencias (si no hay, el
// usuario ve el motivo), después las preguntas se derivan del plan **con** esas
// referencias a la vista, y las respuestas se anotan en `## Clarifications` de
// la spec. Cada mitad sirve sola: sin búsqueda hay preguntas, y sin preguntas
// quedan las referencias escritas.
//
// La aprobación la da el clic: si el broker deja la búsqueda en `ask`, se
// aprueba y se consume en la misma llamada. Sin eso, el botón sería una promesa
// que termina pidiendo `axiom approve` a mano.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "../broker.js";
import { enriquecerConBusqueda, type Enriquecimiento, type ResultadoBusqueda } from "../modules/buscar/index.js";
import { proponerPreguntas, responderLista, type PreguntaClarify } from "../modules/clarify/index.js";
import { declaracionDeHerramienta } from "../modules/agents/declaracion.js";
import { spawn } from "../modules/adapters/index.js";

const AGENTE = "planificador";
const MAX_PREGUNTAS = 5;

export interface PreguntaPlan {
  id: string;
  pregunta: string;
  motivo: string;
}

export interface PreguntasGuardadas {
  spec_id: string;
  estado: "pendiente" | "respondida";
  referencias: number;
  creado: string;
  respondida_at?: string;
  preguntas: PreguntaPlan[];
}

export interface ResultadoInvestigar {
  ok: boolean;
  referencias: number;
  preguntas: PreguntaPlan[];
  spec: string;
  aviso?: string;
  error?: string;
}

/** La spec vive en un id que llega del cliente: sin validar, `../` escribría fuera. */
export function specValida(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function rutaSpec(root: string, specId: string): string {
  return join(root, "specs", "active", specId, "spec.md");
}

function rutaPreguntas(root: string, specId: string): string {
  return join(root, "specs", "active", specId, "preguntas.json");
}

export function leerSpec(root: string, specId: string): string | undefined {
  if (!specValida(specId)) return undefined;
  const p = rutaSpec(root, specId);
  try {
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** La consulta sale del pedido original guardado en la spec, no de una heurística. */
export function objetivoDeSpec(spec: string): string {
  const seccion = /^##\s+Objetivo solicitado\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(spec);
  const cuerpo = (seccion?.[1] ?? "").trim();
  if (cuerpo) return cuerpo.slice(0, 500);
  const titulo = /^#\s+(.+)$/m.exec(spec)?.[1]?.trim();
  return (titulo ?? "").slice(0, 500);
}

/** Reescribe la sección (idempotente) para que reintentar no duplique referencias. */
export function escribirReferencias(spec: string, resultados: ResultadoBusqueda[]): string {
  const cuerpo = resultados
    .map((r, i) => `- [${i + 1}] ${r.titulo} — ${r.url}${r.snippet ? `\n  ${r.snippet}` : ""}`)
    .join("\n");
  const seccion = `## Referencias externas\n\n${cuerpo}\n`;
  const re = /^##\s+Referencias externas\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/m;
  if (re.test(spec)) return spec.replace(re, `${seccion}\n`);
  return `${spec.endsWith("\n") ? spec : spec + "\n"}\n${seccion}`;
}

export function guardarPreguntas(root: string, specId: string, preguntas: PreguntaPlan[], referencias: number): void {
  const datos: PreguntasGuardadas = {
    spec_id: specId,
    estado: "pendiente",
    referencias,
    creado: new Date().toISOString(),
    preguntas,
  };
  writeFileSync(rutaPreguntas(root, specId), JSON.stringify(datos, null, 2), "utf8");
}

export function leerPreguntas(root: string, specId: string): PreguntasGuardadas | undefined {
  if (!specValida(specId)) return undefined;
  try {
    const p = rutaPreguntas(root, specId);
    if (!existsSync(p)) return undefined;
    const d = JSON.parse(readFileSync(p, "utf8")) as Partial<PreguntasGuardadas>;
    if (!Array.isArray(d.preguntas)) return undefined;
    const preguntas = d.preguntas
      .filter((x): x is PreguntaPlan => !!x && typeof x.pregunta === "string")
      .map((x, i) => ({ id: typeof x.id === "string" && x.id ? x.id : `q${i + 1}`, pregunta: x.pregunta, motivo: typeof x.motivo === "string" ? x.motivo : "" }));
    return {
      spec_id: specId,
      estado: d.estado === "respondida" ? "respondida" : "pendiente",
      referencias: typeof d.referencias === "number" ? d.referencias : 0,
      creado: typeof d.creado === "string" ? d.creado : "",
      respondida_at: typeof d.respondida_at === "string" ? d.respondida_at : undefined,
      preguntas,
    };
  } catch {
    return undefined;
  }
}

export interface OpcionesInvestigar {
  /** Solo tests: reemplaza la búsqueda gateada (sin red ni broker). */
  buscar?: (consulta: string) => Promise<Enriquecimiento>;
  /** Solo tests: reemplaza la llamada al proveedor que propone preguntas. */
  preguntar?: (prompt: string) => Promise<string>;
  /** Solo tests: quién figura aprobando la solicitud pendiente. */
  quien?: string;
}

/** Aprueba y consume la solicitud pendiente del clic, una sola vez. */
function aprobarPendiente(root: string, id: string, quien: string): string | undefined {
  const d = declaracionDeHerramienta(root, AGENTE, "buscar");
  const r = decide(root, id, true, quien, 30, d);
  return r.ok ? undefined : r.msg;
}

export async function investigarPlan(root: string, specId: string, opts: OpcionesInvestigar = {}): Promise<ResultadoInvestigar> {
  const spec = leerSpec(root, specId);
  const rel = `specs/active/${specId}/spec.md`;
  if (spec === undefined) return { ok: false, referencias: 0, preguntas: [], spec: rel, error: `spec inexistente o id inválido: ${specId}` };
  const consulta = objetivoDeSpec(spec);
  if (!consulta) return { ok: false, referencias: 0, preguntas: [], spec: rel, error: "la spec no tiene objetivo del cual derivar la búsqueda" };

  const buscar = opts.buscar ?? ((c: string) => enriquecerConBusqueda(root, AGENTE, c, { por: `plan ${specId}` }));
  let r = await buscar(consulta);
  let aviso: string | undefined;
  if (r.estado === "pendiente") {
    const fallo = aprobarPendiente(root, r.approvalId, opts.quien ?? "chat");
    if (fallo) return { ok: false, referencias: 0, preguntas: [], spec: rel, error: `no se pudo aprobar la búsqueda: ${fallo}` };
    r = await buscar(consulta);
  }
  if (r.estado === "denegado") return { ok: false, referencias: 0, preguntas: [], spec: rel, error: `sin referencias externas: ${r.motivo}` };

  let specActual = spec;
  let referencias = 0;
  if (r.estado === "ok" && r.resultados.length) {
    referencias = r.resultados.length;
    specActual = escribirReferencias(spec, r.resultados);
    writeFileSync(rutaSpec(root, specId), specActual, "utf8");
  } else {
    aviso = "la búsqueda no devolvió resultados: las preguntas salen solo del plan";
  }

  const preguntar = opts.preguntar ?? (async (prompt: string) => {
    const s = await spawn(root, prompt, { maxChars: 2000, timeoutMs: 60000 });
    if (!s.ok) throw new Error(s.error ?? "el proveedor no respondió");
    return s.text ?? "";
  });
  const propuestas = (await proponerPreguntas(specActual, preguntar)).slice(0, MAX_PREGUNTAS);
  const preguntas: PreguntaPlan[] = propuestas.map((p, i) => ({ id: `q${i + 1}`, pregunta: p.pregunta, motivo: p.motivo }));
  if (preguntas.length) guardarPreguntas(root, specId, preguntas, referencias);
  return { ok: true, referencias, preguntas, spec: rel, aviso };
}

export interface RespuestaPlan {
  id?: string;
  respuesta: string;
}

export interface ResultadoRespuestas {
  ok: boolean;
  respondidas: number;
  omitidas: number;
  spec: string;
  error?: string;
}

export function aplicarRespuestas(root: string, specId: string, respuestas: RespuestaPlan[]): ResultadoRespuestas {
  const rel = `specs/active/${specId}/spec.md`;
  const guardadas = leerPreguntas(root, specId);
  const spec = leerSpec(root, specId);
  if (spec === undefined) return { ok: false, respondidas: 0, omitidas: 0, spec: rel, error: `spec inexistente o id inválido: ${specId}` };
  if (!guardadas || !guardadas.preguntas.length) return { ok: false, respondidas: 0, omitidas: 0, spec: rel, error: "no hay preguntas guardadas para esta spec" };
  if (guardadas.estado === "respondida") return { ok: false, respondidas: 0, omitidas: 0, spec: rel, error: "estas preguntas ya fueron respondidas" };
  const porId = new Map(respuestas.filter((x) => typeof x?.respuesta === "string").map((x) => [String(x.id ?? ""), x.respuesta]));
  const preguntas: PreguntaClarify[] = guardadas.preguntas.map((p) => ({ id: p.id, pregunta: p.pregunta, motivo: p.motivo, marca: "" }));
  const textos = preguntas.map((p, i) => porId.get(p.id) ?? respuestas[i]?.respuesta ?? "");
  const r = responderLista(spec, preguntas, textos);
  writeFileSync(rutaSpec(root, specId), r.markdown, "utf8");
  const datos: PreguntasGuardadas = { ...guardadas, estado: "respondida", respondida_at: new Date().toISOString() };
  writeFileSync(rutaPreguntas(root, specId), JSON.stringify(datos, null, 2), "utf8");
  return { ok: true, respondidas: r.hechas, omitidas: r.omitidas, spec: rel };
}
