// Único lugar del servidor que lee `process.env`.
//
// Antes cada dominio tocaba el entorno a su manera: `secrets.ts` recortaba una
// clave, `transport.ts` recortaba otra, `browser` leía la misma variable tres
// veces en una expresión. Nada de eso rompe, pero las diferencias sí: un lector
// que no recorta y otro que sí aceptan valores distintos para la misma clave, y
// un lector que consulta el archivo de secretos mientras otro no. Acá hay una
// sola forma: valor recortado, y vacío cuenta como ausente.
//
// `test/env-lectura-unica.test.ts` falla si aparece un `process.env` fuera de
// este archivo, así que la regla no depende de que alguien la recuerde.
export const ENV = {
  AXIOM_TELEGRAM_BOT_TOKEN: "AXIOM_TELEGRAM_BOT_TOKEN",
  AXIOM_TELEGRAM_WEBHOOK_SECRET: "AXIOM_TELEGRAM_WEBHOOK_SECRET",
  AXIOM_LITELLM_KEY: "AXIOM_LITELLM_KEY",
  OPENAI_API_KEY: "OPENAI_API_KEY",
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  GOOGLE_API_KEY: "GOOGLE_API_KEY",
  OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
  EXA_API_KEY: "EXA_API_KEY",
  PLAYWRIGHT_BROWSERS_PATH: "PLAYWRIGHT_BROWSERS_PATH",
  PATH: "PATH",
  HOME: "HOME",
  AXIOM_SERVE_REBUILT: "AXIOM_SERVE_REBUILT",
} as const;

/** Valor recortado, o `undefined` si no está definido o quedó vacío. */
export function valorEnv(nombre: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = (env[nombre] ?? "").trim();
  return v === "" ? undefined : v;
}

/** Presencia, sin exponer el valor. */
export function hayEnv(nombre: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return valorEnv(nombre, env) !== undefined;
}

/**
 * Copia del entorno para lanzar un proceso hijo. Existe para que quien necesite
 * pasarlo completo (serve se re-ejecuta a sí mismo) no tenga que tocar
 * `process.env` y salte el guardia.
 */
export function copiaEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}
