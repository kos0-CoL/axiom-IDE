import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentOrchestrator } from "../dist/orchestrator/orchestrator.js";
import { sanearCodigo } from "../dist/orchestrator/variantes.js";
import { escribirSpecPlan } from "../dist/nodes/architect.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-varorq-"));
}

test("sanearCodigo quita cercas y cháchara previa", () => {
  const out = sanearCodigo("```js\nAquí tienes el código:\n```\nexport const a = 1;\n```\n");
  assert.equal(out, "export const a = 1;\n");
});

test("el orquestador compone la variante saneada sin contar fallo", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/a.txt"], "plan");
    const eventos: string[] = [];
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "Aquí tienes el código:\nexport const a = 1;\n",
      emitir: (e) => eventos.push(e.type),
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "completo");
    assert.deepEqual(r.fallos, {});
    assert.ok(existsSync(join(base, "demo", "a.txt")));
    assert.match(readFileSync(join(base, specRel), "utf8"), /- \[X\] demo\/a\.txt/);
    const exp = readFileSync(join(base, "EXPERIENCE.md"), "utf8");
    assert.match(exp, /v2-saneado-local.*ganó/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("si ninguna variante pasa, pausa como hoy", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/roto.txt"], "plan");
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "x",
      emitir: () => {},
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "pausado");
    assert.equal(r.fallos["demo/roto.txt"], 3);
    assert.ok(!existsSync(join(base, "demo", "roto.txt")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("construirVariantes vacío desactiva el ciclo (pausa al primer tope)", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/roto.txt"], "plan");
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "x",
      emitir: () => {},
      maxFallos: 1,
      construirVariantes: () => [],
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "pausado");
    assert.equal(r.fallos["demo/roto.txt"], 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
