import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listarSkills,
  leerSkill,
  guardarSkill,
  borrarSkill,
  cuerpoEfectivo,
  descripcionEfectiva,
  ignoradosSkills,
  datosSkills,
  parseSkillMd,
  detalleModulo as detalleSkill,
  guardarDetalleModulo as guardarDetalleSkill,
} from "../dist/modules/skills/index.js";
import { SKILLS, skillMarkdown } from "../dist/modules/agents/skills.js";
import { construirPromptAgente } from "../dist/modules/agents/ejecucion.js";
import { asegurarProyecto } from "../dist/proyectos.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-skills-mod-"));
}

test("sin proyecto, el módulo lista el catálogo completo y nada override", () => {
  const base = temp();
  try {
    const skills = listarSkills(base);
    assert.equal(skills.length, SKILLS.length);
    assert.ok(skills.every((s) => s.origen === "catalogo" && s.enCatalogo && s.tieneCuerpo && !s.override));
    assert.deepEqual(ignoradosSkills(base), []);
    const d = datosSkills(base);
    assert.equal(d.total, SKILLS.length);
    assert.equal(d.overrides, 0);
    assert.equal(d.propios, 0);
    assert.equal(d.sinCuerpo, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("un id nuevo del proyecto aparece como propio y su cuerpo es el efectivo", () => {
  const base = temp();
  try {
    const r = guardarSkill(base, "mi-skill", { descripcion: "mi habilidad", cuerpo: "Haz exactamente esto." });
    assert.equal(r.ok, true, r.error);
    assert.ok(existsSync(join(base, "skills", "mi-skill", "SKILL.md")));
    const s = listarSkills(base).find((x) => x.id === "mi-skill");
    assert.ok(s);
    assert.equal(s?.origen, "proyecto");
    assert.equal(s?.enCatalogo, false);
    assert.equal(s?.override, false);
    assert.equal(s?.descripcion, "mi habilidad");
    assert.equal(cuerpoEfectivo(base, "mi-skill"), "Haz exactamente esto.");
    assert.equal(descripcionEfectiva(base, "mi-skill"), "mi habilidad");
    assert.equal(datosSkills(base).propios, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("un skill del catálogo con archivo distinto pasa a override y se revierte al borrarlo", () => {
  const base = temp();
  try {
    const basePlan = SKILLS.find((s) => s.id === "plan");
    assert.ok(basePlan);
    assert.equal(guardarSkill(base, "plan", { descripcion: "plan propio", cuerpo: "Plan en dos pasos." }).ok, true);
    const s = listarSkills(base).find((x) => x.id === "plan");
    assert.equal(s?.origen, "override");
    assert.equal(s?.override, true);
    assert.equal(s?.descripcion, "plan propio");
    assert.equal(cuerpoEfectivo(base, "plan"), "Plan en dos pasos.");
    assert.equal(datosSkills(base).overrides, 1);

    const borrado = borrarSkill(base, "plan");
    assert.equal(borrado.ok, true, borrado.error);
    assert.match(borrado.msg ?? "", /override de plan eliminado/);
    assert.ok(!existsSync(join(base, "skills", "plan", "SKILL.md")));
    const despues = listarSkills(base).find((x) => x.id === "plan");
    assert.equal(despues?.origen, "catalogo");
    assert.equal(cuerpoEfectivo(base, "plan"), basePlan?.cuerpo);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("borrar la copia sembrada (idéntica al catálogo) no se reporta como override", () => {
  const base = temp();
  try {
    assert.equal(asegurarProyecto(join(base, "p")).ok, true);
    const r = borrarSkill(join(base, "p"), "plan");
    assert.equal(r.ok, true, r.error);
    assert.match(r.msg ?? "", /copia sembrada/);
    assert.equal(cuerpoEfectivo(join(base, "p"), "plan"), SKILLS.find((s) => s.id === "plan")?.cuerpo);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("borrar un skill del catálogo sin archivo propio no inventa un override", () => {
  const base = temp();
  try {
    const r = borrarSkill(base, "verify");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /no tiene archivo propio/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("parsea el formato que escribe Axiom y el frontmatter de un archivo a mano", () => {
  const generado = skillMarkdown({ id: "plan", descripcion: "planificación", cuerpo: "Paso uno.\nPaso dos." });
  const parse = parseSkillMd(generado);
  assert.equal(parse.descripcion, "planificación");
  assert.equal(parse.cuerpo, "Paso uno.\nPaso dos.");

  const manual = parseSkillMd("---\ndescripcion: revisar diffs\n---\n\nMira el diff completo antes de opinar.\n");
  assert.equal(manual.descripcion, "revisar diffs");
  assert.match(manual.cuerpo ?? "", /Mira el diff completo/);
});

test("un SKILL.md sin cuerpo queda marcado y no reemplaza al catálogo", () => {
  const base = temp();
  try {
    mkdirSync(join(base, "skills", "lint"), { recursive: true });
    writeFileSync(join(base, "skills", "lint", "SKILL.md"), "# SKILL: lint\n\nObjetivo: revisar estilo.\n");
    const s = listarSkills(base).find((x) => x.id === "lint");
    assert.equal(s?.tieneCuerpo, false);
    assert.match(s?.error ?? "", /sin cuerpo/);
    assert.equal(cuerpoEfectivo(base, "lint"), undefined);
    const leido = leerSkill(base, "lint");
    assert.equal(leido.ok, true);
    if (leido.ok) assert.equal(leido.skill.cuerpo, "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("valida ids y tamaños antes de escribir, y no lista carpetas con id inválido", () => {
  const base = temp();
  try {
    assert.equal(guardarSkill(base, "Mi-Skill", { descripcion: "x", cuerpo: "y" }).ok, false);
    assert.equal(guardarSkill(base, "ok", { descripcion: "", cuerpo: "y" }).ok, false);
    assert.equal(guardarSkill(base, "ok", { descripcion: "x", cuerpo: "" }).ok, false);
    assert.equal(guardarSkill(base, "ok", { descripcion: "x".repeat(161), cuerpo: "y" }).ok, false);
    assert.equal(guardarSkill(base, "ok", { descripcion: "x", cuerpo: "y".repeat(4001) }).ok, false);

    mkdirSync(join(base, "skills", "Con Mayusculas"), { recursive: true });
    writeFileSync(join(base, "skills", "Con Mayusculas", "SKILL.md"), "texto");
    assert.deepEqual(ignoradosSkills(base), ["Con Mayusculas"]);
    assert.equal(listarSkills(base).some((s) => s.id === "Con Mayusculas"), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el prompt del agente recibe el cuerpo del proyecto, no el del catálogo", () => {
  const base = temp();
  try {
    const agente = {
      id: "nodo-test",
      rol: "nodo" as const,
      modelo: "hereda-proveedor",
      estado: "activo" as const,
      skills: ["plan"],
      instrucciones: "",
      herramientas: [],
    };
    const catalogo = construirPromptAgente(agente, "t", "c", "spec");
    assert.ok(catalogo.includes(SKILLS.find((s) => s.id === "plan")!.cuerpo));

    assert.equal(guardarSkill(base, "plan", { descripcion: "plan propio", cuerpo: "Cuerpo del proyecto." }).ok, true);
    const conProyecto = construirPromptAgente(agente, "t", "c", "spec", base);
    assert.match(conProyecto, /Cuerpo del proyecto\./);
    assert.ok(!conProyecto.includes(SKILLS.find((s) => s.id === "plan")!.cuerpo));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el editor recibe el contenido crudo del archivo", () => {
  const base = temp();
  try {
    assert.equal(guardarSkill(base, "mi-skill", { descripcion: "d", cuerpo: "c" }).ok, true);
    const leido = leerSkill(base, "mi-skill");
    assert.equal(leido.ok, true);
    if (leido.ok) {
      assert.match(leido.skill.crudo ?? "", /---\nname: mi-skill\ndescription: d/);
      assert.equal(leido.skill.ruta, "skills/mi-skill/SKILL.md");
      assert.ok(readFileSync(join(base, "skills", "mi-skill", "SKILL.md"), "utf8").includes("c"));
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el detalle de un skill trae campos, ayuda y el SKILL.md completo", () => {
  const base = temp();
  try {
    const r = detalleSkill(base, "plan");
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.deepEqual(r.detalle.campos.map((c) => c.k), ["descripcion", "cuerpo"]);
    for (const c of r.detalle.campos) assert.ok(c.ayuda.length > 10, `sin ayuda en ${c.k}`);
    assert.match(r.detalle.bruto, /# SKILL: plan/);
    assert.equal(r.detalle.campos[1].valor, SKILLS.find((s) => s.id === "plan")!.cuerpo);
    assert.equal(r.detalle.avanzado.boton, "Guardar SKILL.md");
    assert.match(r.detalle.nota, /skills\/plan\/SKILL\.md/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("guardar el detalle escribe el SKILL.md del proyecto y pasa a override", () => {
  const base = temp();
  try {
    const r = guardarDetalleSkill(base, { id: "plan", cambios: { descripcion: "plan propio", cuerpo: "Cuerpo del proyecto." } });
    assert.ok(r.ok, r.ok ? "" : r.error);
    const s = listarSkills(base).find((x) => x.id === "plan");
    assert.equal(s?.origen, "override");
    assert.equal(cuerpoEfectivo(base, "plan"), "Cuerpo del proyecto.");
    assert.match(readFileSync(join(base, "skills", "plan", "SKILL.md"), "utf8"), /plan propio/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el modo avanzado acepta el markdown del usuario y lo normaliza", () => {
  const base = temp();
  try {
    const md = "# SKILL: nuevo\n\nObjetivo: prueba.\n\n## Cómo trabajar con esta skill\nHaz la cosa.\n";
    const r = guardarDetalleSkill(base, { id: "nuevo", bruto: md });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(cuerpoEfectivo(base, "nuevo"), "Haz la cosa.");
    assert.match(readFileSync(join(base, "skills", "nuevo", "SKILL.md"), "utf8"), /^---\nname: nuevo\ndescription: prueba/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("un skill inválido se rechaza sin escribir nada", () => {
  const base = temp();
  try {
    const antes = listarSkills(base).length;
    const casos: { entrada: { cambios?: Record<string, unknown>; bruto?: unknown }; espera: RegExp }[] = [
      { entrada: { cambios: { descripcion: "d", cuerpo: "" } }, espera: /cuerpo requerido/ },
      { entrada: { cambios: { descripcion: "", cuerpo: "c" } }, espera: /descripción requerida/ },
      { entrada: { cambios: { id: "otro" } }, espera: /campo no editable/ },
      { entrada: { bruto: "# SKILL: x\n" }, espera: /necesita descripción y cuerpo/ },
      { entrada: { bruto: 42 }, espera: /texto markdown/ },
    ];
    for (const c of casos) {
      const r = guardarDetalleSkill(base, { id: "plan", ...c.entrada });
      assert.equal(r.ok, false, JSON.stringify(c.entrada));
      if (!r.ok) assert.match(r.error, c.espera);
    }
    assert.ok(!existsSync(join(base, "skills", "plan", "SKILL.md")), "no se creó archivo");
    assert.equal(listarSkills(base).length, antes);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
