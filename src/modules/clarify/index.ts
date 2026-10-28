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

export interface RespuestaAplicada {
  markdown: string;
  registrada: boolean;
  omitida: boolean;
}

/** Persiste la respuesta: sustituye la marca y la anota en ## Clarifications. */
export function aplicarRespuesta(spec: string, p: PreguntaClarify, respuesta: string): RespuestaAplicada {
  const r = respuesta.trim();
  if (!r || /^saltar$/i.test(r)) {
    const sesion = seccionSesion(new Date());
    const sinMarca = spec.replace(p.marca, "(criterio del implementador)");
    return { markdown: anotar(sinMarca, sesion, p, "(omitida: criterio del implementador)"), registrada: true, omitida: true };
  }
  const limpio = r.slice(0, 200);
  const sinMarca = spec.replace(p.marca, limpio);
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
 * `respuestas[i]` corresponde a la i-ésima marca; faltantes = sin tocar.
 */
export function responderTodas(spec: string, respuestas: string[]): ResultadoClarify {
  const marcas = extraerMarcas(spec);
  let markdown = spec;
  let hechas = 0;
  let omitidas = 0;
  const n = Math.min(marcas.length, MAX_PREGUNTAS, respuestas.length);
  for (let i = 0; i < n; i++) {
    const r = aplicarRespuesta(markdown, { ...marcas[i] }, respuestas[i]);
    markdown = r.markdown;
    hechas++;
    if (r.omitida) omitidas++;
  }
  const pendientes = extraerMarcas(markdown).length;
  return { markdown, hechas, omitidas, pendientes };
}
