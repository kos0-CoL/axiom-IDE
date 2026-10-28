import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarRespuesta, extraerMarcas, formatearPregunta, proponerPreguntas, responderLista, responderTodas } from "../dist/modules/clarify/index.js";
import { construirClarify } from "../dist/commands.js";

const SPEC = `# Spec: demo\n\n## Alcance\n\nEl sistema guarda [NEEDS CLARIFICATION: ¿qué retención de datos aplica?] y audita.\n\n## UX\n\nEl aviso sale [NEEDS CLARIFICATION: ¿modal o banner?] al entrar.\n`;

test("extrae marcas con la sección como motivo y formatea estilo spec-kit", () => {
  const marcas = extraerMarcas(SPEC);
  assert.equal(marcas.length, 2);
  assert.match(marcas[0].motivo, /Alcance/);
  const f = formatearPregunta(marcas[0], 1, 2);
  assert.match(f, /Pregunta 1\/2/);
  assert.match(f, /\*\*Question:\*\*/);
  assert.match(f, /Why it matters/);
});

test("aplicarRespuesta sustituye la marca y anota Clarifications", () => {
  const marcas = extraerMarcas(SPEC);
  const r = aplicarRespuesta(SPEC, marcas[0], "90 días");
  assert.equal(r.omitida, false);
  assert.ok(!r.markdown.includes("[NEEDS CLARIFICATION: ¿qué retención"));
  assert.ok(r.markdown.includes("[NEEDS CLARIFICATION: ¿modal o banner?]"));
  assert.match(r.markdown, /## Clarifications/);
  assert.match(r.markdown, /Q: ¿qué retención.*→ A: 90 días/);
});

test("saltar quita la marca y lo registra como omitida", () => {
  const marcas = extraerMarcas(SPEC);
  const r = aplicarRespuesta(SPEC, marcas[1], "saltar");
  assert.equal(r.omitida, true);
  assert.ok(!r.markdown.includes("[NEEDS CLARIFICATION: ¿modal"));
  assert.match(r.markdown, /omitida/);
});

test("responderTodas corta en 5 aunque haya más marcas", () => {
  const muchas = Array.from({ length: 7 }, (_, i) => `- punto ${i} [NEEDS CLARIFICATION: duda ${i}]`).join("\n");
  const r = responderTodas(muchas, ["a", "b", "c", "d", "e", "f", "g"]);
  assert.equal(r.hechas, 5);
  assert.equal(r.pendientes, 2);
});

test("proponerPreguntas parsea JSON útil, filtra basura y corta en 5", async () => {
  const bueno = await proponerPreguntas("# Spec\n\nGuardar datos.", async () => JSON.stringify([
    { pregunta: "¿qué retención aplica?", motivo: "Afecta al borrado." },
    { pregunta: "", motivo: "vacía, fuera." },
    { pregunta: "¿qué retención aplica?", motivo: "duplicada, fuera." },
    { pregunta: "x".repeat(201), motivo: "muy larga, fuera." },
    { pregunta: "¿modal o banner?" },
    { pregunta: "¿quién aprueba?", motivo: "Roles." },
    { pregunta: "¿dónde se despliega?", motivo: "Despliegue." },
    { pregunta: "¿séptima?", motivo: "corte." },
  ]));
  assert.equal(bueno.length, 5);
  assert.equal(bueno[0].pregunta, "¿qué retención aplica?");
  assert.equal(bueno[0].marca, "", "propuesta = marca sintética");
  assert.match(bueno[1].motivo, /adivina/, "motivo por defecto");
});

test("proponerPreguntas fail closed: vacío, no-JSON, no-array, fallo", async () => {
  assert.deepEqual(await proponerPreguntas("spec", async () => ""), []);
  assert.deepEqual(await proponerPreguntas("spec", async () => "no es json {"), []);
  assert.deepEqual(await proponerPreguntas("spec", async () => '{"pregunta":"suelta"}'), [], "no-array fuera");
  assert.deepEqual(await proponerPreguntas("spec", async () => "[]"), []);
  assert.deepEqual(await proponerPreguntas("spec", async () => { throw new Error("sin red"); }), []);
  assert.deepEqual(await proponerPreguntas("spec", async () => "```json\n[]\n```"), [], "fences tolerados");
});

test("responderLista persiste propuestas sin marca y corta en 5", async () => {
  const propuestas = await proponerPreguntas("spec", async () => JSON.stringify([
    { pregunta: "¿retención?", motivo: "Datos." },
    { pregunta: "¿roles?", motivo: "Roles." },
  ]));
  const r = responderLista("# Spec\n\nGuardar.\n", propuestas, ["90 días", "saltar"]);
  assert.equal(r.hechas, 2);
  assert.equal(r.omitidas, 1);
  assert.equal(r.pendientes, 0);
  assert.match(r.markdown, /## Clarifications/);
  assert.match(r.markdown, /Q: ¿retención\? → A: 90 días/);
  assert.match(r.markdown, /omitida/);
});

test("construirClarify sin marcas no toca nada", () => {
  const r = construirClarify("# Spec: x\n\nSin marcas.\n", []);
  assert.equal(r.code, 0);
  assert.match(r.msg, /sin marcas/);
  assert.equal(r.markdown, "# Spec: x\n\nSin marcas.\n");
});
