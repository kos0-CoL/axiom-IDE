// Clarify estilo spec-kit — entrevista ante ambigüedad, no adivinanza.
// Detecta marcas `[NEEDS CLARIFICATION: pregunta]` en la spec, pregunta de
// una en una (máx 5 por sesión, formato Question + Why it matters + Short) y
// persiste cada respuesta en `## Clarifications` sustituyendo la marca.
// Sin marcas no toca nada. El loop interactivo vive en commands/cli;
// aquí el núcleo puro (testeable sin stdin).
export interface PreguntaClarify {
  id: string;
  pregunta: string;
  motivo: string;
  marca: string;
}

const MARCA = /\[NEEDS CLARIFICATION:\s*([^\]]+?)\]/g;
export const MAX_PREGUNTAS = 5;

/** Extrae marcas con su sección como motivo (por qué importa). */
export function extraerMarcas(spec: string): PreguntaClarify[] {
  const preguntas: PreguntaClarify[] = [];
  const lineas = spec.split("\n");
  let seccion = "la spec";
  let n = 0;
  for (const linea of lineas) {
    const h = /^##\s+(.+?)\s*$/.exec(linea.trim());
    if (h) seccion = h[1];
    let m: RegExpExecArray | null;
    MARCA.lastIndex = 0;
    const re = new RegExp(MARCA.source, "g");
    while ((m = re.exec(linea)) !== null) {
      n++;
      preguntas.push({
        id: `q${n}`,
        pregunta: m[1].trim(),
        motivo: `Afecta a «${seccion}»: sin esto el implementador adivina.`,
        marca: m[0],
      });
    }
  }
  return preguntas;
}

export function formatearPregunta(p: PreguntaClarify, n: number, total: number): string {
  return [
    `Pregunta ${n}/${total}`,
    ``,
    `**Question:** ${p.pregunta}`,
    ``,
    `Why it matters: ${p.motivo}`,
    ``,
    `Short: responde en pocas palabras, o «saltar».`,
  ].join("\n");
}

export type PreguntarClarify = (prompt: string) => Promise<string>;

export interface RespuestaAplicada {
  markdown: string;
  registrada: boolean;
  omitida: boolean;
}

/** Persiste la respuesta: sustituye la marca y la anota en ## Clarifications.
 * Con marca sintética (propuesta del proveedor, `""`) no hay nada que
 * sustituir: solo se anota la respuesta. */
export function aplicarRespuesta(spec: string, p: PreguntaClarify, respuesta: string): RespuestaAplicada {
  const r = respuesta.trim();
  if (!r || /^saltar$/i.test(r)) {
    const sesion = seccionSesion(new Date());
    const sinMarca = p.marca ? spec.replace(p.marca, "(criterio del implementador)") : spec;
    return { markdown: anotar(sinMarca, sesion, p, "(omitida: criterio del implementador)"), registrada: true, omitida: true };
  }
  const limpio = r.slice(0, 200);
  const sinMarca = p.marca ? spec.replace(p.marca, limpio) : spec;
  const sesion = seccionSesion(new Date());
  return { markdown: anotar(sinMarca, sesion, p, limpio), registrada: true, omitida: false };
}

function seccionSesion(ahora: Date): string {
  return `### Session ${ahora.toISOString().slice(0, 10)}`;
}

function anotar(spec: string, sesion: string, p: PreguntaClarify, a: string): string {
  const entrada = `- Q: ${p.pregunta} → A: ${a}`;
  if (/^## Clarifications\s*$/m.test(spec)) {
    if (spec.includes(sesion)) return spec.replace(sesion, `${sesion}\n${entrada}`);
    return spec.replace(/^## Clarifications\s*$/m, `## Clarifications\n\n${sesion}\n${entrada}`);
  }
  const base = spec.endsWith("\n") ? spec : spec + "\n";
  return `${base}\n## Clarifications\n\n${sesion}\n${entrada}\n`;
}

export interface ResultadoClarify {
  markdown: string;
  hechas: number;
  omitidas: number;
  pendientes: number;
}

/**
 * Núcleo no interactivo: aplica hasta MAX_PREGUNTAS respuestas en orden.
 * `respuestas[i]` corresponde a la i-ésima pregunta; faltantes = sin tocar.
 * Si se pasan preguntas explícitas (propuestas) se usan en vez de las marcas.
 */
export function responderLista(spec: string, preguntas: PreguntaClarify[], respuestas: string[]): ResultadoClarify {
  let markdown = spec;
  let hechas = 0;
  let omitidas = 0;
  const n = Math.min(preguntas.length, MAX_PREGUNTAS, respuestas.length);
  for (let i = 0; i < n; i++) {
    const r = aplicarRespuesta(markdown, { ...preguntas[i] }, respuestas[i]);
    markdown = r.markdown;
    hechas++;
    if (r.omitida) omitidas++;
  }
  const pendientes = preguntas.length - n;
  return { markdown, hechas, omitidas, pendientes };
}

export function responderTodas(spec: string, respuestas: string[]): ResultadoClarify {
  const marcas = extraerMarcas(spec);
  const r = responderLista(spec, marcas, respuestas);
  return { ...r, pendientes: extraerMarcas(r.markdown).length };
}

const CATEGORIAS = "alcance, roles, datos, integraciones, UX, seguridad, despliegue";

const PROMPT_PROPUESTA = (spec: string): string =>
  `Esta spec puede ser ambigua. Lista entre 3 y ${MAX_PREGUNTAS} preguntas que un implementador necesitaría aclarar antes de codificar, ` +
  `en estas categorías: ${CATEGORIAS}. Devuelve SOLO JSON válido: un array de hasta ${MAX_PREGUNTAS} objetos ` +
  `con forma {"pregunta": "...", "motivo": "..."} (pregunta corta, motivo = por qué importa). ` +
  `Sin ambigüedad real devuelve []. Sin fences ni texto externo.\n\n## Spec\n\n${spec.slice(0, 4000)}${spec.length > 4000 ? "\n…(recortada)" : ""}\n`;

/** Pregunta propuesta sin marca en la spec (marca sintética `""`). */
function propuestaComoPregunta(pregunta: string, motivo: string, n: number): PreguntaClarify {
  return { id: `auto-q${n}`, pregunta, motivo, marca: "" };
}

function esPropuestaUtil(o: unknown, vistas: Set<string>): { pregunta: string; motivo: string } | null {
  if (!o || typeof o !== "object") return null;
  const pregunta = String((o as { pregunta?: unknown }).pregunta ?? "").trim();
  let motivo = String((o as { motivo?: unknown }).motivo ?? "").trim();
  if (!pregunta || pregunta.length > 200) return null;
  const clave = pregunta.toLowerCase();
  if (vistas.has(clave)) return null;
  vistas.add(clave);
  if (!motivo) motivo = "Sin esto el implementador adivina.";
  return { pregunta, motivo: motivo.slice(0, 200) };
}

/**
 * Detección propia de ambigüedad: UNA llamada al proveedor que devuelve las
 * preguntas en JSON. Fail closed: sin respuesta válida (vacío, no-JSON,
 * sin preguntas útiles) devuelve []. Nunca lanza.
 */
export async function proponerPreguntas(spec: string, preguntar: PreguntarClarify): Promise<PreguntaClarify[]> {
  let respuesta: string;
  try {
    respuesta = await preguntar(PROMPT_PROPUESTA(spec));
  } catch {
    return [];
  }
  const limpio = respuesta.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let lista: unknown;
  try {
    lista = JSON.parse(limpio);
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const preguntas: PreguntaClarify[] = [];
  for (const o of lista) {
    if (preguntas.length >= MAX_PREGUNTAS) break;
    const util = esPropuestaUtil(o, vistas);
    if (util) preguntas.push(propuestaComoPregunta(util.pregunta, util.motivo, preguntas.length + 1));
  }
  return preguntas;
}
