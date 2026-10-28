// Frontmatter estándar Agent Skills — compatible hacia atrás.
// Acepta SKILL.md nuevo (--- name/description/compatibility --- + cuerpo)
// y viejo (formato Axiom `# SKILL:` / `Objetivo:` o sin frontmatter).
// Nunca lanza: lo ilegible devuelve cuerpo vacío con error.
export interface FrontmatterSkill {
  name?: string;
  descripcion?: string;
  compatibility?: string;
  cuerpo: string;
  error?: string;
}

const MAX_CUERPO = 4000;
const MAX_DESC = 160;

function limpiar(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/^﻿/, "");
}

function valorCampo(linea: string): string {
  return linea.slice(linea.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
}

export function parseFrontmatterSkill(texto: string): FrontmatterSkill {
  const limpio = limpiar(texto);
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(limpio);
  if (!fm) {
    // Formato viejo: delega el cuerpo tal cual (el lector viejo lo recorta).
    const cuerpo = limpio.trim().slice(0, MAX_CUERPO);
    if (!cuerpo) return { cuerpo: "", error: "SKILL.md vacío" };
    return { cuerpo };
  }
  let name: string | undefined;
  let descripcion: string | undefined;
  let compatibility: string | undefined;
  for (const linea of fm[1].split("\n")) {
    const t = linea.trim();
    if (/^name\s*:/i.test(t)) name = valorCampo(t).slice(0, 64);
    else if (/^description\s*:/i.test(t)) descripcion = valorCampo(t).slice(0, MAX_DESC);
    else if (/^descripcion\s*:/i.test(t)) descripcion = valorCampo(t).slice(0, MAX_DESC);
    else if (/^compatibility\s*:/i.test(t)) compatibility = valorCampo(t).slice(0, 160);
  }
  const cuerpo = limpio.slice(fm[0].length).trim().slice(0, MAX_CUERPO);
  const out: FrontmatterSkill = { cuerpo };
  if (name) out.name = name;
  if (descripcion) out.descripcion = descripcion;
  if (compatibility) out.compatibility = compatibility;
  if (!cuerpo) out.error = "SKILL.md sin cuerpo utilizable tras el frontmatter";
  else if (!descripcion) out.error = "sin description en el frontmatter (se acepta, pero el selector mostrará el id)";
  return out;
}

/** Serializa al formato estándar (lo que guardarSkill escribirá a futuro). */
export function serializarSkillEstandar(datos: { name: string; descripcion: string; compatibility?: string; cuerpo: string }): string {
  const comp = datos.compatibility?.trim() ? `\ncompatibility: ${datos.compatibility.trim()}` : "";
  return `---\nname: ${datos.name}\ndescription: ${datos.descripcion}${comp}\n---\n\n${datos.cuerpo.trim()}\n`;
}
