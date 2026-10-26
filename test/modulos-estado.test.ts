import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ESTADOS_CABLEADO, estadoCableadoModulo, estadoSegunExports, listarModulos } from "../dist/modulos.js";

test("el estado sale de los exports, no de una lista fija", () => {
  assert.equal(estadoSegunExports([], false), "esqueleto");
  assert.equal(estadoSegunExports(["NOMBRE", "estadoTexto"], false), "esqueleto");
  assert.equal(estadoSegunExports(["NOMBRE", "estadoTexto", "datosModulo"], false), "datos");
  assert.equal(estadoSegunExports(["NOMBRE", "datosModulo", "datosGrafos"], false), "completo");
  assert.equal(estadoSegunExports([], true), "completo");
});

test("los módulos nativos se clasifican por lo que exporta su entrada", () => {
  assert.equal(estadoCableadoModulo("agents"), "completo", "agents expone superficie propia sin datosModulo");
  assert.equal(estadoCableadoModulo("telegram"), "completo", "telegram reexporta su superficie");
  assert.equal(estadoCableadoModulo("grafos"), "completo", "grafos suma datosGrafos a datosModulo");
  assert.equal(estadoCableadoModulo("kanban"), "datos", "kanban solo cumple el contrato de datos");
  assert.equal(estadoCableadoModulo("no-existe"), "esqueleto", "sin entrada no hay nada que servir");
});

test("listarModulos publica el estado derivado y cableado coherente", () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-estado-"));
  try {
    const lista = listarModulos(base);
    assert.ok(lista.length > 0, "no se listó ningún módulo");
    for (const m of lista) {
      assert.ok(ESTADOS_CABLEADO.includes(m.estado), `${m.nombre}: estado inválido ${m.estado}`);
      assert.equal(m.cableado, m.estado !== "esqueleto", `${m.nombre}: cableado no deriva del estado`);
    }
    assert.equal(lista.find((m) => m.nombre === "agents")?.estado, "completo");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
