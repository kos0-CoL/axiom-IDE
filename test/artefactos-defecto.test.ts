import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentOrchestrator } from "../dist/orchestrator/orchestrator.js";
import { runIdParaSpec } from "../dist/server/run-log.js";
import { escribirSpecPlan } from "../dist/nodes/architect.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-artdef-"));
}

test("el build completo registra artefactos y escribe manifiesto", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/a.txt"], "plan");
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "export const a = 1;\n",
      emitir: () => {},
      version: "test-1",
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "completo");
    const dir = join(base, ".runs", runIdParaSpec(specRel), "artefactos");
    const reg = readFileSync(join(dir, "registro.jsonl"), "utf8").trim().split("\n");
    assert.equal(reg.length, 1);
    assert.match(reg[0], /demo\/a\.txt/);
    assert.match(reg[0], /[a-f0-9]{64}/);
    const man = JSON.parse(readFileSync(join(dir, "manifiesto.json"), "utf8"));
    assert.equal(man.version, "test-1");
    assert.equal(man.archivos.length, 1);
    assert.equal(man.tests.pasados, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el build pausado deja registro parcial sin manifiesto", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/roto.txt"], "plan");
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "x",
      emitir: () => {},
      construirVariantes: () => [],
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "pausado");
    const dir = join(base, ".runs", runIdParaSpec(specRel), "artefactos");
    assert.ok(!existsSync(join(dir, "manifiesto.json")));
    assert.ok(!existsSync(join(dir, "registro.jsonl")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("artefactos:false apaga el rastro", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/a.txt"], "plan");
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "export const a = 1;\n",
      emitir: () => {},
      artefactos: false,
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "completo");
    assert.ok(!existsSync(join(base, ".runs")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
