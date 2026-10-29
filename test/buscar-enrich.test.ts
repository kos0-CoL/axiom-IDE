import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buscarExterno, enriquecerConBusqueda, enriquecerPromptPlan } from "../dist/modules/buscar/index.js";
import { decide } from "../dist/broker.js";
import { openDb } from "../dist/store.js";
import { declaracionDeHerramienta } from "../dist/modules/agents/declaracion.js";
import { PAGE } from "../dist/web.js";

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

// Sin broker todavía la tabla no existe: eso ya es «ninguna aprobación abierta»,
// no un error de la prueba.
function aprobaciones(base: string): { id: string; estado: string }[] {
  const db = openDb(base);
  try {
    const existe = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aprobaciones'").get();
    if (!existe) return [];
    return db.prepare("SELECT id, estado FROM aprobaciones").all() as { id: string; estado: string }[];
  } finally {
    db.close();
  }
}

function estadoDe(base: string, id: string): string | undefined {
  return aprobaciones(base).find((a) => a.id === id)?.estado;
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

// Sin key no hay búsqueda posible, así que el enrich ni llega al broker: no abre
// una solicitud que nadie puede ejecutar y no gasta una concesión ya dada.
// Pedirlas costaba una aprobación humana por un `fetch` imposible.
test("sin key: fail closed sin red, sin pedir ni gastar aprobación", async () => {
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
    await assert.rejects(() => buscarExterno("algo", { fetchFn: spy }), /EXA_API_KEY/);
    const p1 = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
    assert.equal(p1.estado, "denegado");
    if (p1.estado === "denegado") assert.match(p1.motivo, /EXA_API_KEY/);
    assert.equal(red, false);
    assert.equal(aprobaciones(base).length, 0, "sin key no se abre solicitud de aprobación");

    // Con la concesión viva pero sin key, tampoco se gasta: queda para cuando la
    // haya, en vez de quemarse en un intento que no puede funcionar.
    process.env.EXA_API_KEY = "test-key";
    const p2 = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
    assert.equal(p2.estado, "pendiente");
    if (p2.estado === "pendiente") {
      decide(base, p2.approvalId, true, "test", 30, declaracionDeHerramienta(base, "explorador", "buscar"));
      assert.equal(estadoDe(base, p2.approvalId), "aprobada");
      delete process.env.EXA_API_KEY;
      const p3 = await enriquecerConBusqueda(base, "explorador", "algo", { fetchFn: spy });
      assert.equal(p3.estado, "denegado");
      assert.equal(red, false);
      assert.equal(estadoDe(base, p2.approvalId), "aprobada", "sin key no se consume la concesión");
      // El aviso nombra la clave y no manda a aprobar nada.
      const plan = await enriquecerPromptPlan(base, "algo", { agenteId: "explorador" });
      assert.match(plan.nota ?? "", /EXA_API_KEY/);
      assert.doesNotMatch(plan.nota ?? "", /axiom approve/);
    }
  } finally {
    delete process.env.EXA_API_KEY;
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

test("prefiere highlights al texto crudo", async () => {
  const base = temp();
  try {
    process.env.EXA_API_KEY = "k";
    try {
      const stub = () =>
        Promise.resolve({
          ok: true as const,
          json: () =>
            Promise.resolve({
              results: [
                { title: "T", url: "https://e.test/x", text: "texto largo crudo", highlights: ["punto clave uno", "punto clave dos"] },
              ],
            }),
        });
      const r = await buscarExterno("q", { fetchFn: stub });
      assert.equal(r.length, 1);
      assert.match(r[0].snippet, /punto clave uno/);
      assert.ok(!r[0].snippet.includes("texto largo crudo"));
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("enriquecerPromptPlan devuelve contexto o nota sin lanzar", async () => {
  const base = temp();
  try {
    roster(base);
    politicaAsk(base);
    process.env.EXA_API_KEY = "test-key";
    try {
      const p = await enriquecerPromptPlan(base, "algo", {
        agenteId: "explorador",
        fetchFn: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }),
      });
      assert.equal(p.contexto, "");
      // El aviso trae el id Y el comando: sin el comando, el id es un callejón.
      assert.match(p.nota ?? "", /pendiente de aprobación: [0-9a-f]{8}/);
      assert.match(p.nota ?? "", /axiom approve [0-9a-f]{8}/);
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// El motivo de la falta de búsqueda no se queda escondido dentro del prompt:
// web.ts lo devuelve como aviso_busqueda (y lo persiste como sistema) y el chat
// lo pinta como línea visible, así se ve si fue falta de clave o aprobación.
test("el chat de Plan muestra el aviso de búsqueda cuando no hubo referencias", () => {
  assert.match(PAGE, /if\(d\.aviso_busqueda\)avisoLinea\(d\.aviso_busqueda,text\)/);
});

// Con la política cerrada no hay solicitud que aprobar: el motivo tiene que
// nombrar la palanca (habilitar la herramienta), no mandar a aprobar algo que
// nadie pidió. Es el caso real de un proyecto recién creado.
test("política cerrada: el aviso dice qué habilitar, no qué aprobar", async () => {
  const base = temp();
  try {
    roster(base);
    process.env.EXA_API_KEY = "test-key";
    try {
      const p = await enriquecerPromptPlan(base, "algo", { agenteId: "explorador" });
      assert.equal(p.contexto, "");
      assert.match(p.nota ?? "", /no está habilitada/);
      assert.match(p.nota ?? "", /tools\.buscar=true en policies\.global\.json/);
      assert.doesNotMatch(p.nota ?? "", /axiom approve/);
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
      await assert.rejects(() => buscarExterno("   ", { fetchFn: FETCH_OK }), /vacía/);
      const r = await buscarExterno("q", { fetchFn: FETCH_OK, maxResultados: 1 });
      assert.equal(r.length, 1);
    } finally {
      delete process.env.EXA_API_KEY;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
