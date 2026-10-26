// Módulo skills — catálogo editable por proyecto.
// El catálogo de código (modules/agents/skills.ts) sigue siendo la fuente por
// defecto; un `skills/<id>/SKILL.md` del proyecto lo sobreescribe. Así el
// usuario puede agregar o ajustar instrucciones sin recompilar, y lo que el
// agente recibe es siempre lo mismo que muestra Ajustes → Skills.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS, skillMarkdown } from "../agents/skills.js";

export const SKILL_ID_OK = /^[a-z][a-z0-9-]{0,63}$/;
export const MAX_DESCRIPCION = 160;
export const MAX_CUERPO = 4000;
export const CARPETA = "skills";
export const ARCHIVO = "SKILL.md";

// De dónde sale hoy el skill: solo catálogo, solo el proyecto (id nuevo) o
// archivo que reemplaza el cuerpo del catálogo.
export type OrigenSkill = "catalogo" | "override" | "proyecto";

export interface SkillInfo {
  id: string;
  descripcion: string;
  origen: OrigenSkill;
  enCatalogo: boolean;
  tieneCuerpo: boolean;
  /** El archivo del proyecto cambia el cuerpo que recibe el agente. */
  override: boolean;
  ruta: string;
  error?: string;
}

export interface SkillLeido extends SkillInfo {
  cuerpo: string;
  /** Contenido crudo del archivo, si existe (para el editor). */
  crudo?: string;
}

export interface ResultadoSkill {
  ok: boolean;
  msg?: string;
  error?: string;
  ruta?: string;
}

export function rutaSkill(root: string, id: string): string {
  return join(root, CARPETA, id, ARCHIVO);
}

function rutaRelativa(id: string): string {
  return `${CARPETA}/${id}/${ARCHIVO}`;
}

function limpiar(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
}

// Acepta dos formatos:
//  - el que escribe Axiom (`# SKILL:`, `Objetivo:`, `## Cómo trabajar con esta skill`)
//  - frontmatter simple (`---` + `descripcion: ...` + `---`) para archivos a mano
// Si no hay sección reconocible, el cuerpo es todo el texto menos título/objetivo.
export function parseSkillMd(texto: string): { descripcion?: string; cuerpo?: string } {
  const limpio = limpiar(texto);
  let descripcion: string | undefined;
  let resto = limpio;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(limpio);
  if (fm) {
    const linea = fm[1].split("\n").find((l) => /^descripcion\s*:/i.test(l.trim()));
    if (linea) {
      descripcion = linea.slice(linea.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
    }
    resto = limpio.slice(fm[0].length);
  }
  if (!descripcion) {
    const objetivo = resto.split("\n").find((l) => /^Objetivo\s*:/i.test(l.trim()));
    if (objetivo) descripcion = objetivo.slice(objetivo.indexOf(":") + 1).trim().replace(/\.$/, "");
  }
  const seccion = /^##\s+C[oó]mo trabajar con esta skill\s*$/im.exec(resto);
  let cuerpo: string;
  if (seccion) {
    const desde = resto.slice(seccion.index + seccion[0].length);
    const fin = desde.search(/^##\s+/m);
    cuerpo = (fin >= 0 ? desde.slice(0, fin) : desde).trim();
  } else {
    cuerpo = resto
      .split("\n")
      .filter((l) => !/^#\s+SKILL\s*:/i.test(l.trim()) && !/^Objetivo\s*:/i.test(l.trim()))
      .join("\n")
      .trim();
  }
  const out: { descripcion?: string; cuerpo?: string } = {};
  if (descripcion && descripcion.length > 0) out.descripcion = descripcion.slice(0, MAX_DESCRIPCION);
  if (cuerpo.length > 0) out.cuerpo = cuerpo.slice(0, MAX_CUERPO);
  return out;
}

interface ArchivoSkill {
  crudo: string;
  descripcion?: string;
  cuerpo?: string;
  error?: string;
}

function leerArchivo(root: string, id: string): ArchivoSkill | undefined {
  const p = rutaSkill(root, id);
  if (!existsSync(p)) return undefined;
  try {
    const crudo = readFileSync(p, "utf8");
    if (crudo.length > 200_000) return { crudo: "", error: "SKILL.md demasiado grande (máx 200000)" };
    const parse = parseSkillMd(crudo);
    const out: ArchivoSkill = { crudo };
    if (parse.descripcion) out.descripcion = parse.descripcion;
    if (parse.cuerpo) out.cuerpo = parse.cuerpo;
    else out.error = "SKILL.md sin cuerpo utilizable (agrega texto bajo «## Cómo trabajar con esta skill»)";
    return out;
  } catch (e) {
    return { crudo: "", error: `SKILL.md ilegible: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function idsEnDisco(root: string): string[] {
  const dir = join(root, CARPETA);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((x) => x.isDirectory() && SKILL_ID_OK.test(x.name))
      .map((x) => x.name)
      .sort();
  } catch {
    return [];
  }
}

/** Carpetas en skills/ cuyo nombre no es un id válido: no se cargan (no se adivinan). */
export function ignoradosSkills(root: string): string[] {
  const dir = join(root, CARPETA);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((x) => x.isDirectory() && !SKILL_ID_OK.test(x.name))
      .map((x) => x.name)
      .sort();
  } catch {
    return [];
  }
}

function infoDesdeCatalogo(base: (typeof SKILLS)[number]): SkillInfo {
  return {
    id: base.id,
    descripcion: base.descripcion,
    origen: "catalogo",
    enCatalogo: true,
    tieneCuerpo: true,
    override: false,
    ruta: rutaRelativa(base.id),
  };
}

export function listarSkills(root: string): SkillInfo[] {
  const porId = new Map<string, SkillInfo>();
  for (const base of SKILLS) porId.set(base.id, infoDesdeCatalogo(base));
  for (const id of idsEnDisco(root)) {
    const base = SKILLS.find((s) => s.id === id);
    const archivo = leerArchivo(root, id);
    if (!archivo) continue;
    const override = Boolean(base && archivo.cuerpo && archivo.cuerpo !== base.cuerpo);
    const info: SkillInfo = {
      id,
      descripcion: archivo.descripcion ?? base?.descripcion ?? "(sin descripción)",
      origen: base ? (override ? "override" : "catalogo") : "proyecto",
      enCatalogo: Boolean(base),
      tieneCuerpo: Boolean(archivo.cuerpo),
      override,
      ruta: rutaRelativa(id),
    };
    if (archivo.error) info.error = archivo.error;
    porId.set(id, info);
  }
  return [...porId.values()];
}

export function leerSkill(root: string, id: string): { ok: true; skill: SkillLeido } | { ok: false; error: string } {
  if (!SKILL_ID_OK.test(id)) return { ok: false, error: "id inválido (a-z, 0-9, -, 1-64)" };
  const base = SKILLS.find((s) => s.id === id);
  const archivo = leerArchivo(root, id);
  if (!base && !archivo) return { ok: false, error: `no existe el skill ${id}` };
  const info = listarSkills(root).find((s) => s.id === id);
  const cuerpo = archivo?.cuerpo ?? base?.cuerpo ?? "";
  const skill: SkillLeido = {
    id,
    descripcion: archivo?.descripcion ?? base?.descripcion ?? "(sin descripción)",
    origen: info?.origen ?? (base ? "catalogo" : "proyecto"),
    enCatalogo: Boolean(base),
    tieneCuerpo: cuerpo.length > 0,
    override: info?.override ?? false,
    ruta: rutaRelativa(id),
    cuerpo,
  };
  if (archivo?.crudo) skill.crudo = archivo.crudo;
  if (info?.error) skill.error = info.error;
  return { ok: true, skill };
}

/** Cuerpo que debe recibir el prompt: archivo del proyecto si lo hay, si no catálogo. */
export function cuerpoEfectivo(root: string, id: string): string | undefined {
  const archivo = leerArchivo(root, id);
  if (archivo?.cuerpo) return archivo.cuerpo;
  return SKILLS.find((s) => s.id === id)?.cuerpo;
}

/** Descripción efectiva (para el selector del chat y el panel). */
export function descripcionEfectiva(root: string, id: string): string | undefined {
  const archivo = leerArchivo(root, id);
  if (archivo?.descripcion) return archivo.descripcion;
  return SKILLS.find((s) => s.id === id)?.descripcion;
}

export function guardarSkill(root: string, id: string, datos: { descripcion: unknown; cuerpo: unknown }): ResultadoSkill {
  if (!SKILL_ID_OK.test(id)) return { ok: false, error: "id inválido: a-z, 0-9 y - (1-64), empieza por letra" };
  const descripcion = typeof datos.descripcion === "string" ? datos.descripcion.trim() : "";
  const cuerpo = typeof datos.cuerpo === "string" ? datos.cuerpo.trim() : "";
  if (!descripcion) return { ok: false, error: "descripción requerida" };
  if (descripcion.length > MAX_DESCRIPCION) return { ok: false, error: `descripción demasiado larga (máx ${MAX_DESCRIPCION})` };
  if (!cuerpo) return { ok: false, error: "cuerpo requerido: sin instrucciones el skill no enseña nada" };
  if (cuerpo.length > MAX_CUERPO) return { ok: false, error: `cuerpo demasiado largo (máx ${MAX_CUERPO})` };
  try {
    mkdirSync(join(root, CARPETA, id), { recursive: true });
    writeFileSync(rutaSkill(root, id), skillMarkdown({ id, descripcion, cuerpo }));
    return { ok: true, msg: `skill ${id} guardado`, ruta: rutaRelativa(id) };
  } catch (e) {
    return { ok: false, error: `no se pudo escribir ${rutaRelativa(id)}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function borrarSkill(root: string, id: string): ResultadoSkill {
  if (!SKILL_ID_OK.test(id)) return { ok: false, error: "id inválido: a-z, 0-9 y - (1-64), empieza por letra" };
  const p = rutaSkill(root, id);
  if (!existsSync(p)) {
    return { ok: false, error: SKILLS.some((s) => s.id === id) ? `el skill ${id} no tiene archivo propio: no hay override que quitar` : `no existe el skill ${id}` };
  }
  const base = SKILLS.find((s) => s.id === id);
  const archivo = leerArchivo(root, id);
  // La copia sembrada por el esqueleto no es un override: el mensaje lo distingue.
  const eraOverride = Boolean(base && archivo?.cuerpo && archivo.cuerpo !== base.cuerpo);
  try {
    rmSync(p);
    try {
      rmdirSync(join(root, CARPETA, id));
    } catch {
      /* quedan otros archivos del usuario: no se borra la carpeta */
    }
    const msg = !base
      ? `skill ${id} eliminado`
      : eraOverride
        ? `override de ${id} eliminado (vuelve al catálogo)`
        : `copia sembrada de ${id} eliminada (el skill sigue en el catálogo)`;
    return { ok: true, msg };
  } catch (e) {
    return { ok: false, error: `no se pudo borrar ${rutaRelativa(id)}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface DatosSkills {
  total: number;
  overrides: number;
  propios: number;
  sinCuerpo: number;
  ignorados: string[];
  skills: { id: string; origen: OrigenSkill; descripcion: string; override: boolean; tieneCuerpo: boolean }[];
}

export function datosSkills(root: string): DatosSkills {
  const skills = listarSkills(root);
  return {
    total: skills.length,
    overrides: skills.filter((s) => s.origen === "override").length,
    propios: skills.filter((s) => s.origen === "proyecto").length,
    sinCuerpo: skills.filter((s) => !s.tieneCuerpo).length,
    ignorados: ignoradosSkills(root),
    skills: skills.map((s) => ({ id: s.id, origen: s.origen, descripcion: s.descripcion, override: s.override, tieneCuerpo: s.tieneCuerpo })),
  };
}

export function datosModulo(root: string): unknown {
  return datosSkills(root);
}

export function textoSkills(root: string): string {
  const d = datosSkills(root);
  const lineas = [`skills: ${d.total} (${d.overrides} override, ${d.propios} propios)${d.sinCuerpo ? ` · ${d.sinCuerpo} sin cuerpo` : ""}`];
  for (const s of d.skills) {
    const estado = s.origen === "override" ? "override" : s.origen === "proyecto" ? "propio" : "catálogo";
    lineas.push(`  ${s.tieneCuerpo ? "✔" : "·"} ${s.id} [${estado}] ${s.descripcion}`);
  }
  if (d.ignorados.length) lineas.push(`  ignorados (id inválido): ${d.ignorados.join(", ")}`);
  return lineas.join("\n");
}

// --- Detalle editable de un skill --------------------------------------------
// Misma costura que agents: la web pide un skill, lo edita como campos y en el
// modo avanzado ve el SKILL.md completo. guardarSkill valida longitudes y exige
// cuerpo: si algo no cuadra no se escribe nada.

export interface CampoDetalleSkill {
  k: string;
  etiqueta: string;
  tipo: "texto" | "area";
  ayuda: string;
  valor: string;
}

export interface DatosDetalleSkill {
  id: string;
  bruto: string;
  campos: CampoDetalleSkill[];
  avanzado: { titulo: string; ayuda: string; boton: string };
  nota: string;
}

export type ResultadoDetalleSkill =
  | { ok: true; detalle: DatosDetalleSkill }
  | { ok: false; error: string };

export function detalleModulo(root: string, id?: string): ResultadoDetalleSkill {
  const n = (id ?? "").trim();
  if (!n) return { ok: false, error: "id de skill requerido" };
  const r = leerSkill(root, n);
  if (!r.ok) return { ok: false, error: r.error };
  const s = r.skill;
  const bruto = s.crudo ?? skillMarkdown({ id: s.id, descripcion: s.descripcion, cuerpo: s.cuerpo });
  const origen =
    s.origen === "override"
      ? "override del catálogo (el archivo del proyecto reemplaza el cuerpo de código)"
      : s.origen === "proyecto"
        ? "propio del proyecto (no está en el catálogo)"
        : "catálogo de código, sin archivo propio todavía";
  return {
    ok: true,
    detalle: {
      id: s.id,
      bruto,
      campos: [
        {
          k: "descripcion",
          etiqueta: "Descripción",
          tipo: "texto",
          ayuda: `Una línea: para qué sirve. Máximo ${MAX_DESCRIPCION} caracteres; es lo que se ve en el selector del chat.`,
          valor: s.descripcion,
        },
        {
          k: "cuerpo",
          etiqueta: "Cuerpo",
          tipo: "area",
          ayuda: `Instrucciones que recibe el agente. Máximo ${MAX_CUERPO} caracteres. Sin cuerpo el skill no enseña nada y no se guarda.`,
          valor: s.cuerpo,
        },
      ],
      avanzado: {
        titulo: "Modo avanzado — archivo SKILL.md",
        ayuda: "El markdown completo tal como queda en el archivo. Al guardar se normaliza al formato de Axiom (título, objetivo y cuerpo).",
        boton: "Guardar SKILL.md",
      },
      nota: `Origen: ${origen}. Ruta: ${s.ruta}. Guardar crea o actualiza el archivo del proyecto, que sobreescribe el catálogo y es exactamente lo que recibe el prompt.`,
    },
  };
}

export function guardarDetalleModulo(
  root: string,
  entrada: { id?: unknown; cambios?: unknown; bruto?: unknown },
): { ok: true; msg: string } | { ok: false; error: string } {
  const id = typeof entrada.id === "string" ? entrada.id.trim() : "";
  if (!id) return { ok: false, error: "id de skill requerido" };
  if (!SKILL_ID_OK.test(id)) return { ok: false, error: "id inválido: a-z, 0-9 y - (1-64), empieza por letra" };

  let descripcion: unknown;
  let cuerpo: unknown;
  if (entrada.bruto !== undefined) {
    if (typeof entrada.bruto !== "string") return { ok: false, error: "bruto debe ser texto markdown" };
    const p = parseSkillMd(entrada.bruto);
    if (!p.descripcion || !p.cuerpo) {
      return { ok: false, error: "el SKILL.md necesita descripción y cuerpo: conserva «# SKILL: <id>», «Objetivo: …» y el texto de la skill" };
    }
    descripcion = p.descripcion;
    cuerpo = p.cuerpo;
  } else {
    const c = entrada.cambios;
    if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "cambios (objeto) o bruto (markdown) requerido" };
    const cambios = c as Record<string, unknown>;
    for (const k of Object.keys(cambios)) {
      if (k !== "descripcion" && k !== "cuerpo") return { ok: false, error: `campo no editable: ${k}` };
    }
    descripcion = cambios.descripcion;
    cuerpo = cambios.cuerpo;
  }

  const r = guardarSkill(root, id, { descripcion, cuerpo });
  if (!r.ok) return { ok: false, error: r.error ?? "no se pudo guardar" };
  return { ok: true, msg: `${r.msg ?? `skill ${id} guardado`} · ${r.ruta ?? rutaRelativa(id)}` };
}
