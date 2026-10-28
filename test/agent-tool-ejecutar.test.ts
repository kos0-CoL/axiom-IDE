import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autorizarPorBroker, ejecutarConRoster, invocarAgenteComoTool } from "../dist/orchestrator/agent-tool.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-agentexec-"));
}

function roster(base: string, estado = "activo"): void {
  writeFileSync(
    join(base, "agents.config.json"),
    JSON.stringify({
      config_version: 2,
      agentes: [{ id: "revisor", rol: "nodo", estado, herramientas: [{ tool: "revisor-como-tool", acceso: "allow" }] }],
      aristas: [],
    }),
  );
}

const SPAWN_OK = () => ({ ok: true, text: "hallazgo: falta validación (línea 3)", ms: 1, proveedor: "t", model: "m" });

test("ejecutarConRoster usa el roster y el spawn con el prompt del agente", async () => {
  const base = temp();
  try {
    roster(base);
    let promptVisto = "";
    const texto = await ejecutarConRoster(base, "revisor", "revisa demo/a.txt", {
      spawnFn: (p) => {
        promptVisto = p;
        return SPAWN_OK();
      },
    });
    assert.match(texto, /hallazgo/);
    assert.match(promptVisto, /revisor/);
    assert.match(promptVisto, /revisa demo\/a\.txt/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("fail closed: inexistente, pausado, spawn fallido o vacío", async () => {
  const base = temp();
  try {
    roster(base);
    await assert.rejects(() => ejecutarConRoster(base, "nadie", "haz algo", { spawnFn: SPAWN_OK }), /inexistente/);
    await assert.rejects(
      () => ejecutarConRoster(base, "revisor", "   ", { spawnFn: SPAWN_OK }),
      /vacía/,
    );
    await assert.rejects(
      () => ejecutarConRoster(base, "revisor", "haz algo", { spawnFn: () => ({ ok: false, error: "boom", ms: 1, proveedor: "t", model: "m" }) }),
      /spawn falló/,
    );
    const base2 = temp();
    try {
      roster(base2, "pausado");
      await assert.rejects(() => ejecutarConRoster(base2, "revisor", "haz algo", { spawnFn: SPAWN_OK }), /no activo/);
    } finally {
      rmSync(base2, { recursive: true, force: true });
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("circuito completo: broker + roster + padre que sintetiza", async () => {
  const base = temp();
  try {
    roster(base);
    const r = await invocarAgenteComoTool(
      { agenteId: "revisor", tool: "revisor-como-tool", descripcion: "revisa" },
      { tarea: "revisa demo/a.txt", parentCallId: "run-e2e" },
      {
        autorizar: autorizarPorBroker(base, "test-e2e"),
        ejecutar: (_tarea, o) => ejecutarConRoster(base, "revisor", _tarea, { ...o, spawnFn: SPAWN_OK }),
        sintetizar: (hijo) => `padre: ${hijo}`,
      },
    );
    assert.equal(r.ok, true);
    assert.match(r.salida, /^padre: hallazgo/);
    assert.equal(r.traza[0].decision, "allow");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
