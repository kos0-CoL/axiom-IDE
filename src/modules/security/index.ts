// Módulo security — inventario editable de controles de seguridad.
// Skills: única fuente en modules/agents/skills.ts (catálogo); aquí solo se
// filtran los de dominio seguridad (sec-*, seguridad, policy, sandbox).
// Cada fila abre su editor: un skill abre el editor del módulo skills (guardar
// crea el override en skills/<id>/SKILL.md) y politica-global edita las
// herramientas y el techo de policies.global.json (fail soft al leer, fail
// closed al guardar: si algo no cuadra no se escribe nada).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS } from "../agents/skills.js";
import {
  detalleModulo as detalleSkill,
  guardarDetalleModulo as guardarDetalleSkill,
} from "../skills/index.js";
import type { ResultadoDetalleSkill } from "../skills/index.js";

export const NOMBRE = "security";

export interface SkillSeguridad {
  id: string;
  descripcion: string;
  cuerpo: number;
  override: boolean;
}

export interface PoliticaGlobal {
  terminal: boolean | null;
  delega: boolean | null;
  techo: { rondas: number | null; tokens: number | null; calls: number | null };
}

export interface DatosSecurity {
  titulo: string;
  skills: SkillSeguridad[];
  politica: PoliticaGlobal;
  items: { id: string; nota: string }[];
  fuente: string;
}

// Skills que cubren seguridad: los de dominio nuevo (sec-*) más los generales
// que ya existían. El filtro es por id para que un skill nuevo entre solo.
const IDS_SEGURIDAD = new Set(["seguridad", "policy", "sandbox"]);
const esDeSeguridad = (id: string): boolean => id.startsWith("sec-") || IDS_SEGURIDAD.has(id);

// Entidad sintética: la política global se edita como una fila más (clic en
// politica-global). No es un skill: detalleModulo/guardarDetalleModulo la
// derivan a detallePolitica/guardarPolitica; el resto delega en skills.
export const ID_POLITICA = "politica-global";

function leerPolitica(root: string): PoliticaGlobal {
  const vacia: PoliticaGlobal = { terminal: null, delega: null, techo: { rondas: null, tokens: null, calls: null } };
  try {
    const p = join(root, "policies.global.json");
    if (!existsSync(p)) return vacia;
    const j = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return vacia;
    const o = j as Record<string, unknown>;
    const tools = (o.tools ?? {}) as Record<string, unknown>;
    const techo = (o.techo ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      terminal: typeof tools.terminal === "boolean" ? tools.terminal : null,
      delega: typeof tools.delega === "boolean" ? tools.delega : null,
      techo: { rondas: num(techo.rondas), tokens: num(techo.tokens), calls: num(techo.calls) },
    };
  } catch {
    return vacia;
  }
}

export function datosModulo(root: string): DatosSecurity {
  const skills: SkillSeguridad[] = SKILLS.filter((s) => esDeSeguridad(s.id)).map((s) => {
    let override = false;
    try {
      override = existsSync(join(root, "skills", s.id, "SKILL.md"));
    } catch {
      override = false;
    }
    return { id: s.id, descripcion: s.descripcion, cuerpo: s.cuerpo.length, override };
  });
  const politica = leerPolitica(root);
  const sinPolitica = politica.terminal === null && politica.delega === null;
  const fmtBool = (v: boolean | null): string => (v === true ? "sí" : v === false ? "no" : "sin definir");
  const fmtNum = (v: number | null): string => (v === null ? "—" : String(v));
  return {
    titulo: "Controles de seguridad",
    skills,
    politica,
    items: [
      {
        id: ID_POLITICA,
        nota: `política global · terminal=${fmtBool(politica.terminal)} delega=${fmtBool(politica.delega)} · techo rondas=${fmtNum(politica.techo.rondas)} tokens=${fmtNum(politica.techo.tokens)} calls=${fmtNum(politica.techo.calls)}`,
      },
      ...skills.map((s) => ({
        id: s.id,
        nota: `${s.override ? "override en disco" : "catálogo"} · ${s.cuerpo} B · ${s.descripcion}`,
      })),
    ],
    fuente: sinPolitica
      ? `Catálogo modules/agents/skills.ts (${skills.length} skill(s) de seguridad) · sin policies.global.json`
      : `Catálogo modules/agents/skills.ts (${skills.length} skill(s)) · política global: terminal=${politica.terminal} delega=${politica.delega} · techo rondas=${politica.techo.rondas} tokens=${politica.techo.tokens} calls=${politica.techo.calls}`,
  };
}

// --- Detalle editable -------------------------------------------------------
// Misma costura que agents/skills: la web pide una entidad y la edita como
// campos; el modo avanzado muestra el archivo real. Nada se escribe sin
// validar: si algo no cuadra se devuelve el motivo y el archivo queda intacto.
export function detalleModulo(root: string, id?: string): ResultadoDetalleSkill {
  const n = (id ?? "").trim();
  if (n === ID_POLITICA) return detallePolitica(root);
  return detalleSkill(root, id);
}

export function guardarDetalleModulo(
  root: string,
  entrada: { id?: unknown; cambios?: unknown; bruto?: unknown },
): { ok: true; msg: string } | { ok: false; error: string } {
  const id = typeof entrada.id === "string" ? entrada.id.trim() : "";
  if (id === ID_POLITICA) return guardarPolitica(root, entrada);
  return guardarDetalleSkill(root, entrada);
}

const TECHO_DEF = { rondas: 3, tokens: 100000, calls: 500 };
const TECHO_RANGOS = { rondas: [1, 100], tokens: [1, 10000000], calls: [1, 100000] } as const;

type TechoValores = { rondas: number; tokens: number; calls: number };

// Lo efectivo cuando el archivo no trae un campo: igual que loadPolicies
// (src/policy.ts): techo por defecto; terminal/delega ausentes deniegan.
function techoEfectivo(p: PoliticaGlobal): TechoValores {
  return {
    rondas: p.techo.rondas ?? TECHO_DEF.rondas,
    tokens: p.techo.tokens ?? TECHO_DEF.tokens,
    calls: p.techo.calls ?? TECHO_DEF.calls,
  };
}

function leerArchivoPolitica(root: string): { texto: string; datos: unknown } | undefined {
  try {
    const texto = readFileSync(join(root, "policies.global.json"), "utf8");
    let datos: unknown;
    try {
      datos = JSON.parse(texto) as unknown;
    } catch {
      datos = undefined;
    }
    return { texto, datos };
  } catch {
    return undefined;
  }
}

function detallePolitica(root: string): ResultadoDetalleSkill {
  const p = leerPolitica(root);
  const terminal = p.terminal ?? false;
  const delega = p.delega ?? false;
  const techo = techoEfectivo(p);
  const archivo = leerArchivoPolitica(root);
  const bruto = archivo?.texto ?? JSON.stringify({ tools: { terminal, delega }, techo }, null, 2);
  const sinDefinir: string[] = [];
  if (p.terminal === null) sinDefinir.push("terminal");
  if (p.delega === null) sinDefinir.push("delega");
  return {
    ok: true,
    detalle: {
      id: ID_POLITICA,
      bruto,
      campos: [
        {
          k: "terminal",
          etiqueta: "Terminal",
          tipo: "opciones",
          opciones: ["sí", "no"],
          ayuda: "«sí» deja a terminal en ask (riesgo alto: el broker siempre pide aprobación). «no» o sin definir lo deniega siempre.",
          valor: terminal ? "sí" : "no",
        },
        {
          k: "delega",
          etiqueta: "Delega",
          tipo: "opciones",
          opciones: ["sí", "no"],
          ayuda: "«sí» permite delegar si el proyecto también lo permite (pregunta si el proyecto no lo define). «no» o sin definir lo deniega.",
          valor: delega ? "sí" : "no",
        },
        {
          k: "techo",
          etiqueta: "Techo",
          tipo: "texto",
          ayuda: "rondas:tokens:calls (ej. 3:100000:500). Límite preventivo global: al agotarse, el orquestador se detiene.",
          valor: `${techo.rondas}:${techo.tokens}:${techo.calls}`,
        },
      ],
      avanzado: {
        titulo: "Modo avanzado — policies.global.json",
        ayuda: "El JSON tal cual vive en el proyecto. Se valida entero antes de guardar: si algo no cuadra no se escribe nada.",
        boton: "Guardar política",
      },
      nota: `Se guarda en policies.global.json. Sin definir equivale a «no»${sinDefinir.length ? ` (ahora sin definir: ${sinDefinir.join(", ")})` : ""}. La reserva del 20% para verificación la aplica el broker.`,
    },
  };
}

function parseSiNo(campo: string, v: unknown): { ok: true; valor: boolean } | { ok: false; error: string } {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (["sí", "si", "yes", "true", "1"].includes(s)) return { ok: true, valor: true };
  if (["no", "false", "0"].includes(s)) return { ok: true, valor: false };
  const recibido = typeof v === "string" ? (v.trim().slice(0, 20) || "vacío") : typeof v;
  return { ok: false, error: `${campo}: usa «sí» o «no» (recibido: ${recibido})` };
}

function parseTecho(v: unknown): { ok: true; valor: TechoValores } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: "techo: usa rondas:tokens:calls (ej. 3:100000:500)" };
  const m = /^\s*(\d+)\s*:\s*(\d+)\s*:\s*(\d+)\s*$/.exec(v);
  if (!m) return { ok: false, error: "techo: usa rondas:tokens:calls con enteros (ej. 3:100000:500)" };
  const vals: TechoValores = { rondas: Number(m[1]), tokens: Number(m[2]), calls: Number(m[3]) };
  for (const k of ["rondas", "tokens", "calls"] as const) {
    const [min, max] = TECHO_RANGOS[k];
    if (vals[k] < min || vals[k] > max) {
      return { ok: false, error: `techo.${k}: ${vals[k]} fuera de rango (${min}-${max})` };
    }
  }
  return { ok: true, valor: vals };
}

function validarFormaPolitica(j: unknown):
  | { ok: true; tools: Record<string, boolean>; techo: TechoValores }
  | { ok: false; error: string } {
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    return { ok: false, error: "la política debe ser un objeto JSON {tools, techo}" };
  }
  const o = j as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k !== "tools" && k !== "techo") return { ok: false, error: `clave desconocida: ${k} (solo tools y techo)` };
  }
  if (!o.tools || typeof o.tools !== "object" || Array.isArray(o.tools)) {
    return { ok: false, error: "falta «tools» (objeto con terminal/delega en booleano)" };
  }
  if (!o.techo || typeof o.techo !== "object" || Array.isArray(o.techo)) {
    return { ok: false, error: "falta «techo» (objeto con rondas/tokens/calls)" };
  }
  const tools: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(o.tools as Record<string, unknown>)) {
    if (typeof v !== "boolean") return { ok: false, error: `tools.${k}: debe ser booleano (recibido: ${typeof v})` };
    tools[k] = v;
  }
  for (const k of ["terminal", "delega"]) {
    if (typeof tools[k] !== "boolean") return { ok: false, error: `tools.${k}: falta o no es booleano (usa true/false)` };
  }
  const t = o.techo as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (k !== "rondas" && k !== "tokens" && k !== "calls") {
      return { ok: false, error: `techo.${k}: clave desconocida (solo rondas, tokens, calls)` };
    }
  }
  const techo: TechoValores = { rondas: 0, tokens: 0, calls: 0 };
  for (const k of ["rondas", "tokens", "calls"] as const) {
    const v = t[k];
    if (typeof v !== "number" || !Number.isInteger(v)) return { ok: false, error: `techo.${k}: debe ser entero` };
    const [min, max] = TECHO_RANGOS[k];
    if (v < min || v > max) return { ok: false, error: `techo.${k}: ${v} fuera de rango (${min}-${max})` };
    techo[k] = v;
  }
  return { ok: true, tools, techo };
}

function guardarPolitica(
  root: string,
  entrada: { id?: unknown; cambios?: unknown; bruto?: unknown },
): { ok: true; msg: string } | { ok: false; error: string } {
  let tools: Record<string, boolean>;
  let techo: TechoValores;
  if (entrada.bruto !== undefined) {
    if (typeof entrada.bruto !== "string") return { ok: false, error: "bruto debe ser texto JSON" };
    let j: unknown;
    try {
      j = JSON.parse(entrada.bruto) as unknown;
    } catch {
      return { ok: false, error: "JSON inválido: no se escribió nada" };
    }
    const v = validarFormaPolitica(j);
    if (!v.ok) return v;
    tools = v.tools;
    techo = v.techo;
  } else {
    const c = entrada.cambios;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return { ok: false, error: "cambios (objeto) o bruto (JSON) requerido" };
    }
    const cambios = c as Record<string, unknown>;
    for (const k of Object.keys(cambios)) {
      if (k !== "terminal" && k !== "delega" && k !== "techo") {
        return { ok: false, error: `campo no editable: ${k}` };
      }
    }
    const archivo = leerArchivoPolitica(root);
    if (archivo && archivo.datos === undefined) {
      return { ok: false, error: "policies.global.json ilegible: corrígelo en modo avanzado (JSON completo y válido)" };
    }
    const base = (archivo?.datos && typeof archivo.datos === "object" && !Array.isArray(archivo.datos)
      ? (archivo.datos as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const baseTools = (base.tools && typeof base.tools === "object" && !Array.isArray(base.tools) ? base.tools : {}) as Record<
      string,
      unknown
    >;
    tools = {};
    for (const [k, v] of Object.entries(baseTools)) {
      if (typeof v === "boolean") tools[k] = v;
    }
    techo = { ...techoEfectivo(leerPolitica(root)) };
    if (cambios.terminal !== undefined) {
      const r = parseSiNo("terminal", cambios.terminal);
      if (!r.ok) return r;
      tools.terminal = r.valor;
    } else if (typeof tools.terminal !== "boolean") {
      tools.terminal = false;
    }
    if (cambios.delega !== undefined) {
      const r = parseSiNo("delega", cambios.delega);
      if (!r.ok) return r;
      tools.delega = r.valor;
    } else if (typeof tools.delega !== "boolean") {
      tools.delega = false;
    }
    if (cambios.techo !== undefined) {
      const r = parseTecho(cambios.techo);
      if (!r.ok) return r;
      techo = r.valor;
    }
  }
  try {
    writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools, techo }, null, 2) + "\n");
  } catch (e) {
    return { ok: false, error: `no se pudo escribir policies.global.json: ${e instanceof Error ? e.message : String(e)}` };
  }
  return {
    ok: true,
    msg: `política global guardada · terminal=${tools.terminal ? "sí" : "no"} delega=${tools.delega ? "sí" : "no"} · techo ${techo.rondas}:${techo.tokens}:${techo.calls}`,
  };
}

export function estadoTexto(): string {
  return "security: controles editables (skills de dominio + política global + overrides)";
}
