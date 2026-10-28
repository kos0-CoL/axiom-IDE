import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autorizarPorBroker, invocarAgenteComoTool } from "../dist/orchestrator/agent-tool.js";

test("deny por defecto: sin allow del broker no hay delegación", async () => {
  const r = await invocarAgenteComoTool(
    { agenteId: "review", tool: "review-as-tool", descripcion: "revisa" },
    { tarea: "revisa esto", parentCallId: "run-1" },
    { autorizar: () => ({ decision: "deny", motivo: "política" }), ejecutar: () => "nunca" },
  );
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /broker/);
  assert.equal(r.traza[0].padre, "run-1");
});

test("allow delega con parent_call_id y el padre sintetiza acotado", async () => {
  const r = await invocarAgenteComoTool(
    { agenteId: "review", tool: "review-as-tool", descripcion: "revisa", maxBytesSalida: 16 },
    { tarea: "revisa esto", parentCallId: "run-7" },
    {
      autorizar: () => ({ decision: "allow" }),
      ejecutar: () => "hallazgo: falta validación de entrada, línea 3",
      sintetizar: (hijo) => `síntesis padre: ${hijo}`,
    },
  );
  assert.equal(r.ok, true);
  assert.ok(r.salida.length <= 16);
  assert.equal(r.traza[0].hijo, "run-7:review-as-tool");
  assert.equal(r.traza[0].decision, "allow");
});

test("cableado real: el broker permite lo declarado y deniega lo no declarado", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-agenttool-broker-"));
  try {
    writeFileSync(
      join(base, "agents.config.json"),
      JSON.stringify({
        config_version: 2,
        agentes: [{ id: "revisor", rol: "nodo", herramientas: [{ tool: "revisor-como-tool", acceso: "allow" }] }],
        aristas: [],
      }),
    );
    const autorizar = autorizarPorBroker(base, "test-broker");
    const ok = await invocarAgenteComoTool(
      { agenteId: "revisor", tool: "revisor-como-tool", descripcion: "revisa" },
      { tarea: "revisa demo/a.txt", parentCallId: "run-broker" },
      { autorizar, ejecutar: () => "hallazgo: falta validación (línea 3)" },
    );
    assert.equal(ok.ok, true);
    assert.match(ok.salida, /hallazgo/);
    const no = await invocarAgenteComoTool(
      { agenteId: "revisor", tool: "otra-tool", descripcion: "otra" },
      { tarea: "haz algo", parentCallId: "run-broker" },
      { autorizar, ejecutar: () => "nunca" },
    );
    assert.equal(no.ok, false);
    assert.match(no.error ?? "", /deny|denegado/i);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tarea vacía y timeout fallan cerrado", async () => {
  const vacia = await invocarAgenteComoTool(
    { agenteId: "x", tool: "x-as-tool", descripcion: "x" },
    { tarea: "   ", parentCallId: "p" },
    { autorizar: () => ({ decision: "allow" }), ejecutar: () => "y" },
  );
  assert.equal(vacia.ok, false);
  const lenta = await invocarAgenteComoTool(
    { agenteId: "x", tool: "x-as-tool", descripcion: "x", timeoutMs: 10 },
    { tarea: "haz algo", parentCallId: "p" },
    { autorizar: () => ({ decision: "allow" }), ejecutar: () => new Promise((res) => setTimeout(() => res("tarde"), 100)) },
  );
  assert.equal(lenta.ok, false);
  assert.match(lenta.error ?? "", /timeout/);
});
