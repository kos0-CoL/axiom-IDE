import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buscarExterno, enriquecerConBusqueda } from "../dist/modules/buscar/index.js";
import { decide } from "../dist/broker.js";
import { declaracionDeHerramienta } from "../dist/modules/agents/declaracion.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-buscar-"));
}

function roster(base: string, acceso: "allow" | "ask" | "deny" = "allow"): void {
  writeFileSync(
    join(base, "agents.config.json"),
    JSON.stringify({
      config_version: 2,
      agentes: [{ id: "explorador", rol: "nodo", herramientas: [{ tool: "buscar", acceso }] }],
      aristas: [],
    }),
  );
}

// Riesgo alto (openWorld): la política solo lo deja en ask aunque global lo
// permita; el allow llega consumiendo una aprobación humana vigente.
function politicaAsk(base: string): void {
  writeFileSync(join(base, "policies.global.json"), JSON.stringify({ tools: { buscar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }));
}

const FETCH_OK = () =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        results: [
          { title: "Ref uno", url: "https://ejemplo.test/1", text: "snippet uno" },
          { title: "Ref dos", url: "https://ejemplo.test/2", text: "snippet dos" },
        ],
      }),
  });

test("approval loop: ask → aprobar → allow con contexto acotado", async () => {
  const base = temp();
  try {
    roster(base);
    politicaAsk(base);
    process.env.EXA_API_KEY = "test-key";
    try {
      let red = 0;
      const spy = () => {
        red++;
        return FETCH_OK();
      };
      const p1 = await enriquecerConBusqueda(base, "explorador", "harness agentico", { fetchFn: spy });
      assert.equal(p1.estado, "pendiente");
      assert.equal(red, 0);
      if (p1.estado !== "pendiente") return;
      const d = decide(base, p1.approvalId, true, "test", 30, declaracionDeHerramienta(base, "explorador", "buscar"));
      assert.equal(d.ok, true);
      const p2 = await enriquecerConBusqueda(base, "explorador", "harness agentico", { fetchFn: spy });
      assert.equal(p2.estado, "ok");
      assert.equal(red, 1);
      if (p2.estado === "ok") {
        assert.equal(p2.resultados.length, 2);
        assert.match(p2.contexto, /Ref uno/);
        assert.match(p2.contexto, /ejemplo\.test\/2/);
      }
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sin key: fail closed sin red (directo y tras aprobar)", async () => {
  const base = temp();
  try {
    roster(base);
    politicaAsk(base);
    delete process.env.EXA_API_KEY;
    let red = false;
    const spy = () => {
      red = true;
      return FETCH_OK();
    };
    await assert.rejects(() => buscarExterno(base, "algo", { fetchFn: spy }), /EXA_API_KEY/);
    const p1 = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
    assert.equal(p1.estado, "pendiente");
    if (p1.estado !== "pendiente") return;
    decide(base, p1.approvalId, true, "test", 30, declaracionDeHerramienta(base, "explorador", "buscar"));
    const p2 = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
    assert.equal(p2.estado, "denegado");
    if (p2.estado === "denegado") assert.match(p2.motivo, /EXA_API_KEY/);
    assert.equal(red, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sin declaración o con deny: no sale a la red", async () => {
  const base = temp();
  try {
    process.env.EXA_API_KEY = "test-key";
    try {
      let red = false;
      const spy = () => {
        red = true;
        return FETCH_OK();
      };
      writeFileSync(
        join(base, "agents.config.json"),
        JSON.stringify({ config_version: 2, agentes: [{ id: "explorador", rol: "nodo", herramientas: [] }], aristas: [] }),
      );
      const nodecl = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
      assert.equal(nodecl.estado, "denegado");
      roster(base, "deny");
      const deny = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
      assert.equal(deny.estado, "denegado");
      assert.equal(red, false);
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sin política que lo cubra: deny antes que ask", async () => {
  const base = temp();
  try {
    roster(base);
    process.env.EXA_API_KEY = "test-key";
    try {
      let red = false;
      const r = await enriquecerConBusqueda(base, "explorador", "algo", {
        fetchFn: () => {
          red = true;
          return FETCH_OK();
        },
      });
      assert.equal(r.estado, "denegado");
      assert.equal(red, false);
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("buscarExterno valida entrada y recorta", async () => {
  const base = temp();
  try {
    process.env.EXA_API_KEY = "k";
    try {
      await assert.rejects(() => buscarExterno(base, "   ", { fetchFn: FETCH_OK }), /vacía/);
      const r = await buscarExterno(base, "q", { fetchFn: FETCH_OK, maxResultados: 1 });
      assert.equal(r.length, 1);
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
