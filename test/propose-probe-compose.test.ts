import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componerAnteFallo, probarVariantes } from "../dist/orchestrator/variantes.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-variantes-"));
}

test("la variante que pasa se compone y la mala se descarta", () => {
  const { ganadora, probes } = probarVariantes([
    { id: "v1", descripcion: "base con cháchara", producir: () => "Aquí tienes el código:\nconst a = 1;\n" },
    { id: "v2", descripcion: "raw", producir: () => "export const a = 1;\n" },
  ]);
  assert.equal(probes.length, 2);
  assert.equal(ganadora?.id, "v2");
  assert.ok(ganadora?.codigo?.includes("export const a"));
});

test("si ninguna pasa no hay ganadora (pausar como hoy)", () => {
  const { ganadora } = probarVariantes([
    { id: "v1", descripcion: "vacía", producir: () => "" },
    { id: "v2", descripcion: "truncada", producir: () => "function f( {" },
  ]);
  assert.equal(ganadora, undefined);
});

test("el ciclo registra la lección en EXPERIENCE.md con evidencia", () => {
  const base = temp();
  try {
    const r = componerAnteFallo(base, "demo-tarea", "cháchara del prompt base", [
      { id: "v1", descripcion: "base", producir: () => "x" },
      { id: "v2", descripcion: "raw", producir: () => "export const b = 2;\n" },
    ]);
    assert.equal(r.ganadora, "v2");
    const exp = readFileSync(join(base, "EXPERIENCE.md"), "utf8");
    assert.match(exp, /v2.*ganó/);
    assert.match(exp, /demo-tarea/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
