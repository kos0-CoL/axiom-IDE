import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarTasksDesdePlan, resolverSpecBuild, rutasValidas } from "../dist/orchestrator/desde-plan.js";

function proyectoConPlan(): string {
  const base = mkdtempSync(join(tmpdir(), "axiom-plan-tasks-"));
  mkdirSync(join(base, "specs", "active", "demo1"), { recursive: true });
  writeFileSync(join(base, "specs", "active", "demo1", "spec.md"), "# Spec demo1\n\n## Criterios\n\n- [ ] Servir hola.\n");
  writeFileSync(join(base, "specs", "active", "demo1", "plan.md"), "# Plan demo1\n\n1. Crear src/hola.ts.\n2. Crear test/hola.test.ts.\n");
  return base;
}

test("resolverSpecBuild acepta id y ruta, rechaza escapes", () => {
  assert.equal(resolverSpecBuild("demo1"), "specs/active/demo1/tasks.md");
  assert.equal(resolverSpecBuild(".speckit/build.md"), ".speckit/build.md");
  assert.equal(resolverSpecBuild("specs/active/x/tasks.md"), "specs/active/x/tasks.md");
  assert.throws(() => resolverSpecBuild("../fuera.md"), /fuera del proyecto/);
  assert.throws(() => resolverSpecBuild("/abs.md"), /fuera del proyecto/);
  assert.throws(() => resolverSpecBuild("con espacios"), /inválido/);
});

test("rutasValidas mata frases y conserva rutas sanas", () => {
  const md = "- [ ] src/hola.ts\n- [ ] Cumplir el objetivo solicitado y los pasos del plan aprobado.\n- [ ] ../escape.ts\n- [ ] /absoluta.ts\n- [ ] src/hola.ts\n";
  assert.deepEqual(rutasValidas(md), ["src/hola.ts"]);
});

test("reutiliza tasks.md existente sin llamar al proveedor", async () => {
  const base = proyectoConPlan();
  try {
    writeFileSync(join(base, "specs", "active", "demo1", "tasks.md"), "# Tasks\n\n- [X] src/ya.ts\n- [ ] src/otro.ts\n");
    let llamadas = 0;
    const r = await asegurarTasksDesdePlan(base, "demo1", async () => { llamadas++; return ""; });
    assert.equal(r.ok, true);
    assert.equal(r.creadas, false);
    assert.equal(llamadas, 0, "no debió llamar al proveedor");
    assert.deepEqual(r.archivos, ["src/ya.ts", "src/otro.ts"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("deriva tasks con una llamada y filtra basura (fences, frases, escapes)", async () => {
  const base = proyectoConPlan();
  try {
    const r = await asegurarTasksDesdePlan(base, "demo1", async (prompt) => {
      assert.ok(prompt.includes("src/hola.ts") || prompt.includes("demo1"), "el prompt lleva spec+plan");
      return "```\n- [ ] src/hola.ts\n- [ ] Cumplir el objetivo y los pasos.\n- [ ] test/hola.test.ts\n- [ ] ../../escape.ts\n```\n";
    });
    assert.equal(r.ok, true);
    assert.equal(r.creadas, true);
    assert.deepEqual(r.archivos, ["src/hola.ts", "test/hola.test.ts"]);
    const doc = readFileSync(join(base, "specs", "active", "demo1", "tasks.md"), "utf8");
    assert.ok(doc.includes("- [ ] src/hola.ts") && doc.includes("- [ ] test/hola.test.ts"));
    assert.ok(!doc.includes("Cumplir") && !doc.includes("escape"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("fail closed: sin rutas válidas no escribe; sin spec no deriva; fallo del proveedor no escribe", async () => {
  const base = proyectoConPlan();
  try {
    const soloBasura = await asegurarTasksDesdePlan(base, "demo1", async () => "- [ ] Cumplir todo lo pedido.");
    assert.equal(soloBasura.ok, false);
    assert.ok(!existsSync(join(base, "specs", "active", "demo1", "tasks.md")), "basura no se persiste");
    const sinSpec = await asegurarTasksDesdePlan(base, "no-existe", async () => "- [ ] src/x.ts");
    assert.equal(sinSpec.ok, false);
    const proveedorRoto = await asegurarTasksDesdePlan(base, "demo1", async () => { throw new Error("sin red"); });
    assert.equal(proveedorRoto.ok, false);
    assert.ok((proveedorRoto.error ?? "").includes("sin red"));
    assert.ok(!existsSync(join(base, "specs", "active", "demo1", "tasks.md")));
    const idMalo = await asegurarTasksDesdePlan(base, "../mal", async () => "- [ ] src/x.ts");
    assert.equal(idMalo.ok, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
