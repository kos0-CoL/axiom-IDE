// Staging (F10, de harness2 jb_opencode_runner): allowlist de rutas del workspace.
// Separa artefactos (archivos) de veredictos (SQLite): verify declara qué archivos
// cubre la evidencia y lo valida contra el allow antes de firmar.
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { openDb } from "./store.js";

export const ALLOW_DEFECTO = ["specs/**", "docs/**", ".specify/**", "src/**", "*.json", "*.md"];

const SKIP_DIRS = new Set([
  "node_modules", "dist", "dist-test", ".git", ".wrangler", ".vscode", ".idea",
  "coverage", ".nyc_output", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "scripts", "test", "tests", "__tests__", "__mocks__", "mocks", "fixtures",
  "tmp", "temp", ".tmp", ".temp", "logs", "log", ".cache", "cache"
]);
const SKIP_FILES = new Set([
  ".axiom-secrets.json", ".env", ".env.local", ".env.production", ".env.development",
  "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "tsconfig.tsbuildinfo", ".eslintrc", ".prettierrc", ".editorconfig",
  ".gitignore", ".gitattributes", ".dockerignore", "docker-compose.yml",
  "README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md"
]);

export function leerAllow(root: string): string[] {
  try {
    const j = JSON.parse(readFileSync(join(root, "project.json"), "utf8")) as { allow?: unknown };
    if (!Array.isArray(j.allow) || !j.allow.length) return ALLOW_DEFECTO;
    const lista = j.allow.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64 && !x.includes(".."));
    return lista.length ? lista.slice(0, 32) : ALLOW_DEFECTO;
  } catch {
    return ALLOW_DEFECTO;
  }
}

// Glob mínimo: sin "/" casa por basename; con "/" desde raíz (* = segmento, ** = profundidad).
export function matchAllow(rel: string, allow: string[]): boolean {
  const r = rel.split(sep).join("/");
  if (!r || r.startsWith("/") || r.includes("..")) return false;
  for (const p of allow) {
    if (!p.includes("/")) {
      const base = r.split("/").pop() ?? "";
      if (casaSegmento(base, p)) return true;
      continue;
    }
    const rp = p.split("/");
    const rs = r.split("/");
    if (casaRuta(rs, rp)) return true;
  }
  return false;
}

function casaSegmento(nombre: string, patron: string): boolean {
  const rx = `^${patron.split("*").map(escRx).join("[^/]*")}$`;
  return new RegExp(rx).test(nombre);
}

function escRx(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function casaRuta(segs: string[], pats: string[]): boolean {
  if (!pats.length) return segs.length === 0;
  if (pats[0] === "**") {
    for (let i = 0; i <= segs.length; i++) if (casaRuta(segs.slice(i), pats.slice(1))) return true;
    return false;
  }
  if (!segs.length) return false;
  if (!casaSegmento(segs[0], pats[0])) return false;
  return casaRuta(segs.slice(1), pats.slice(1));
}

function caminar(root: string, dir: string, allow: string[], fuera: string[]): void {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      caminar(root, join(dir, e.name), allow, fuera);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name) || e.name.endsWith(".db")) continue;
      const rel = relative(root, join(dir, e.name));
      if (!rel || rel.startsWith("..")) continue;
      if (!matchAllow(rel, allow)) fuera.push(rel.split(sep).join("/"));
    }
  }
}

// Archivos del workspace fuera del allow (separación artefactos-vs-veredictos).
export function archivosFueraDeAllow(root: string, allow?: string[]): string[] {
  const a = allow ?? leerAllow(root);
  const fuera: string[] = [];
  caminar(root, root, a, fuera);
  return fuera.sort().slice(0, 50);
}

// Valida la lista declarada por `verify --archivos`: existen y están en allow.
export function validarArchivos(root: string, lista: string[]): { ok: boolean; fuera: string[] } {
  const a = leerAllow(root);
  const fuera: string[] = [];
  for (const f of lista) {
    const rel = f.trim().replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || rel.includes("..")) {
      fuera.push(`${f} (ruta inválida)`);
      continue;
    }
    let esArchivo = false;
    try {
      esArchivo = lstatSync(join(root, rel)).isFile();
    } catch {
      esArchivo = false;
    }
    if (!esArchivo) {
      fuera.push(`${rel} (no existe o no es archivo)`);
      continue;
    }
    if (!matchAllow(rel, a)) fuera.push(`${rel} (fuera de allowlist)`);
  }
  return { ok: fuera.length === 0, fuera };
}

export function textoAllow(root: string): string {
  return `allowlist (${leerAllow(root).join(", ")})`;
}

export function motivoPatron(patron: string): string | null {
  const p = patron.trim();
  if (!p) return "patrón vacío";
  if (p.length > 64) return "máximo 64 caracteres";
  if (p.includes("..")) return "sin .. (fuera de la raíz)";
  if (p.startsWith("/")) return "ruta relativa, sin / inicial";
  return null;
}

function leerProyecto(root: string): Record<string, unknown> {
  try {
    const j = JSON.parse(readFileSync(join(root, "project.json"), "utf8")) as Record<string, unknown>;
    if (j !== null && typeof j === "object") return j;
  } catch { /* ausente o ilegible: se crea */ }
  return {};
}

export function agregarAllow(root: string, patron: string): { ok: boolean; msg: string } {
  const p = patron.trim();
  const mal = motivoPatron(p);
  if (mal) return { ok: false, msg: `patrón inválido: ${mal}` };
  const actual = leerAllow(root);
  if (actual.includes(p)) return { ok: false, msg: `ya está en la allowlist: ${p}` };
  if (actual.length >= 32) return { ok: false, msg: "máximo 32 patrones" };
  const j = leerProyecto(root);
  j.allow = [...actual, p];
  try {
    writeFileSync(join(root, "project.json"), JSON.stringify(j, null, 2));
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, msg: `allow +${p}` };
}

export function quitarAllow(root: string, patron: string): { ok: boolean; msg: string } {
  const p = patron.trim();
  if (!p) return { ok: false, msg: "patrón vacío" };
  const actual = leerAllow(root);
  if (!actual.includes(p)) return { ok: false, msg: `no está en la allowlist: ${p}` };
  const j = leerProyecto(root);
  j.allow = actual.filter((x) => x !== p);
  try {
    writeFileSync(join(root, "project.json"), JSON.stringify(j, null, 2));
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, msg: `allow -${p}` };
}

export function resetAllow(root: string): { ok: boolean; msg: string } {
  const j = leerProyecto(root);
  j.allow = [...ALLOW_DEFECTO];
  try {
    writeFileSync(join(root, "project.json"), JSON.stringify(j, null, 2));
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, msg: `allow restablecida (${ALLOW_DEFECTO.length} patrones)` };
}

// Columna archivos en evidences (migración best-effort, como broker.decide).
export function asegurarColumnaArchivos(root: string): void {
  try {
    const db = openDb(root);
    try {
      db.exec("ALTER TABLE evidences ADD COLUMN archivos TEXT DEFAULT ''");
    } catch {
      /* ya existe */
    }
    db.close();
  } catch {
    /* mejor esfuerzo */
  }
}
