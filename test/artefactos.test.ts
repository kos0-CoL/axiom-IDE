import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escribirManifiesto, promoverASkill, registrarArtefacto } from "../dist/server/manifiesto.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-artefactos-"));
}

test("registro + manifiesto con hash y versión", () => {
  const base = temp();
  try {
    registrarArtefacto(base, "run-1", "gen/hola.sh", "#!/bin/sh\necho hola\n", "coder-llm demo-model");
    const man = escribirManifiesto(base, "run-1", { version: "0.9.31", tests: { pasados: 10, fallados: 0 } });
    assert.equal(man.archivos.length, 1);
    assert.equal(man.archivos[0].sha256.length, 64);
    assert.ok(existsSync(join(base, ".runs", "run-1", "artefactos", "manifiesto.json")));
    const leido = JSON.parse(readFileSync(join(base, ".runs", "run-1", "artefactos", "manifiesto.json"), "utf8"));
    assert.equal(leido.version, "0.9.31");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("promoción sin revisión se bloquea (fail closed)", () => {
  const base = temp();
  try {
    registrarArtefacto(base, "run-1", "gen/hola.sh", "#!/bin/sh\necho hola\n", "origen demo");
    assert.throws(() => promoverASkill(base, "run-1", "gen/hola.sh", "demo"), /exige revisión/);
    assert.ok(!existsSync(join(base, "skills", "demo")));
    const r = promoverASkill(base, "run-1", "gen/hola.sh", "demo", { revision: true, revisor: "humano-test" });
    assert.equal(r.ok, true);
    assert.ok(existsSync(join(base, "skills", "demo", "scripts", "hola.sh.origen.txt")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
