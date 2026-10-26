// El runner no puede ser un atajo alrededor del broker: cada herramienta que usa
// en nombre de un agente (delegar y escribir su trabajo) se autoriza antes de
// gastar un spawn, con la política y la declaración vigentes. Una aprobación
// concedida autoriza UN uso; sin consumo, aprobar no desbloquearía la corrida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarProyecto } from "../dist/proyectos.js";
import { decide } from "../dist/broker.js";
import { loadAgents, saveAgents } from "../dist/modules/agents/config.js";
import { declaracionDeAprobacion } from "../dist/modules/agents/declaracion.js";
import { autorizarUso, ejecutarTareaGrafo } from "../dist/modules/agents/ejecucion.js";

function conProyecto(fn: (root: string) => Promise<void> | void): Promise<void> | void {
  const base = mkdtempSync(join(tmpdir(), "axiom-runner-broker-"));
  const root = join(base, "p");
  const correr = async (): Promise<void> => {
    try {
      assert.deepEqual(asegurarProyecto(root), { ok: true });
      await fn(root);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  };
  return correr();
}

function politicas(root: string, global: Record<string, boolean>, project: Record<string, boolean>): void {
  writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools: global, techo: { rondas: 3, tokens: 100000, calls: 500 } }, null, 2) + "\n");
  writeFileSync(join(root, "project.json"), JSON.stringify({ tools: project, presupuesto: { tokens: 50000, calls: 200 } }, null, 2) + "\n");
}

function declarar(root: string, agenteId: string, tool: string, acceso: "allow" | "ask" | "deny"): void {
  const r = loadAgents(root);
  assert.ok(r.ok, `loadAgents: ${!r.ok ? r.error : ""}`);
  if (!r.ok) return;
  saveAgents(root, {
    ...r.config,
    agentes: r.config.agentes.map((a) =>
      a.id === agenteId
        ? { ...a, herramientas: [...a.herramientas.filter((h) => h.tool !== tool), { tool, acceso }] }
        : a,
    ),
  });
}

const EDITAR = {
  name: "editar",
  description: "escribe el artefacto",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

const DELEGA = {
  name: "delega",
  description: "delega una tarea",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

test("política y declaración permiten: el uso pasa", () =>
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    declarar(root, "implementador", "editar", "allow");
    assert.equal(autorizarUso(root, "implementador", "editar", EDITAR).decision, "allow");
  }));

test("lo que el agente no declara no se ejecuta, aunque la política lo permita", () =>
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const r = autorizarUso(root, "revisor", "editar", EDITAR);
    assert.equal(r.decision, "deny");
    assert.match(r.motivo, /no declara la herramienta editar/);
  }));

test("ask abre una solicitud; aprobarla autoriza un solo uso y el siguiente vuelve a pedir", () =>
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const primera = autorizarUso(root, "implementador", "editar", EDITAR);
    assert.equal(primera.decision, "ask");
    assert.ok(primera.id, "el ask debe dejar un id aprobable");

    // Reintentar antes de decidir reutiliza la solicitud (no duplica filas).
    assert.equal(autorizarUso(root, "implementador", "editar", EDITAR).id, primera.id);

    const ok = decide(root, primera.id!, true, "test", 30, declaracionDeAprobacion(root, primera.id!));
    assert.equal(ok.estado, "aprobada");

    const consumida = autorizarUso(root, "implementador", "editar", EDITAR);
    assert.equal(consumida.decision, "allow");
    assert.match(consumida.motivo, new RegExp(`aprobación ${primera.id} consumida`));

    const otra = autorizarUso(root, "implementador", "editar", EDITAR);
    assert.equal(otra.decision, "ask");
    assert.notEqual(otra.id, primera.id, "una aprobación no es un permiso permanente");
  }));

test("una aprobación concedida no se consume si el agente ya no la declara", () =>
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const pedido = autorizarUso(root, "implementador", "editar", EDITAR);
    decide(root, pedido.id!, true, "test", 30, declaracionDeAprobacion(root, pedido.id!));

    declarar(root, "implementador", "editar", "deny");
    const negado = autorizarUso(root, "implementador", "editar", EDITAR);
    assert.equal(negado.decision, "deny");

    // La concesión sigue intacta: al volver a declararla, se consume una vez.
    declarar(root, "implementador", "editar", "ask");
    const despues = autorizarUso(root, "implementador", "editar", EDITAR);
    assert.equal(despues.decision, "allow");
    assert.match(despues.motivo, /consumida/);
  }));

test("una aprobación concedida no elude un deny de política vigente", () =>
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const pedido = autorizarUso(root, "implementador", "editar", EDITAR);
    decide(root, pedido.id!, true, "test", 30, declaracionDeAprobacion(root, pedido.id!));

    politicas(root, { editar: false }, { editar: true });
    const negado = autorizarUso(root, "implementador", "editar", EDITAR);
    assert.equal(negado.decision, "deny");
    assert.match(negado.motivo, /global\.tools\.editar=false/);

    // La concesión no se quemó por el intento: sigue usándose si la política vuelve.
    politicas(root, { editar: true }, { editar: true });
    assert.equal(autorizarUso(root, "implementador", "editar", EDITAR).decision, "allow");
  }));

test("el runner no gasta un spawn si el broker niega la escritura del trabajo", () =>
  conProyecto(async (root) => {
    // `editar` sin permiso explícito: riesgo medio = deny (no aprobable).
    politicas(root, { delega: true }, { delega: true });
    const r = await ejecutarTareaGrafo(root, "spec-x", "T1", "hacer algo", "Given a When b Then c");
    assert.equal(r.ok, false);
    assert.equal(r.verdict, "error");
    assert.match(r.error ?? "", /run bloqueado por el broker/);
    assert.match(r.error ?? "", /implementador no puede usar editar/);
    // Delegó al nodo que puede escribir, no al planificador (solo lectura).
    assert.doesNotMatch(r.error ?? "", /planificador/);
    assert.equal(existsSync(join(root, "specs/active/spec-x/trabajo-T1.md")), false);
  }));

test("con permiso, el runner pasa la puerta y solo falla después (proveedor)", () =>
  conProyecto(async (root) => {
    politicas(root, { delega: true, editar: true }, { delega: true, editar: true });
    declarar(root, "implementador", "editar", "allow");
    const r = await ejecutarTareaGrafo(root, "spec-x", "T1", "hacer algo", "Given a When b Then c");
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.error ?? "", /bloqueado por el broker/);
    assert.match(r.error ?? "", /Trabajo fallido/);
  }));
