// Módulos (F7 + Fase 3): registro, enable/disable por proyecto, esqueletos y superficie validada.
// El catálogo cableado espeja src/modules/*/manifest.json; los esqueletos
// creados con `module new` se detectan por escaneo (mejor esfuerzo).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PropuestaModulo } from "./modules/module-builder.js";
import { validarPropuestaModulo } from "./modules/module-builder.js";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface ModuloInfo {
  nombre: string;
  version: string;
  descripcion: string;
  configFile: string;
  cableado: boolean;
  enabled: boolean;
  vista: VistaModulo;
  superficie: string[];
  // Tipo de panel que el módulo sabe pintar (del manifiesto, `panel: {tipo}`).
  // Nulo = solo vista genérica. Los tipos los pinta la web sin tocar el núcleo.
  panel: string | null;
  compat: string;
}

// Dónde aparece el módulo en la web (opción B: lo decide el usuario por módulo).
// solo = solo en Configuración; columna = acceso en la columna de actividad;
// barra = chip en la barra sobre el chat. El acceso lleva a su fila en
// Configuración (el esqueleto aún no trae vista propia; la tendrá al cablearse).
export type VistaModulo = "solo" | "columna" | "barra";
export const VISTAS: VistaModulo[] = ["solo", "columna", "barra"];

// Espejo de los manifest.json cableados (versión + descriptor).
const CATALOGO: Omit<ModuloInfo, "enabled" | "cableado" | "vista" | "superficie" | "panel" | "compat">[] = [
  {
    nombre: "telegram",
    version: "0.3.0",
    descripcion: "Canal Telegram: notificaciones y aprobaciones. No otorga permisos; decide el broker.",
    configFile: "telegram.config.json",
  },
  {
    nombre: "adapters",
    version: "0.1.0",
    descripcion: "Proveedor LLM conmutable (off|ollama|litellm|openai|anthropic|google|openrouter). Una sola integración activa.",
    configFile: "adapters.config.json",
  },
  {
    nombre: "agents",
    version: "0.1.0",
    descripcion: "Grafo de orquestación: orquestador, nodos, especializados, subagentes y skills.",
    configFile: "agents.config.json",
  },
  {
    nombre: "skills",
    version: "0.1.0",
    descripcion: "Catálogo de skills editable: skills/<id>/SKILL.md sobreescribe el catálogo y es lo que recibe el prompt del agente.",
    configFile: "skills.config.json",
  },
  {
    nombre: "grafos",
    version: "0.1.0",
    descripcion: "Grafo planeado vs ejecutado (intended: agents.config.json; executed: handoffs + evidences). Compara diseño con realidad observada.",
    configFile: "grafos.config.json",
  },
  {
    nombre: "speckit",
    version: "0.1.0",
    descripcion: "Converge SDD: compara specs y tareas con su evidencia pass (solo lectura). Valida convergencia spec-tasks-evidences.",
    configFile: "speckit.config.json",
  },
];

const STATE_FILE = "modules.json";
const NOMBRE_OK = /^[a-z][a-z0-9-]{0,31}$/;

function dirModulosSrc(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [join(here, "..", "src", "modules"), join(here, "modules")]) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* sigue */
    }
  }
  return undefined;
}

interface EstadoModulo {
  enabled: boolean;
  vista: VistaModulo;
}

function esVista(v: unknown): v is VistaModulo {
  return v === "solo" || v === "columna" || v === "barra";
}

function leerEstado(root: string): Record<string, EstadoModulo> {
  try {
    const j = JSON.parse(readFileSync(join(root, STATE_FILE), "utf8")) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out: Record<string, EstadoModulo> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (!NOMBRE_OK.test(k)) continue;
      // Compatible hacia atrás: modules.json antes guardaba boolean puro.
      if (typeof v === "boolean") out[k] = { enabled: v, vista: "solo" };
      else if (v && typeof v === "object" && typeof (v as { enabled?: unknown }).enabled === "boolean") {
        const e = v as { enabled: boolean; vista?: unknown };
        out[k] = { enabled: e.enabled, vista: esVista(e.vista) ? e.vista : "solo" };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function escribirEstado(root: string, estado: Record<string, EstadoModulo>): void {
  writeFileSync(join(root, STATE_FILE), JSON.stringify(estado, null, 2) + "\n");
}

// Nombres conocidos: catálogo + esqueletos detectados en disco.
export function nombresConocidos(): { nombre: string; cableado: boolean }[] {
  const out = CATALOGO.map((c) => ({ nombre: c.nombre, cableado: true }));
  const dir = dirModulosSrc();
  if (dir) {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || !NOMBRE_OK.test(e.name)) continue;
        if (out.some((o) => o.nombre === e.name)) continue;
        try {
          const m = JSON.parse(readFileSync(join(dir, e.name, "manifest.json"), "utf8")) as { name?: unknown };
          if (m.name !== e.name) continue;
        } catch {
          continue;
        }
        out.push({ nombre: e.name, cableado: false });
      }
    } catch {
      /* mejor esfuerzo */
    }
  }
  return out;
}

export function moduloActivo(root: string, nombre: string): boolean {
  const e = leerEstado(root)[nombre];
  return e === undefined ? true : e.enabled;
}

export function vistaModulo(root: string, nombre: string): VistaModulo {
  const e = leerEstado(root)[nombre];
  return e === undefined ? "solo" : e.vista;
}

export function setVista(root: string, nombre?: string, vista?: string): string {
  if (!nombre || !vista) return "uso: axiom module vista <nombre> <solo|columna|barra>";
  if (!NOMBRE_OK.test(nombre)) return `nombre inválido: ${nombre} (a-z, 0-9, -, 1-32)`;
  if (!esVista(vista)) return `vista inválida: ${vista} (solo|columna|barra)`;
  const conocido = nombresConocidos().some((c) => c.nombre === nombre);
  if (!conocido) return `módulo desconocido: ${nombre} (crea el esqueleto con \`axiom module new ${nombre}\`)`;
  const estado = leerEstado(root);
  const cur = estado[nombre] ?? { enabled: true, vista: "solo" as VistaModulo };
  estado[nombre] = { enabled: cur.enabled, vista };
  escribirEstado(root, estado);
  return `módulo ${nombre}: ver en ${vista}`;
}

// Tipo de panel declarado por el módulo (`panel: {tipo}` en su manifiesto).
// Nulo = genérico. Sin tipos raros: 1-32, a-z 0-9 -.
export function panelModulo(nombre: string): string | null {
  try {
    const dir = dirModulosSrc();
    if (!dir) return null;
    const m = JSON.parse(readFileSync(join(dir, nombre, "manifest.json"), "utf8")) as { panel?: unknown };
    const t = (m.panel as { tipo?: unknown } | undefined)?.tipo;
    if (typeof t !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(t)) return null;
    return t;
  } catch {
    return null;
  }
}

export function listarModulos(root: string): ModuloInfo[] {
  const conocidos = nombresConocidos();
  const porNombre = new Map(conocidos.map((c) => [c.nombre, c.cableado]));
  const lista: ModuloInfo[] = CATALOGO.map((c) => ({
    ...c,
    cableado: true,
    enabled: moduloActivo(root, c.nombre),
    vista: vistaModulo(root, c.nombre),
    superficie: validarSuperficie(c.nombre).archivos,
    panel: panelModulo(c.nombre),
    compat: compatModulo(c.nombre).detalle,
  }));
  for (const [nombre, cableado] of porNombre) {
    if (lista.some((m) => m.nombre === nombre)) continue;
    let version = "0.1.0";
    let descripcion = "Esqueleto sin cablear: declara e implementa antes de usar.";
    let configFile = `${nombre}.config.json`;
    try {
      const dir = dirModulosSrc();
      if (dir) {
        const m = JSON.parse(readFileSync(join(dir, nombre, "manifest.json"), "utf8")) as {
          version?: unknown;
          description?: unknown;
          config_file?: unknown;
        };
        if (typeof m.version === "string") version = m.version.slice(0, 16);
        if (typeof m.description === "string") descripcion = m.description.slice(0, 200);
        if (typeof m.config_file === "string") configFile = m.config_file.slice(0, 64);
      }
    } catch {
      /* defecto */
    }
    lista.push({ nombre, version, descripcion, configFile, cableado, enabled: moduloActivo(root, nombre), vista: vistaModulo(root, nombre), superficie: validarSuperficie(nombre).archivos, panel: panelModulo(nombre), compat: compatModulo(nombre).detalle });
  }
  return lista.sort((a, b) => (a.nombre < b.nombre ? -1 : 1));
}

export function textoModulos(root: string): string {
  const lista = listarModulos(root);
  const lines = ["módulos:"];
  for (const m of lista) {
    const cc = compatModulo(m.nombre);
    lines.push(`- ${m.nombre} ${m.version} [${m.enabled ? "on" : "off"}] ver:${m.vista}${m.cableado ? "" : " (esqueleto, sin cablear)"}${cc.ok ? "" : " (!)"}: ${m.descripcion}`);
  }
  return lines.join("\n");
}

export interface Superficie {
  nombre: string;
  ok: boolean;
  errores: string[];
  archivos: string[];
}

const EDITABLE_OK = /^[a-z0-9][a-z0-9._/-]{0,63}$/;

function dirModulo(nombre: string): string | undefined {
  const dir = dirModulosSrc();
  if (!dir) return undefined;
  const base = join(dir, nombre);
  try {
    if (!existsSync(base)) return undefined;
  } catch {
    return undefined;
  }
  return base;
}

// Superficie validada (Fase 3, de harness2 tree.py): el manifiesto declara los
// archivos editables del módulo y el check lo valida. Nada fuera de la lista
// es superficie del módulo: un .ts nuevo sin declarar hace fallar el check.
export function validarSuperficie(nombre: string): Superficie {
  const errores: string[] = [];
  const base = dirModulo(nombre);
  if (!base) return { nombre, ok: false, errores: [`sin directorio src/modules/${nombre}`], archivos: [] };
  let m: { name?: unknown; editables?: unknown };
  try {
    m = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  } catch {
    return { nombre, ok: false, errores: ["manifest.json ilegible o ausente"], archivos: [] };
  }
  if (m.name !== nombre) errores.push(`manifest.name=${JSON.stringify(m.name)} no casa con el directorio`);
  if (!Array.isArray(m.editables) || m.editables.length === 0) {
    errores.push("manifiesto sin superficie: declara `editables` con los archivos del módulo");
    return { nombre, ok: false, errores, archivos: [] };
  }
  const lista = m.editables as unknown[];
  const vistos = new Set<string>();
  for (const e of lista) {
    if (typeof e !== "string" || !EDITABLE_OK.test(e) || e.includes("..")) {
      errores.push(`editable inválido: ${JSON.stringify(e)} (relativo, sin .., 1-64)`);
      continue;
    }
    if (vistos.has(e)) {
      errores.push(`editable duplicado: ${e}`);
      continue;
    }
    vistos.add(e);
    try {
      if (!existsSync(join(base, e))) errores.push(`editable ausente en disco: ${e}`);
    } catch {
      errores.push(`editable ilegible: ${e}`);
    }
  }
  let reales: string[] = [];
  try {
    reales = readdirSync(base, { withFileTypes: true })
      .filter((x) => x.isFile() && /\.(ts|json)$/.test(x.name))
      .map((x) => x.name);
  } catch {
    errores.push("directorio ilegible");
  }
  for (const r of reales) {
    if (!vistos.has(r)) errores.push(`fuera de superficie: ${r} existe pero no está declarado en editables`);
  }
  return { nombre, ok: errores.length === 0, errores, archivos: [...vistos].sort() };
}

export function validarTodasSuperficies(): Superficie[] {
  return nombresConocidos().map((c) => validarSuperficie(c.nombre));
}

export function textoSuperficie(nombre?: string): string {
  if (nombre?.trim()) {
    const s = validarSuperficie(nombre.trim());
    const cab = `superficie ${s.nombre}: ${s.ok ? "ok" : "FALLO"} [${s.archivos.join(", ") || "—"}]`;
    return s.ok ? cab : cab + "\n" + s.errores.map((e) => `  - ${e}`).join("\n");
  }
  return validarTodasSuperficies()
    .map((s) => `superficie ${s.nombre}: ${s.ok ? "ok" : "FALLO"} [${s.archivos.join(", ") || "—"}]${s.ok ? "" : "\n" + s.errores.map((e) => `  - ${e}`).join("\n")}`)
    .join("\n");
}

export function setModulo(root: string, nombre?: string, accion?: string): string {
  if (!nombre || (accion !== "on" && accion !== "off")) return "uso: axiom module <on|off> <nombre>";
  if (!NOMBRE_OK.test(nombre)) return `nombre inválido: ${nombre} (a-z, 0-9, -, 1-32)`;
  const conocido = nombresConocidos().some((c) => c.nombre === nombre);
  if (!conocido) return `módulo desconocido: ${nombre} (crea el esqueleto con \`axiom module new ${nombre}\`)`;
  const estado = leerEstado(root);
  const cur = estado[nombre] ?? { enabled: true, vista: "solo" as VistaModulo };
  estado[nombre] = { enabled: accion === "on", vista: cur.vista };
  escribirEstado(root, estado);
  const extra = accion === "off" ? " (web responde 409 en sus rutas; CLI rehúsa)" : "";
  return `módulo ${nombre}: ${accion}${extra}`;
}

export const PANEL_TIPOS = ["grafo", "lista", "texto"] as const;
export type PanelTipo = (typeof PANEL_TIPOS)[number];

export function esPanelTipo(v: unknown): v is PanelTipo {
  return v === "grafo" || v === "lista" || v === "texto";
}

function versionAxiom(): string {
  try {
    const j = JSON.parse(readFileSync(join(dirModulosSrc() ?? ".", "..", "..", "package.json"), "utf8")) as { version?: unknown };
    if (typeof j.version === "string") return j.version;
  } catch { /* sigue */ }
  try {
    const j2 = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")) as { version?: unknown };
    if (typeof j2.version === "string") return j2.version;
  } catch { /* sigue */ }
  return "0.0.0";
}

function rangoOk(rango: string, version: string): boolean {
  const r = rango.trim();
  if (!r || r === "*") return true;
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
  if (!m) return false;
  const vMaj = parseInt(m[1], 10);
  const vMin = parseInt(m[2], 10);
  if (r.startsWith("^")) {
    const b = /^\^(\d+)\.(\d+)$/.exec(r);
    if (!b) return false;
    if (vMaj !== parseInt(b[1], 10)) return false;
    if (vMaj === 0 && vMin !== parseInt(b[2], 10)) return false;
    if (vMin < parseInt(b[2], 10)) return false;
    return true;
  }
  return r === version.trim();
}

export interface CompatModulo { nombre: string; ok: boolean; detalle: string }

export function compatModulo(nombre: string): CompatModulo {
  const base = dirModulo(nombre);
  if (!base) return { nombre, ok: false, detalle: `sin directorio src/modules/${nombre}` };
  let m: { axiom?: unknown };
  try {
    m = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  } catch {
    return { nombre, ok: false, detalle: "manifest.json ilegible o ausente" };
  }
  const rango = typeof m.axiom === "string" ? m.axiom : "";
  if (!rango) return { nombre, ok: true, detalle: `sin campo axiom (anterior al registro; se asume compatible con ${versionAxiom()})` };
  const v = versionAxiom();
  const ok = rangoOk(rango, v);
  return { nombre, ok, detalle: ok ? `compatible: pide ${rango}, Axiom ${v}` : `DESACTUALIZADO: pide ${rango}, Axiom ${v} — reedítalo (module regen ${nombre})` };
}

export function textoCompat(nombre?: string): string {
  if (nombre?.trim()) {
    const c = compatModulo(nombre.trim());
    return `compat ${c.nombre}: ${c.ok ? "ok" : "DESACTUALIZADO"} — ${c.detalle}`;
  }
  return nombresConocidos().map((c) => {
    const r = compatModulo(c.nombre);
    return `compat ${r.nombre}: ${r.ok ? "ok" : "DESACTUALIZADO"} — ${r.detalle}`;
  }).join("\n");
}

function plantillaDatos(nombre: string, tipo: PanelTipo, descripcion: string): string {
  const d = descripcion.replace(/`/g, "'").slice(0, 200) || `Módulo ${nombre}.`;
  if (tipo === "lista") {
    return `// Módulo ${nombre} — ${d}\nexport const NOMBRE = ${JSON.stringify(nombre)};\n\nexport function estadoTexto(): string {\n  return \`${nombre}: ${d.slice(0, 80)}\`;\n}\n\nexport function datosModulo(_root: string): unknown {\n  void _root;\n  return { titulo: ${JSON.stringify(d)}, items: [{ id: "ejemplo-1", nota: "adapta esta lista a tu función" }] };\n}\n`;
  }
  if (tipo === "texto") {
    return `// Módulo ${nombre} — ${d}\nexport const NOMBRE = ${JSON.stringify(nombre)};\n\nexport function estadoTexto(): string {\n  return \`${nombre}: ${d.slice(0, 80)}\`;\n}\n\nexport function datosModulo(_root: string): unknown {\n  void _root;\n  return { titulo: ${JSON.stringify(d)}, texto: "adapta este texto a tu función" };\n}\n`;
  }
  return `// Módulo ${nombre} — ${d}\n// Generado por el creador (convención sin cableado): exporta datosModulo\n// y el núcleo lo sirve vía GET /api/modulos/datos?nombre=${nombre}.\nexport const NOMBRE = ${JSON.stringify(nombre)};\n\nexport function estadoTexto(): string {\n  return \`${nombre}: ${d.slice(0, 80)}\`;\n}\n\nexport interface Vista { centro: string; nodos: { id: string; tipo: string; nota: string }[]; aristas: { de: string; a: string; nota: string }[] }\n\n// Convención: el núcleo llama a datosModulo(root) por import dinámico.\nexport function datosModulo(_root: string): unknown {\n  void _root;\n  const intended: Vista = { centro: ${JSON.stringify(nombre)}, nodos: [{ id: "nodo-a", tipo: "agente", nota: ${JSON.stringify(d.slice(0, 60))} }], aristas: [{ de: ${JSON.stringify(nombre)}, a: "nodo-a", nota: "delega" }] };\n  const executed: Vista = { centro: ${JSON.stringify(nombre)}, nodos: [], aristas: [] };\n  return { intended, executed, vacio: true };\n}\n`;
}

// Creador guiado: esqueleto + datosModulo con plantilla + manifiesto con panel
// y rango axiom. Si ya existe, regenera (es la reedición). Nunca toca el núcleo.
export function crearModulo(nombre?: string, tipo?: string, descripcion?: string): string {
  if (!nombre || !NOMBRE_OK.test(nombre) || !/^[a-z]/.test(nombre)) return "uso: axiom module new <nombre> [grafo|lista|texto] [descripcion de su funcion]";
  const t: PanelTipo = esPanelTipo(tipo) ? tipo : "grafo";
  const d = (descripcion ?? "").trim().slice(0, 200) || `Módulo ${nombre}.`;
  const dir = dirModulosSrc();
  if (!dir) return "no se encontró src/modules (corre desde el checkout del proyecto)";
  const v = versionAxiom();
  const mm = v.split(".");
  const rango = `^${mm[0] ?? "0"}.${mm[1] ?? "0"}`;
  const existed = existsSync(join(dir, nombre));
  try {
    mkdirSync(join(dir, nombre), { recursive: true });
    writeFileSync(join(dir, nombre, "manifest.json"), JSON.stringify({ name: nombre, version: "0.1.0", axiom: rango, scope: "global", default: false, description: d, contracts: [], transports: ["cli"], patterns: ["fail-closed"], config_file: `${nombre}.config.json`, panel: { tipo: t }, editables: ["manifest.json", "index.ts", "config.ts"], cli: ["module datos " + nombre] }, null, 2) + "\n");
    writeFileSync(join(dir, nombre, "index.ts"), plantillaDatos(nombre, t, d));
    writeFileSync(join(dir, nombre, "config.ts"), `// Módulo ${nombre} — config.\nimport { z } from "zod";\n\nexport const Config = z.object({});\n`);
  } catch (e) {
    return `no se pudo crear: ${e instanceof Error ? e.message : e}`;
  }
  return existed
    ? `módulo ${nombre} regenerado (tipo ${t}, axiom ${rango}): compila con npx tsc y reinicia el servidor`
    : `módulo ${nombre} creado (tipo ${t}, axiom ${rango}) en src/modules/${nombre}: compila con npx tsc y reinicia el servidor`;
}

export function rutaEntradaModulo(nombre: string): string | undefined {
  if (!NOMBRE_OK.test(nombre)) return undefined;
  const base = dirModulo(nombre);
  const here = dirname(fileURLToPath(import.meta.url));
  // Preferido: el artefacto JS validado que escribe el instalador de propuestas.
  // Fallback: los módulos nativos solo existen compilados junto a este archivo (dist/modules/<n>).
  const candidatos = [
    base ? join(base, "index.js") : undefined,
    join(here, "modules", nombre, "index.js"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidatos) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return undefined;
}

export async function instalarModuloGenerado(propuesta: PropuestaModulo): Promise<{ ok: boolean; mensaje: string }> {
  const validacion = await validarPropuestaModulo(propuesta);
  if (!validacion.ok) return { ok: false, mensaje: `validación rechazada: ${validacion.errores.join("; ")}` };
  const dir = dirModulosSrc();
  if (!dir) return { ok: false, mensaje: "no se encontró src/modules" };
  const base = join(dir, propuesta.nombre);
  if (existsSync(base)) return { ok: false, mensaje: `el módulo ${propuesta.nombre} ya existe; no se sobrescribe` };
  try {
    mkdirSync(base, { recursive: false });
    writeFileSync(join(base, "manifest.json"), JSON.stringify({ name: propuesta.nombre, version: "0.1.0", axiom: `^${versionAxiom().split(".").slice(0, 2).join(".")}`, scope: "global", default: false, description: propuesta.descripcion, contracts: [], transports: ["cli"], patterns: ["fail-closed"], config_file: `${propuesta.nombre}.config.json`, panel: { tipo: propuesta.tipo }, editables: ["manifest.json", "index.ts", "config.ts"], cli: [`module datos ${propuesta.nombre}`] }, null, 2) + "\n");
    writeFileSync(join(base, "index.ts"), propuesta.indexTs);
    const javascript = ts.transpileModule(propuesta.indexTs, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    if (javascript.diagnostics?.length) throw new Error("No se pudo transpilar index.ts a JavaScript ejecutable.");
    writeFileSync(join(base, "index.js"), javascript.outputText);
    writeFileSync(join(base, "config.ts"), propuesta.configTs);
    const manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8")) as { editables: string[] };
    manifest.editables.push("index.js");
    writeFileSync(join(base, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return { ok: true, mensaje: `módulo ${propuesta.nombre} instalado en src/modules/${propuesta.nombre}; deshabilitado hasta habilitación explícita` };
  } catch (error) {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* conserva error original */ }
    return { ok: false, mensaje: `no se pudo instalar ${propuesta.nombre}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function regenModulo(nombre?: string): string {
  if (!nombre?.trim()) return "uso: axiom module regen <nombre>";
  const n = nombre.trim();
  const base = dirModulo(n);
  if (!base) return `módulo desconocido: ${n}`;
  let m: { panel?: unknown; description?: unknown };
  try {
    m = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  } catch {
    return `manifest.json ilegible en ${n}`;
  }
  const tipo = esPanelTipo((m.panel as { tipo?: unknown } | undefined)?.tipo) ? ((m.panel as { tipo: PanelTipo }).tipo) : "grafo";
  const desc = typeof m.description === "string" ? m.description : "";
  return crearModulo(n, tipo, desc);
}

export function nuevoEsqueleto(nombre?: string): string {
  if (!nombre || !NOMBRE_OK.test(nombre ?? "")) return "uso: axiom module new <nombre> (a-z, 0-9, -, 1-32, empieza con letra)";
  if (!/^[a-z]/.test(nombre)) return `nombre inválido: ${nombre} (empieza con letra)`;
  const dir = dirModulosSrc();
  if (!dir) return "no se encontró src/modules (corre desde el checkout del proyecto)";
  const base = join(dir, nombre);
  if (existsSync(base)) return `ya existe el módulo: ${nombre}`;
  try {
    mkdirSync(base, { recursive: true });
    writeFileSync(
      join(base, "manifest.json"),
      JSON.stringify(
        {
          name: nombre,
          version: "0.1.0",
          scope: "global",
          default: false,
          description: `Módulo ${nombre} (esqueleto F7: declara e implementa antes de usar).`,
          contracts: [],
          transports: ["cli"],
          patterns: ["fail-closed"],
          config_file: `${nombre}.config.json`,
          editables: ["manifest.json", "index.ts", "config.ts"],
          cli: [],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(base, "index.ts"),
      `// Módulo ${nombre} — esqueleto (F7): aún no cableado.\n` +
        `// Para activarlo: implementa aquí, declara el manifiesto y cablea CLI/web + boundaries.\n` +
        `export const NOMBRE = ${JSON.stringify(nombre)};\n\nexport function estadoTexto(): string {\n  return \`${nombre}: esqueleto sin implementar (fail closed)\`;\n}\n`,
    );
    writeFileSync(
      join(base, "config.ts"),
      `// Módulo ${nombre} — config (esqueleto F7).\nimport { z } from "zod";\n\nexport const Config = z.object({});\n`,
    );
  } catch (e) {
    return `no se pudo crear: ${e instanceof Error ? e.message : e}`;
  }
  return `módulo ${nombre} creado como esqueleto en src/modules/${nombre} (sin cablear; fail closed)`;
}
