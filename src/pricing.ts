// Costo de una llamada al modelo, con precios declarados por el proyecto.
//
// No hay tabla incorporada a propósito: un precio inventado es peor que ninguno
// (las tarifas cambian por modelo, por tramo de cache y por proveedor), y el
// harness no debe presentar como medido algo que no lo es. Sin `pricing.json` se
// registran tokens y cache igual, y el costo queda desconocido (null).
//
// Formato de `<root>/pricing.json` — USD por 1 000 000 de tokens:
//
//   {
//     "openai/gpt-4o-mini": { "prompt": 0.15, "cacheLectura": 0.075, "respuesta": 0.60 },
//     "claude-3-5-sonnet":  { "prompt": 3, "cacheLectura": 0.30, "cacheEscritura": 3.75, "respuesta": 15 }
//   }
//
// Clave `proveedor/modelo` o `modelo` a secas. Se busca en ese orden: exacto con
// proveedor, exacto sin proveedor, y por último el prefijo más largo (para que
// `gpt-4o-mini` cubra `gpt-4o-mini-2024-07-18` sin repetir la fila).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Forma mínima del uso: el núcleo no importa el módulo de adapters (boundary),
// así que el contrato se describe acá y cualquier `SpawnResult` encaja por
// estructura sin acoplarse a su archivo.
export interface UsoPrecio {
  prompt: number;
  respuesta: number;
  total?: number;
  fuente?: string;
  cacheLectura?: number;
  cacheEscritura?: number;
  costoUsd?: number;
}

export interface PrecioModelo {
  /** USD por 1M de tokens de entrada no cacheados. */
  prompt: number;
  /** USD por 1M de tokens de salida. */
  respuesta: number;
  /** USD por 1M de tokens leídos de cache. Sin valor: se cobra como `prompt`. */
  cacheLectura?: number;
  /** USD por 1M de tokens escritos en cache. Sin valor: se cobra como `prompt`. */
  cacheEscritura?: number;
}

export type TablaPrecios = Record<string, PrecioModelo>;

function numeroNoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Lee y valida `<root>/pricing.json`. Una tabla inválida se ignora entera. */
export function loadPrecios(root: string): TablaPrecios {
  const p = join(root, "pricing.json");
  if (!existsSync(p)) return {};
  let bruto: unknown;
  try { bruto = JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
  const tabla: TablaPrecios = {};
  for (const [clave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!valor || typeof valor !== "object") continue;
    const v = valor as Record<string, unknown>;
    if (!numeroNoNegativo(v.prompt) || !numeroNoNegativo(v.respuesta)) continue;
    const precio: PrecioModelo = { prompt: v.prompt, respuesta: v.respuesta };
    if (numeroNoNegativo(v.cacheLectura)) precio.cacheLectura = v.cacheLectura;
    if (numeroNoNegativo(v.cacheEscritura)) precio.cacheEscritura = v.cacheEscritura;
    tabla[clave] = precio;
  }
  return tabla;
}

export function precioDe(root: string, proveedor: string, model: string): PrecioModelo | undefined {
  const tabla = loadPrecios(root);
  const prov = (proveedor ?? "").toLowerCase();
  const mod = (model ?? "").toLowerCase();
  if (!mod) return undefined;
  const exacto = tabla[`${prov}/${mod}`] ?? tabla[mod];
  if (exacto) return exacto;
  let mejor: { clave: string; precio: PrecioModelo } | undefined;
  for (const [clave, precio] of Object.entries(tabla)) {
    const k = clave.toLowerCase();
    const modeloClave = k.includes("/") ? k.slice(k.indexOf("/") + 1) : k;
    if (!modeloClave || !mod.startsWith(modeloClave)) continue;
    if (!mejor || modeloClave.length > mejor.clave.length) mejor = { clave: modeloClave, precio };
  }
  return mejor?.precio;
}

/**
 * Costo en USD de un uso, o undefined si el uso no tiene precio conocido.
 * Convención de `uso.prompt`: entrada total facturable, con los tokens de cache
 * incluidos (OpenAI y Google los incluyen; Anthropic se normaliza al leerlos).
 */
export function costoUsd(uso: Pick<UsoPrecio, "prompt" | "respuesta" | "cacheLectura" | "cacheEscritura">, precio: PrecioModelo): number {
  const cacheLectura = Math.min(Math.max(uso.cacheLectura ?? 0, 0), uso.prompt);
  const cacheEscritura = Math.min(Math.max(uso.cacheEscritura ?? 0, 0), uso.prompt - cacheLectura);
  const fresco = Math.max(0, uso.prompt - cacheLectura - cacheEscritura);
  const pCacheL = precio.cacheLectura ?? precio.prompt;
  const pCacheE = precio.cacheEscritura ?? precio.prompt;
  const total = fresco * precio.prompt + cacheLectura * pCacheL + cacheEscritura * pCacheE + uso.respuesta * precio.respuesta;
  // 9 decimales: una llamada chica cuesta fracciones de centavo y redondear a
  // 6 decimales convertiría 0.0000795 en 0.00008 (o en 0 para un modelo barato).
  return Math.round((total / 1_000_000) * 1e9) / 1e9;
}

/** Adjunta `uso.costoUsd` cuando hay precio; si no, deja el resultado intacto. */
export function conCosto<T extends { ok: boolean; proveedor: string; model: string; uso?: UsoPrecio }>(root: string, r: T): T {
  if (!r.ok || !r.uso) return r;
  const precio = precioDe(root, r.proveedor, r.model);
  if (!precio) return r;
  return { ...r, uso: { ...r.uso, costoUsd: costoUsd(r.uso, precio) } } as T;
}
