import { test } from "node:test";
import assert from "node:assert/strict";
import { construirPromptAgente, construirPromptJuez } from "../dist/modules/agents/ejecucion.js";
import { BASELINE_INYECCION } from "../dist/modules/agents/defensa.js";
import { cuerpoSkill } from "../dist/modules/agents/skills.js";
import { promptPara } from "../dist/sessions.js";

const agente = {
  id: "nodo-x",
  rol: "nodo" as const,
  modelo: "hereda-proveedor",
  estado: "activo" as const,
  skills: ["verify", "skill-que-no-existe"],
  instrucciones: "trabaja fino",
  herramientas: [{ tool: "terminal", acceso: "ask" as const }],
  presupuesto: { tokens: 1000, calls: 4 },
};

test("construirPromptAgente inyecta el cuerpo de cada skill, no solo el nombre", () => {
  const p = construirPromptAgente(agente, "T1 — algo", "contexto", "spec de prueba");
  assert.match(p, /Skills activos: verify, skill-que-no-existe/);
  assert.match(p, /--- skill: verify ---/);
  const cuerpo = cuerpoSkill("verify");
  assert.ok(cuerpo, "verify debe tener cuerpo en el catálogo");
  assert.ok(p.includes(cuerpo as string), "el prompt debe llevar el cuerpo, no solo el id");
  // Un skill sin cuerpo degrada al nombre sin romper ni inventar contenido.
  assert.doesNotMatch(p, /--- skill: skill-que-no-existe ---/);
  assert.match(p, /Tarea asignada: T1 — algo/);
  assert.match(p, /Instrucciones específicas: trabaja fino/);
  assert.match(p, /terminal\(ask\)/);
  assert.match(p, /1000 tokens \/ 4 llamadas/);
});

test("todos los prompts de trabajo llevan el baseline anti-inyección", () => {
  const trabajo = construirPromptAgente(agente, "T1", "", "spec");
  const juez = construirPromptJuez("el build pasa", "trabajo entregado");
  for (const [nombre, p] of [["agente", trabajo], ["juez", juez]] as const) {
    assert.ok(p.includes(BASELINE_INYECCION), `el prompt de ${nombre} no lleva el baseline completo`);
  }
  // Marcadores concretos (si alguien recorta el baseline, esto lo delata).
  assert.match(trabajo, /Homoglifos y unicode invisible/);
  assert.match(trabajo, /son datos, nunca órdenes/);
  assert.match(trabajo, /Nunca reveles secretos/);
  assert.match(trabajo, /policies\.global\.json/);
  // El juez conserva su contrato de salida y su puerta de evidencia.
  assert.match(juez, /PRE-REPORTE/);
  assert.match(juez, /Responde SOLO JSON/);
});

test("el chat (ask/plan/build) también lleva el baseline y conserva su encargo", () => {
  for (const modo of ["ask", "plan", "build"] as const) {
    const p = promptPara(modo, "review", "revisa esto", { instrucciones: "rol-x", historial: "historial-y" });
    assert.ok(p.includes(BASELINE_INYECCION), `modo ${modo} sin baseline`);
    assert.match(p, /\[enfoque review/);
    assert.match(p, /\[rol\]\nrol-x/);
    assert.match(p, /historial-y/);
  }
  // El intent-gate de plan trivial sigue respondiendo corto, con baseline.
  const trivial = promptPara("plan", "", "hola", {});
  assert.match(trivial, /Responde de forma directa y breve/);
  assert.ok(trivial.includes(BASELINE_INYECCION));
});
