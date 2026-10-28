// Constitution — principios persistentes versionados del proyecto.
// Formato y SemVer copiados de github/spec-kit
// (templates/commands/constitution.md + .specify/memory/constitution.md):
// principios numerados en romanos con reglas declarativas y Rationale,
// Governance, y línea `Version: MAJOR.MINOR.PATCH | Ratified: YYYY-MM-DD
// | Last Amended: YYYY-MM-DD`. Añadir principio → MINOR;
// enmendar o quitar → MAJOR; Ratified se conserva siempre.
// EXPERIENCE.md sigue siendo bitácora (qué pasó); esto manda (qué vale).
// Sin dependencias nuevas: solo fs + fechas.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CONSTITUTION_REL = ".specify/memory/constitution.md";
const MAX_PRINCIPIOS = 20;
const MAX_NOMBRE = 80;
const MAX_REGLAS = 2000;
const MAX_RATIONALE = 500;

export interface Principio {
  romano: string;
  nombre: string;
  reglas: string;
  rationale?: string;
}

export interface Constitucion {
  titulo: string;
  version: string;
  ratificada: string;
  enmendada: string;
  principios: Principio[];
}

export type ResultadoConstitucion = { ok: true; msg: string } | { ok: false; msg: string };

const ROMANOS: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function aRomano(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 39) throw new Error(`romano fuera de rango: ${n}`);
  let resto = n;
  let out = "";
  for (const [valor, simbolo] of ROMANOS) while (resto >= valor) { out += simbolo; resto -= valor; }
  return out;
}

export function deRomano(s: string): number | null {
  const t = s.trim().toUpperCase();
  if (!/^(X{0,3})(IX|IV|V?I{0,3})$/.test(t) || t === "") return null;
  let resto = t;
  let n = 0;
  for (const [valor, simbolo] of ROMANOS) while (resto.startsWith(simbolo)) { n += valor; resto = resto.slice(simbolo.length); }
  return resto === "" && n >= 1 && n <= 39 ? n : null;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function subir(version: string, tipo: "major" | "minor"): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`versión inválida: ${version}`);
  const nums = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (tipo === "major") return `${nums[0] + 1}.0.0`;
  return `${nums[0]}.${nums[1] + 1}.0`;
}

function ruta(root: string): string {
  return join(root, CONSTITUTION_REL);
}

/** Lee y parsea la constitución; `existe: false` si aún no hay. Malformada → error (no se pisa a ciegas). */
export function leerConstitucion(root: string): { existe: boolean; constitucion?: Constitucion; error?: string } {
  const p = ruta(root);
  if (!existsSync(p)) return { existe: false };
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (e) {
    return { existe: true, error: `no se pudo leer ${CONSTITUTION_REL}: ${e instanceof Error ? e.message : e}` };
  }
  const ver = /^Version:\s*(\d+\.\d+\.\d+)\s*\|\s*Ratified:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Last Amended:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(raw);
  if (!ver) return { existe: true, error: `${CONSTITUTION_REL} sin línea de versión válida (no se toca)` };
  const titulo = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() ?? "Constitución";
  const principios: Principio[] = [];
  const bloques = raw.split(/^###\s+/m).slice(1);
  for (const b of bloques) {
    const cab = /^([IVX]+)\.\s+([^\n]+)\n([\s\S]*)$/.exec(b);
    if (!cab) return { existe: true, error: `${CONSTITUTION_REL} con principio malformado (no se toca)` };
    if (deRomano(cab[1]) === null) return { existe: true, error: `${CONSTITUTION_REL} con numeral inválido ${cab[1]} (no se toca)` };
    const cuerpo = cab[3];
    const gov = cuerpo.indexOf("## Governance");
    const util = gov >= 0 ? cuerpo.slice(0, gov) : cuerpo;
    const rat = /Rationale:\s*([^\n]+)/.exec(util)?.[1]?.trim();
    const reglas = util.split(/Rationale:/)[0].trim();
    if (!reglas) return { existe: true, error: `${CONSTITUTION_REL} con principio sin reglas (no se toca)` };
    principios.push({ romano: cab[1], nombre: cab[2].trim(), reglas, rationale: rat || undefined });
  }
  return { existe: true, constitucion: { titulo, version: ver[1], ratificada: ver[2], enmendada: ver[3], principios } };
}

function renderizar(c: Constitucion): string {
  const ps = c.principios.map((p) =>
    `### ${p.romano}. ${p.nombre}\n\n${p.reglas}${p.rationale ? `\n\nRationale: ${p.rationale}` : ""}\n`,
  ).join("\n");
  return `# ${c.titulo}\n\nPrincipios que mandan sobre planes, specs y builds de este proyecto. En caso\nde conflicto con un pedido puntual, la constitución gana y el conflicto se\nregistra en la respuesta.\n\n## Core Principles\n\n${ps}\n## Governance\n\nLa constitución se enmienda con \`axiom constitution\`: añadir principio\nsube MINOR; enmendar o quitar sube MAJOR; aclaraciones de redacción no\ntocan versión (se hacen vía enmendar solo si cambian el sentido). Ratified\nes la adopción original y no cambia. El plan y el build del chat la reciben\ncomo contexto/restricción vigente.\n\nVersion: ${c.version} | Ratified: ${c.ratificada} | Last Amended: ${c.enmendada}\n`;
}

function guardar(root: string, c: Constitucion): void {
  const p = ruta(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, renderizar(c), "utf8");
}

function validarTexto(nombre: string, reglas: string, rationale?: string): string | null {
  if (!nombre.trim() || nombre.trim().length > MAX_NOMBRE) return `nombre requerido (1-${MAX_NOMBRE} caracteres)`;
  if (!reglas.trim() || reglas.trim().length > MAX_REGLAS) return `reglas requeridas (1-${MAX_REGLAS} caracteres)`;
  if (rationale !== undefined && (rationale.trim().length < 1 || rationale.length > MAX_RATIONALE)) {
    return `rationale (1-${MAX_RATIONALE} caracteres)`;
  }
  return null;
}

/** Añade un principio (bump MINOR). Crea el archivo en 1.0.0 si no existe. */
export function fijarPrincipio(root: string, nombre: string, reglas: string, rationale?: string): ResultadoConstitucion {
  const mal = validarTexto(nombre, reglas, rationale);
  if (mal) return { ok: false, msg: `constitution: ${mal}` };
  const actual = leerConstitucion(root);
  if (actual.existe && actual.error) return { ok: false, msg: `constitution: ${actual.error}` };
  const c: Constitucion = actual.constitucion ?? {
    titulo: "Constitución Axiom",
    version: "1.0.0",
    ratificada: hoy(),
    enmendada: hoy(),
    principios: [],
  };
  if (c.principios.length >= MAX_PRINCIPIOS) return { ok: false, msg: `constitution: tope de ${MAX_PRINCIPIOS} principios` };
  const n = nombre.trim();
  if (c.principios.some((p) => p.nombre.toLowerCase() === n.toLowerCase())) {
    return { ok: false, msg: `constitution: ya existe el principio «${n}» (usa enmendar)` };
  }
  const eraNueva = !actual.existe;
  c.principios.push({ romano: aRomano(c.principios.length + 1), nombre: n, reglas: reglas.trim(), rationale: rationale?.trim() || undefined });
  if (!eraNueva) {
    c.version = subir(c.version, "minor");
    c.enmendada = hoy();
  }
  try {
    guardar(root, c);
  } catch (e) {
    return { ok: false, msg: `constitution: no se pudo escribir: ${e instanceof Error ? e.message : e}` };
  }
  return { ok: true, msg: `constitution ${c.version}: principio ${c.principios[c.principios.length - 1].romano} «${n}» fijado` };
}

/** Redefine las reglas de un principio (bump MAJOR). */
export function enmendarPrincipio(root: string, romano: string, reglas: string, rationale?: string): ResultadoConstitucion {
  const mal = validarTexto("x", reglas, rationale);
  if (mal) return { ok: false, msg: `constitution: ${mal}` };
  const actual = leerConstitucion(root);
  if (!actual.existe) return { ok: false, msg: "constitution: aún no hay constitución (usa principio primero)" };
  if (actual.error || !actual.constitucion) return { ok: false, msg: `constitution: ${actual.error}` };
  const c = actual.constitucion;
  const idx = c.principios.findIndex((p) => p.romano === romano.trim().toUpperCase());
  if (idx < 0) return { ok: false, msg: `constitution: principio ${romano.trim().toUpperCase() || "?"} inexistente` };
  c.principios[idx] = { ...c.principios[idx], reglas: reglas.trim(), rationale: rationale?.trim() || undefined };
  c.version = subir(c.version, "major");
  c.enmendada = hoy();
  try {
    guardar(root, c);
  } catch (e) {
    return { ok: false, msg: `constitution: no se pudo escribir: ${e instanceof Error ? e.message : e}` };
  }
  return { ok: true, msg: `constitution ${c.version}: principio ${c.principios[idx].romano} enmendado` };
}

/** Quita un principio y renumera I..N (bump MAJOR). */
export function quitarPrincipio(root: string, romano: string): ResultadoConstitucion {
  const actual = leerConstitucion(root);
  if (!actual.existe) return { ok: false, msg: "constitution: aún no hay constitución" };
  if (actual.error || !actual.constitucion) return { ok: false, msg: `constitution: ${actual.error}` };
  const c = actual.constitucion;
  const r = romano.trim().toUpperCase();
  if (!c.principios.some((p) => p.romano === r)) return { ok: false, msg: `constitution: principio ${r || "?"} inexistente` };
  c.principios = c.principios.filter((p) => p.romano !== r).map((p, i) => ({ ...p, romano: aRomano(i + 1) }));
  c.version = subir(c.version, "major");
  c.enmendada = hoy();
  try {
    guardar(root, c);
  } catch (e) {
    return { ok: false, msg: `constitution: no se pudo escribir: ${e instanceof Error ? e.message : e}` };
  }
  return { ok: true, msg: `constitution ${c.version}: principio ${r} quitado` };
}

/** Texto completo para `axiom constitution` (ver). */
export function textoConstitucion(root: string): string {
  const actual = leerConstitucion(root);
  if (!actual.existe) return "Sin constitución: usa `axiom constitution principio <nombre> <reglas>` para ratificar la primera.";
  if (actual.error || !actual.constitucion) return `constitution: ${actual.error}`;
  const c = actual.constitucion;
  const ps = c.principios.map((p) => `${p.romano}. ${p.nombre}: ${p.reglas}${p.rationale ? ` (${p.rationale})` : ""}`).join("\n");
  return `${c.titulo} ${c.version} (ratificada ${c.ratificada}, enmendada ${c.enmendada})\n${ps || "(sin principios)"}`;
}

/** Bloque compacto para anteponer a prompts de plan/build. Vacío si no hay (nunca lanza). */
export function textoConstitucionPrompt(root: string): string {
  try {
    const actual = leerConstitucion(root);
    if (!actual.existe || actual.error || !actual.constitucion || actual.constitucion.principios.length === 0) return "";
    const c = actual.constitucion;
    const ps = c.principios.map((p) => `${p.romano}. ${p.nombre}: ${p.reglas}`).join("\n");
    const bloque = `[constitución del proyecto v${c.version} — principios que mandan; en conflicto con el pedido, la constitución gana y el conflicto se declara]\n${ps}`;
    return bloque.length > 2000 ? bloque.slice(0, 2000) + "\n…(recortada)" : bloque;
  } catch {
    return "";
  }
}
