// Arnés de FileSystem real — escribe solo dentro del root del proyecto.
// Resuelve la ruta con path.resolve + path.normalize y rechaza todo lo que
// escape (../, absoluta fuera del root, vacía). Crea el árbol con mkdirSync
// recursivo y escribe con writeFileSync.
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

export function resolverSeguro(root: string, ruta: string): string {
  if (!ruta || !ruta.trim()) throw new Error("ruta vacía: nada que escribir");
  const raiz = normalize(resolve(root));
  const abs = normalize(resolve(raiz, ruta));
  const rel = relative(raiz, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${"/"}`) || isAbsolute(rel)) {
    throw new Error(`path traversal bloqueado: ${ruta} escapa del proyecto`);
  }
  return abs;
}

export interface Escritura {
  rutaAbs: string;
  bytes: number;
}

export function escribirArchivo(root: string, ruta: string, contenido: string): Escritura {
  const abs = resolverSeguro(root, ruta);
  const dir = dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, contenido, "utf8");
  return { rutaAbs: abs, bytes: Buffer.byteLength(contenido, "utf8") };
}
