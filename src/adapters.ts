// Compat: adapters vive en src/modules/adapters/.
// Este archivo solo re-exporta para no romper imports existentes.
export { configText, usarProveedor, ponerModelo, ponerUrl, ponerTimeoutMs, ponerMaxChars, spawn, formatSpawn, baseUrlDe, litellmKeyFromEnv, loadConfig, modelosPara, modelosOpenRouter, keyPara } from "./modules/adapters/index.js";
export { listarModelos } from "./modules/adapters/route.js";
export type { FiltroModelos, ModeloOut, ListadoModelos } from "./modules/adapters/route.js";
export type { SpawnResult } from "./modules/adapters/index.js";
