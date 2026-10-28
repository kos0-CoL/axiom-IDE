import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatterSkill, serializarSkillEstandar } from "../dist/modules/skills/frontmatter.js";
import { ejecutarScriptSkill } from "../dist/modules/skills/runner.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-skills-std-"));
}

test("frontmatter nuevo se parsea y el viejo se acepta sin romper", () => {
  const nuevo = `---\nname: demo\ndescription: hace demos\ncompatibility: axiom>=0.9\n---\n\nInstruye así.\n`;
  const p = parseFrontmatterSkill(nuevo);
  assert.equal(p.name, "demo");
  assert.equal(p.descripcion, "hace demos");
  assert.equal(p.compatibility, "axiom>=0.9");
  assert.match(p.cuerpo, /Instruye/);
  const viejo = `# SKILL: demo\n\nObjetivo: hace demos.\n\n## Cómo trabajar con esta skill\nInstruye así.\n`;
  const v = parseFrontmatterSkill(viejo);
  assert.ok(v.cuerpo.length > 0);
  assert.equal(parseFrontmatterSkill("").error !== undefined, true);
});

test("serializar produce frontmatter estándar re-parseable", () => {
  const md = serializarSkillEstandar({ name: "x", descripcion: "d", cuerpo: "Haz esto." });
  const p = parseFrontmatterSkill(md);
  assert.equal(p.name, "x");
  assert.equal(p.descripcion, "d");
  assert.match(p.cuerpo, /Haz esto/);
});

test("runner ejecuta script del skill y bloquea escapes", () => {
  const base = temp();
  try {
    mkdirSync(join(base, "skills", "demo"), { recursive: true });
    writeFileSync(join(base, "skills", "demo", "SKILL.md"), serializarSkillEstandar({ name: "demo", descripcion: "d", cuerpo: "c" }));
    writeFileSync(join(base, "skills", "demo", "hola.sh"), `#!/bin/sh\necho hola-skill\n`);
    const r = ejecutarScriptSkill(base, "demo", "hola.sh", { timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.match(r.salida, /hola-skill/);
    assert.equal(r.sha256.length, 64);
    assert.throws(() => ejecutarScriptSkill(base, "demo", "../../fuera.sh"), /fuera del skill/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("script destructivo exige dry-run y nunca expone secrets", () => {
  const base = temp();
  try {
    mkdirSync(join(base, "skills", "demo"), { recursive: true });
    writeFileSync(join(base, "skills", "demo", "borra.sh"), `#!/bin/sh\nrm -rf /tmp/algo\n`);
    const sinDry = ejecutarScriptSkill(base, "demo", "borra.sh");
    assert.equal(sinDry.ok, false);
    assert.match(sinDry.error ?? "", /dry-run/i);
    const conDry = ejecutarScriptSkill(base, "demo", "borra.sh", { dryRun: true, envPermitido: { MI_KEY: "secreto" } });
    assert.equal(conDry.ok, true);
    assert.match(conDry.salida, /dry-run/);
    assert.ok(!conDry.salida.includes("secreto"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
