// Módulo security — inventario de controles de seguridad (solo lectura).
// Skills: única fuente en modules/agents/skills.ts (catálogo); aquí solo se
// filtran los de dominio seguridad (sec-*, seguridad, policy, sandbox).
// Política: policies.global.json del proyecto (fail soft si no existe).
// Overrides: skills/<id>/SKILL.md en disco que reemplazan el cuerpo del catálogo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS } from "../agents/skills.js";

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
  return {
    titulo: "Controles de seguridad",
    skills,
    politica,
    items: skills.map((s) => ({
      id: s.id,
      nota: `${s.override ? "override en disco" : "catálogo"} · ${s.cuerpo} B · ${s.descripcion}`,
    })),
    fuente: sinPolitica
      ? `Catálogo modules/agents/skills.ts (${skills.length} skill(s) de seguridad) · sin policies.global.json`
      : `Catálogo modules/agents/skills.ts (${skills.length} skill(s)) · política global: terminal=${politica.terminal} delega=${politica.delega} · techo rondas=${politica.techo.rondas} tokens=${politica.techo.tokens} calls=${politica.techo.calls}`,
  };
}

export function estadoTexto(): string {
  return "security: inventario de controles (skills de dominio + política global + overrides)";
}
