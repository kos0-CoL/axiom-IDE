// Spec checklist — Single Source of Truth en Markdown (.speckit/*.md).
// Lee `- [ ] ruta/del/archivo.ext` y marca `- [X]` de forma idempotente con
// regex anclada a la línea exacta: ni colisiones con nombres parecidos
// ("a/b.ts" nunca toca a "a/b.ts.bak") ni dobles marcados.
export interface TareaSpec {
  ruta: string;
  hecha: boolean;
  linea: number;
}

const LINEA_TAREA = /^[ \t]*- \[( |x|X)\][ \t]+(.+?)[ \t]*$/;

export function leerChecklist(markdown: string): TareaSpec[] {
  const tareas: TareaSpec[] = [];
  const lineas = markdown.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const m = LINEA_TAREA.exec(lineas[i]);
    if (!m) continue;
    tareas.push({ ruta: m[2], hecha: m[1] !== " ", linea: i });
  }
  return tareas;
}

/** Próximas tareas en orden FIFO (las no hechas, en orden de aparición). */
export function pendientes(markdown: string): TareaSpec[] {
  return leerChecklist(markdown).filter((t) => !t.hecha);
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ResultadoMarca {
  markdown: string;
  changed: boolean;
}

/**
 * Marca `- [X]` la línea exacta de `ruta`. Idempotente: si ya está marcada
 * o la ruta no existe, devuelve el texto intacto con `changed: false`.
 */
export function marcarHecha(markdown: string, ruta: string): ResultadoMarca {
  const patron = new RegExp(`^([ \\t]*- \\[) \\]([ \\t]+${escaparRegex(ruta)}[ \\t]*)$`, "m");
  if (!patron.test(markdown)) return { markdown, changed: false };
  return { markdown: markdown.replace(patron, "$1X]$2"), changed: true };
}
