// Investigar + entrevistar sobre un plan: referencias en la spec, 3-5 preguntas
// y respuestas anotadas. Lo que se prueba es el contrato que ve el botón del
// chat: el clic aprueba la búsqueda (un solo uso) y no queda nada a medias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aplicarRespuestas, investigarPlan, leerPreguntas } from "../dist/spec/investigar.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-investigar-"));
}

function specEn(base: string, id = "demo", objetivo = "un dashboard de kiosco con productos y ventas"): string {
  mkdirSync(join(base, "specs", "active", id), { recursive: true });
  const spec = `# Spec ${id} — demo\n\n**estado:** propuesta\n\n## Objetivo solicitado\n\n${objetivo}\n\n## Criterios de aceptación\n\n- [ ] algo\n`;
  writeFileSync(join(base, "specs", "active", id, "spec.md"), spec, "utf8");
  return join(base, "specs", "active", id, "spec.md");
}

const REF_OK = {
  estado: "ok" as const,
  contexto: "x",
  resultados: [
    { titulo: "Ref uno", url: "https://ejemplo.test/1", snippet: "resumen uno" },
    { titulo: "Ref dos", url: "https://ejemplo.test/2", snippet: "resumen dos" },
  ],
};

const PREGUNTAS_JSON = JSON.stringify([
  { pregunta: "¿Qué moneda usa el kiosco?", motivo: "Afecta a los totales" },
  { pregunta: "¿Hay varios usuarios o uno solo?", motivo: "Afecta a roles" },
  { pregunta: "¿Se cobra con tarjeta?", motivo: "Afecta a integraciones" },
]);

test("escribe referencias en la spec y deja 3 preguntas guardadas", async () => {
  const base = temp();
  try {
    const ruta = specEn(base);
    const r = await investigarPlan(base, "demo", {
      buscar: async () => REF_OK,
      preguntar: async () => PREGUNTAS_JSON,
    });
    assert.equal(r.ok, true);
    assert.equal(r.referencias, 2);
    assert.equal(r.preguntas.length, 3);
    const spec = readFileSync(ruta, "utf8");
    assert.match(spec, /## Referencias externas/);
    assert.match(spec, /\[1\] Ref uno — https:\/\/ejemplo\.test\/1/);
    const g = leerPreguntas(base, "demo");
    assert.equal(g?.estado, "pendiente");
    assert.equal(g?.preguntas.length, 3);
    assert.equal(g?.preguntas[0].id, "q1");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reintentar no duplica la sección de referencias", async () => {
  const base = temp();
  try {
    const ruta = specEn(base);
    await investigarPlan(base, "demo", { buscar: async () => REF_OK, preguntar: async () => PREGUNTAS_JSON });
    await investigarPlan(base, "demo", { buscar: async () => REF_OK, preguntar: async () => PREGUNTAS_JSON });
    const spec = readFileSync(ruta, "utf8");
    assert.equal(spec.match(/## Referencias externas/g)?.length, 1);
    assert.equal(spec.match(/\[1\] Ref uno/g)?.length, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("las respuestas se anotan en la spec y solo se aceptan una vez", async () => {
  const base = temp();
  try {
    const ruta = specEn(base);
    await investigarPlan(base, "demo", { buscar: async () => REF_OK, preguntar: async () => PREGUNTAS_JSON });
    const r = aplicarRespuestas(base, "demo", [
      { id: "q1", respuesta: "pesos argentinos" },
      { id: "q2", respuesta: "un solo usuario" },
      { id: "q3", respuesta: "" },
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.respondidas, 3);
    assert.equal(r.omitidas, 1);
    const spec = readFileSync(ruta, "utf8");
    assert.match(spec, /## Clarifications/);
    assert.match(spec, /Q: ¿Qué moneda usa el kiosco\? → A: pesos argentinos/);
    assert.match(spec, /omitida: criterio del implementador/);
    assert.equal(leerPreguntas(base, "demo")?.estado, "respondida");
    const otra = aplicarRespuestas(base, "demo", [{ id: "q1", respuesta: "otra" }]);
    assert.equal(otra.ok, false);
    assert.match(otra.error ?? "", /ya fueron respondidas/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sin búsqueda permitida no hay preguntas inventadas", async () => {
  const base = temp();
  try {
    const ruta = specEn(base);
    const r = await investigarPlan(base, "demo", {
      buscar: async () => ({ estado: "denegado", motivo: "riesgo alto y la herramienta no está habilitada" }),
      preguntar: async () => PREGUNTAS_JSON,
    });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /no está habilitada/);
    assert.equal(r.preguntas.length, 0);
    assert.equal(readFileSync(ruta, "utf8").includes("## Referencias externas"), false);
    assert.equal(existsSync(join(base, "specs", "active", "demo", "preguntas.json")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("id inválido no toca el disco (ni con ../)", async () => {
  const base = temp();
  try {
    const r = await investigarPlan(base, "../../etc", { buscar: async () => REF_OK, preguntar: async () => "[]" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /inexistente o id inválido/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// El botón aprueba y consume en la misma llamada: sin eso, pulsarlo pediría
// `axiom approve` a mano y la función no serviría para lo que promete.
test("el clic aprueba la búsqueda pendiente y la gasta en la misma corrida", async () => {
  const base = temp();
  const realFetch = globalThis.fetch;
  try {
    specEn(base);
    writeFileSync(join(base, "agents.config.json"), JSON.stringify({
      config_version: 2,
      agentes: [{ id: "planificador", rol: "nodo", herramientas: [{ tool: "buscar", acceso: "allow" }] }],
      aristas: [],
    }));
    writeFileSync(join(base, "policies.global.json"), JSON.stringify({ tools: { buscar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }));
    process.env.EXA_API_KEY = "test-key";
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: "Solo una", url: "https://ejemplo.test/x", text: "resumen" }] }),
    })) as unknown as typeof fetch;
    const r = await investigarPlan(base, "demo", { preguntar: async () => PREGUNTAS_JSON });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.referencias, 1);
    assert.equal(r.preguntas.length, 3);
    assert.match(readFileSync(join(base, "specs", "active", "demo", "spec.md"), "utf8"), /\[1\] Solo una/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.EXA_API_KEY;
    rmSync(base, { recursive: true, force: true });
  }
});
