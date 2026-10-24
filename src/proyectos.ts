import { homedir } from "node:os";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDb } from "./store.js";

// Proyectos = carpetas en el servidor, cada una con su propio store.SQLite.
// La web crea la carpeta (specs, políticas, SQLite) y cambia a ella sin reiniciar.

const RECIENTES_FILE = ".axiom-recientes.json";
const MAX_RECIENTES = 10;

export function baseProyectos(): string {
  return homedir();
}

function recientesPath(): string {
  return join(homedir(), RECIENTES_FILE);
}

export function leerRecientes(): string[] {
  try {
    const j = JSON.parse(readFileSync(recientesPath(), "utf8")) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_RECIENTES);
  } catch {
    return [];
  }
}

export function recordar(path: string): string[] {
  const lista = [path, ...leerRecientes().filter((x) => x !== path)].slice(0, MAX_RECIENTES);
  try {
    writeFileSync(recientesPath(), JSON.stringify(lista, null, 2) + "\n", { mode: 0o600 });
  } catch {
    /* mejor esfuerzo */
  }
  return lista;
}

export function validarRutaProyecto(p: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof p !== "string" || !p.trim()) return { ok: false, error: "ruta requerida" };
  const abs = resolve(p.trim());
  if (!existsSync(abs)) return { ok: false, error: `la carpeta no existe en el servidor: ${abs}` };
  try {
    if (!lstatSync(abs).isDirectory()) return { ok: false, error: `no es una carpeta: ${abs}` };
  } catch {
    return { ok: false, error: `ruta ilegible: ${abs}` };
  }
  return { ok: true, path: abs };
}

// Crea el esqueleto mínimo sin pisar nada existente (idempotente).
// Lo usan crear (carpeta nueva) y usar (carpeta existente sin inicializar).
export function asegurarProyecto(path: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(join(path, "specs", "active"), { recursive: true });
    mkdirSync(join(path, "docs", "decisions"), { recursive: true });
    const ponDefecto = (rel: string, contenido: string): void => {
      const f = join(path, rel);
      if (!existsSync(f)) writeFileSync(f, contenido);
    };
    const nom = path.split("/").filter(Boolean).pop() ?? "proyecto";
    ponDefecto("axiom.json", JSON.stringify({ name: nom, harness: "0.9.21", preset: "axiom" }, null, 2) + "\n");
    ponDefecto(
      "policies.global.json",
      JSON.stringify({ tools: { terminal: false }, techo: { rondas: 3, tokens: 100000, calls: 500 } }, null, 2) + "\n",
    );
    ponDefecto(
      "project.json",
      JSON.stringify({ tools: {}, presupuesto: { tokens: 50000, calls: 200 } }, null, 2) + "\n",
    );
    const db = openDb(path);
    db.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `no se pudo inicializar: ${e instanceof Error ? e.message : e}` };
  }
}

export function crearProyecto(
  base: unknown,
  nombre: unknown,
): { ok: true; path: string } | { ok: false; error: string } {
  const nom = typeof nombre === "string" ? nombre.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(nom)) {
    return { ok: false, error: "nombre inválido: letras, números, - y _ (1-64, empieza con letra o número)" };
  }
  const b = typeof base === "string" && base.trim() ? base.trim() : homedir();
  const baseAbs = resolve(b);
  if (!existsSync(baseAbs)) return { ok: false, error: `la carpeta base no existe en el servidor: ${baseAbs}` };
  try {
    if (!lstatSync(baseAbs).isDirectory()) return { ok: false, error: `la base no es una carpeta: ${baseAbs}` };
  } catch {
    return { ok: false, error: `base ilegible: ${baseAbs}` };
  }
  const path = join(baseAbs, nom);
  if (existsSync(path)) return { ok: false, error: `ya existe: ${path}` };
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    return { ok: false, error: `no se pudo crear: ${e instanceof Error ? e.message : e}` };
  }
  const ini = asegurarProyecto(path);
  if (!ini.ok) return ini;
  recordar(path);
  return { ok: true, path };
}
