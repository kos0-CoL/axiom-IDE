import { test } from "node:test";
import assert from "node:assert/strict";
import { construirPromptAgente, construirPromptJuez } from "../dist/modules/agents/ejecucion.js";
import { BASELINE_INYECCION, PROTOCOLO_CHAT } from "../dist/modules/agents/defensa.js";
import { cuerpoSkill } from "../dist/modules/agents/skills.js";
import { esTrivial, promptPara } from "../dist/sessions.js";

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

// El protocolo es estructura, no adorno: si alguien lo recorta o lo pierde al
// reordenar `promptPara`, la respuesta vuelve a improvisar y nadie se enteraría.
test("el protocolo de trabajo viaja en cada modo del chat y en cada agente", () => {
  const pasos = ["1. Pensamiento obligatorio", "2. Llamado secuencial de agentes", "3. Uso obligatorio de skills"];
  const tarea = "implementa el módulo de importación y sus tests";
  for (const modo of ["ask", "plan", "build"] as const) {
    const p = promptPara(modo, "", tarea, {});
    for (const paso of pasos) assert.ok(p.includes(paso), `modo ${modo} sin «${paso}»`);
  }
  // Pregunta simple: el análisis igual ocurre; lo que cambia es el largo del protocolo.
  const trivial = promptPara("plan", "", "hola", {});
  assert.match(trivial, /Responde de forma directa y breve/);
  assert.match(trivial, /Pensamiento obligatorio/);
  // El bloque completo sería costoso al vacío en un saludo: va el de dos líneas.
  assert.match(trivial, /turno simple/);
  assert.doesNotMatch(trivial, /Llamado secuencial de agentes/);
  // La tarea real sigue recibiendo las tres secciones.
  assert.match(promptPara("plan", "", tarea, {}), /Llamado secuencial de agentes/);

  const trabajo = construirPromptAgente(agente, "T1", "", "spec");
  for (const paso of pasos) assert.ok(trabajo.includes(paso), `agente sin «${paso}»`);
});

// La variante depende de lo que el canal puede hacer: el chat no tiene runner,
// así que prohibe los bloques `tool` (serían llamadas simuladas); el agente los
// pide porque su loop los ejecuta y los autoriza en el broker.
test("el chat y el agente reciben la variante que corresponde a su capacidad", () => {
  assert.ok(PROTOCOLO_CHAT.includes("no escribas bloques"), "el chat debe prohibir bloques tool");
  const trabajo = construirPromptAgente(agente, "T1", "", "spec");
  assert.match(trabajo, /Cada llamada se escribe como bloque/);
  assert.doesNotMatch(promptPara("build", "", "x", {}), /Cada llamada se escribe como bloque/);
});

// El voseo acentúa el imperativo donde el tuteo no: si el gate solo conociera
// «arregla», «arreglá el login» pasaría por saludo y el modo plan respondería
// en dos líneas a una tarea real.
test("el intent-gate reconoce el imperativo acentuado como tarea, no como saludo", () => {
  for (const tarea of ["arreglá el login", "revisá el PR", "implementá caché", "escribí el test", "diseñá el schema"]) {
    assert.equal(esTrivial(tarea), false, `«${tarea}» debe contar como tarea`);
  }
  for (const saludo of ["hola", "buen día", "gracias!", "¿cómo va?"]) {
    assert.equal(esTrivial(saludo), true, `«${saludo}» debe seguir siendo trivial`);
  }
  const plan = promptPara("plan", "", "arreglá el login", {});
  assert.match(plan, /plan numerado de pasos/);
  assert.match(plan, /Llamado secuencial de agentes/);
  assert.doesNotMatch(plan, /Responde de forma directa y breve/);
});

// El voseo también pega el pronombre al verbo («arreglame», «revisalo», «decime»):
// sin los enclíticos esas órdenes cortas pasaban por saludo y el gate las trataba
// como charla, con la respuesta breve y sin propuesta.
test("el intent-gate reconoce el imperativo con enclíticos sin abrir la puerta a los saludos", () => {
  for (const tarea of ["arreglame el login", "revisalo hoy", "decime qué falla", "probalo en local", "escribilo de nuevo", "arreglámelo"]) {
    assert.equal(esTrivial(tarea), false, `«${tarea}» debe contar como tarea`);
  }
  for (const saludo of ["hola", "buen día", "gracias!", "¿cómo va?", "dale", "chau", "ok"]) {
    assert.equal(esTrivial(saludo), true, `«${saludo}» debe seguir siendo trivial`);
  }
  // El sufijo opcional no puede comerse palabras que solo empiezan como un verbo.
  for (const palabra of ["modo creativo", "listado de precios", "correo nuevo"]) {
    assert.equal(esTrivial(palabra), true, `«${palabra}» no es una orden`);
  }
});

// Las órdenes preceden a los datos: historial y mensaje van después del protocolo.
test("el protocolo va antes que el historial y que el mensaje del usuario", () => {
  const p = promptPara("ask", "", "pregunta-final-marca", { historial: "historial-marca" });
  assert.ok(p.indexOf("Protocolo de trabajo") < p.indexOf("historial-marca"));
  assert.ok(p.indexOf("Protocolo de trabajo") < p.indexOf("pregunta-final-marca"));
});
