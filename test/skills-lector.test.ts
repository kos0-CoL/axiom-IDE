import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardarSkill, leerSkill, cuerpoEfectivo, listarScriptsSkill } from "../dist/modules/skills/index.js";
import { construirSkillsRun } from "../dist/commands.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-skillslec-"));
}

test("guardar escribe estándar y leer lo devuelve", () => {
  const base = temp();
  try {
    const g = guardarSkill(base, "demo", { descripcion: "hace demos", cuerpo: "Instruye así." });
    assert.equal(g.ok, true);
    assert.match(readFileSync(join(base, "skills", "demo", "SKILL.md"), "utf8"), /^---\nname: demo\ndescription: hace demos/);
    const l = leerSkill(base, "demo");
    assert.equal(l.ok, true);
    if (l.ok) {
      assert.equal(l.skill.descripcion, "hace demos");
      assert.match(l.skill.cuerpo, /Instruye/);
      assert.equal(cuerpoEfectivo(base, "demo"), "Instruye así.");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("las skills viejas se siguen leyendo sin cambios", () => {
  const base = temp();
  try {
    mkdirSync(join(base, "skills", "vieja"), { recursive: true });
    writeFileSync(join(base, "skills", "vieja", "SKILL.md"), "# SKILL: vieja\n\nObjetivo: hace cosas viejas.\n\n## Cómo trabajar con esta skill\nHazlo así.\n");
    const l = leerSkill(base, "vieja");
    assert.equal(l.ok, true);
    if (l.ok) {
      assert.equal(l.skill.descripcion, "hace cosas viejas");
      assert.match(l.skill.cuerpo, /Hazlo/);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("skills run ejecuta el script y lo destructivo exige dry-run", () => {
  const base = temp();
  try {
    guardarSkill(base, "demo", { descripcion: "d", cuerpo: "c" });
    mkdirSync(join(base, "skills", "demo", "scripts"), { recursive: true });
    writeFileSync(join(base, "skills", "demo", "scripts", "hola.sh"), "#!/bin/sh\necho hola-run\n");
    writeFileSync(join(base, "skills", "demo", "scripts", "borra.sh"), "#!/bin/sh\nrm -rf /tmp/algo\n");
    assert.deepEqual(listarScriptsSkill(base, "demo"), ["scripts/borra.sh", "scripts/hola.sh"]);
    const ok = construirSkillsRun(base, "demo", "scripts/hola.sh");
    assert.equal(ok.code, 0);
    assert.match(ok.msg, /hola-run/);
    const no = construirSkillsRun(base, "demo", "scripts/borra.sh");
    assert.equal(no.code, 1);
    assert.match(no.msg, /dry-run/i);
    const dry = construirSkillsRun(base, "demo", "scripts/borra.sh", true);
    assert.equal(dry.code, 0);
    const mala = construirSkillsRun(base, "demo", "no-existe.sh");
    assert.equal(mala.code, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
