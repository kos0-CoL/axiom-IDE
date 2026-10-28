// Nodo Coder — generación unitaria por archivo. El system prompt prohíbe
// delimitadores markdown, saludos e introducciones: la respuesta debe ser
// exclusivamente código fuente en texto plano (raw string), para no quemar
// el límite de tokens. La llamada al LLM la inyecta quien use el prompt
// (el orquestador recibe `generarCodigo` ya resuelto).
export const SYSTEM_PROMPT_CODER = [
  "Eres un generador de código. Respondes EXCLUSIVAMENTE con código fuente en texto plano.",
  "PROHIBIDO: bloques ```markdown, saludos, introducciones, explicaciones, resúmenes o texto conversacional.",
  "Si no puedes generar el código, responde una sola línea que empiece por ERROR: y nada más.",
  "El código debe estar completo y sin truncar.",
].join("\n");

export interface PromptCoder {
  system: string;
  user: string;
}

export function promptCoder(rutaObjetivo: string, spec: string): PromptCoder {
  return {
    system: SYSTEM_PROMPT_CODER,
    user: `Archivo objetivo: ${rutaObjetivo}\n\nEspecificación vigente:\n${spec}\n\nGenera el contenido completo del archivo. Solo código, sin nada más.`,
  };
}
