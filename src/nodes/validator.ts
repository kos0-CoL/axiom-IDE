// Nodo Validator — análisis estático del código del coder. Rechaza:
// 1) string vacío o bajo el umbral mínimo de bytes,
// 2) código truncado (paréntesis, llaves o corchetes sin cerrar),
// 3) markdown filtrado (```) o texto conversacional de la IA.
export interface ResultadoValidacion {
  ok: boolean;
  errores: string[];
}

const MIN_BYTES_DEFECTO = 16;

// Saludos/explicaciones típicas al inicio de línea (es/en), insensible a caso.
const CONVERSACIONAL =
  /^(hola|aqu[íi] tienes|aqu[íi] est[áa]|claro|por supuesto|espero que|listo|perfecto|como (ia|modelo de lenguaje)|soy una ia|here('s| is)|sure|of course|certainly|here you go)\b/im;

export function validarCodigo(codigo: string, minBytes = MIN_BYTES_DEFECTO): ResultadoValidacion {
  const errores: string[] = [];
  if (!codigo || Buffer.byteLength(codigo, "utf8") < minBytes) {
    errores.push(`código vacío o bajo el umbral (${minBytes} bytes)`);
    return { ok: false, errores };
  }
  if (codigo.includes("```")) errores.push("contiene delimitadores markdown (```)");
  if (CONVERSACIONAL.test(codigo)) errores.push("contiene texto conversacional de la IA");
  const desbalance = primerDesbalance(codigo);
  if (desbalance) errores.push(`código posiblemente truncado: ${desbalance}`);
  return { ok: errores.length === 0, errores };
}

/** Primer desbalance de (), {}, [] ignorando strings y comentarios. */
function primerDesbalance(src: string): string | null {
  const pila: { c: string; pos: number }[] = [];
  const parejas: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let estado: "codigo" | "linea" | "bloque" | "sq" | "dq" | "bt" = "codigo";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const sig = src[i + 1] ?? "";
    if (estado === "codigo") {
      if (c === "/" && sig === "/") { estado = "linea"; i++; continue; }
      if (c === "/" && sig === "*") { estado = "bloque"; i++; continue; }
      if (c === "'") { estado = "sq"; continue; }
      if (c === '"') { estado = "dq"; continue; }
      if (c === "`") { estado = "bt"; continue; }
      if (c === "(" || c === "[" || c === "{") pila.push({ c, pos: i });
      else if (c === ")" || c === "]" || c === "}") {
        const abierto = pila.pop();
        if (!abierto || abierto.c !== parejas[c]) return `cierre '${c}' sin apertura en byte ${i}`;
      }
      continue;
    }
    if (estado === "linea") { if (c === "\n") estado = "codigo"; continue; }
    if (estado === "bloque") { if (c === "*" && sig === "/") { estado = "codigo"; i++; } continue; }
    if (c === "\\") { i++; continue; }
    if ((estado === "sq" && c === "'") || (estado === "dq" && c === '"') || (estado === "bt" && c === "`")) {
      estado = "codigo";
    }
  }
  if (estado === "bloque" || estado === "sq" || estado === "dq" || estado === "bt") {
    return `literal o comentario sin cerrar (termina en estado ${estado})`;
  }
  const abierto = pila.pop();
  if (abierto) return `apertura '${abierto.c}' sin cierre (byte ${abierto.pos})`;
  return null;
}
