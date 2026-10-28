import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarRespuesta, extraerMarcas, formatearPregunta, responderTodas } from "../dist/modules/clarify/index.js";
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

test("construirClarify sin marcas no toca nada", () => {
  const r = construirClarify("# Spec: x\n\nSin marcas.\n", []);
  assert.equal(r.code, 0);
  assert.match(r.msg, /sin marcas/);
  assert.equal(r.markdown, "# Spec: x\n\nSin marcas.\n");
});
