// Único punto de lectura de la clave de EXA (tool de búsqueda y servidor web).
// Vive aparte de `index.ts` para que quien solo necesita la clave —el aviso del
// plan y la ruta de búsqueda de la web— no arrastre la tool ni el grafo de agentes.
import { ENV, valorEnv } from "../../env.js";

export const EXA_ENV = ENV.EXA_API_KEY;

/**
 * Valor recortado de la clave, o "" si no está definida. Se lee solo del entorno
 * del servidor: `EXA_ENV` no está en `SECRET_KEYS`, así que el archivo de
 * secretos del proyecto no puede contenerla (`/api/secrets` la rechaza con 400 y
 * `readSecrets` filtra por esa lista).
 */
export function claveExa(): string {
  return valorEnv(EXA_ENV) ?? "";
}

/** Presencia de la clave, sin exponerla. Sin key no hay búsqueda posible. */
export function hayClaveExa(): boolean {
  return claveExa().length > 0;
}
