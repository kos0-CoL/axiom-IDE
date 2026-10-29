// Guardia de vocabulario (ADR-0007): la orquestación de Axiom es un supervisor
// jerárquico con handoffs auditados, no un swarm. Un doc que afirme lo contrario
// desorienta a quien vaya a extender el grafo: esperaría emergencia donde hay
// aristas declaradas y un broker que decide cada uso.
//
// No es un grep de la palabra. «swarm» aparece legítimamente al citar AutoGen,
// OpenAI Swarm o la definición académica de enjambre. Lo que se persigue es la
// **afirmación sobre el producto**: sujeto del producto en la misma oración,
// sin negación inmediatamente antes de la palabra. «Axiom es un supervisor…,
// no un swarm» pasa; «Axiom es un swarm» falla.
//
// Las oraciones se arman juntando las líneas envueltas del párrafo: un corte a
// 80 columnas deja «Axiom» en una línea y «swarm» en la siguiente, y ahí un
// chequeo por línea no vería nada.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ViolacionVocabulario {
  linea: number;
  oracion: string;
}

const ENJAMBRE = /\b(swarm|swarms|enjambre|enjambres)\b/i;
// Sujetos que hablan del producto; no de terceros (AutoGen, OpenAI Swarm…).
const SUJETO = /\b(axiom|nuestros agentes|nuestra orquestaci[oó]n|nuestro sistema|este harness)\b/i;
// Negación/contraste admisible justo antes de la palabra: es la diferencia
// entre nombrar la topología y equivocarse de topología.
const NEGACION = /\b(no|ni|nunca|jam[aá]s)\b|en vez de|en lugar de|lejos de|a diferencia de|≠/;
const VENTANA = 45;
const IGNORAR = new Set(["node_modules", ".git", ".recovery", "dist", "dist-test", "specs", "skills"]);

/** Quita lo que no es prosa: cercas, código en línea, URLs y comentarios HTML. */
function limpiar(linea: string): string {
  return linea
    .replace(/`[^`]*`/g, " ")
    .replace(/<https?:\/\/[^>]*>/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** Párrafos (con las líneas envueltas unidas), títulos y filas de tabla. */
export function oracionesDeMarkdown(texto: string): { linea: number; oracion: string }[] {
  const salida: { linea: number; oracion: string }[] = [];
  const lineas = texto.split("\n");
  let enCerca = false;
  let buffer: string[] = [];
  let inicio = 0;

  const volcar = (): void => {
    if (!buffer.length) return;
    const parrafo = buffer.join(" ").replace(/\s+/g, " ").trim();
    buffer = [];
    if (!parrafo) return;
    for (const oracion of parrafo.split(/(?<=[.!?…])\s+/)) {
      if (oracion.trim()) salida.push({ linea: inicio, oracion: oracion.trim() });
    }
  };

  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i];
    if (/^\s*(```|~~~)/.test(cruda)) {
      enCerca = !enCerca;
      volcar();
      continue;
    }
    if (enCerca) continue;
    const textoLimpio = limpiar(cruda).trim();
    const suelta = /^(#{1,6}\s|\||>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(cruda.trim());
    if (!textoLimpio) {
      volcar();
      continue;
    }
    if (suelta) {
      // Título, fila de tabla, cita o ítem: su propia unidad, sin arrastrar
      // el párrafo anterior.
      volcar();
      salida.push({ linea: i + 1, oracion: textoLimpio });
      continue;
    }
    if (!buffer.length) inicio = i + 1;
    buffer.push(textoLimpio);
  }
  volcar();
  return salida;
}

/** Afirmaciones sobre Axiom que lo describen como swarm, sin contraste. */
export function revisarVocabulario(texto: string): ViolacionVocabulario[] {
  const fallos: ViolacionVocabulario[] = [];
  for (const { linea, oracion } of oracionesDeMarkdown(texto)) {
    if (!SUJETO.test(oracion)) continue;
    const m = ENJAMBRE.exec(oracion);
    if (!m) continue;
    const antes = oracion.slice(Math.max(0, m.index - VENTANA), m.index).toLowerCase();
    if (NEGACION.test(antes)) continue;
    fallos.push({ linea, oracion });
  }
  return fallos;
}

/** Docs del repo que se vigilan: raíz y docs/, sin seeds ni artefactos. */
export function documentosDelRepo(root: string): string[] {
  const docs: string[] = [];
  const recorrer = (dir: string): void => {
    for (const nombre of readdirSync(dir)) {
      if (IGNORAR.has(nombre)) continue;
      const p = join(dir, nombre);
      const st = statSync(p);
      if (st.isDirectory()) recorrer(p);
      else if (nombre.endsWith(".md")) docs.push(p);
    }
  };
  for (const nombre of readdirSync(root)) {
    if (IGNORAR.has(nombre) || !nombre.endsWith(".md")) continue;
    docs.push(join(root, nombre));
  }
  const docsDir = join(root, "docs");
  try {
    if (statSync(docsDir).isDirectory()) recorrer(docsDir);
  } catch { /* repo sin docs/: no hay nada que vigilar ahí */ }
  return docs.sort();
}

export function revisarDocumento(ruta: string): ViolacionVocabulario[] {
  return revisarVocabulario(readFileSync(ruta, "utf8"));
}
