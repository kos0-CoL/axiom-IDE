// El broker autoriza cada herramienta con dos cotas: la política del proyecto
// (global ∧ proyecto) y lo que declara el agente que la usa. deny > ask > allow,
// y lo no declarado se deniega (fail closed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarProyecto } from "../dist/proyectos.js";
import { check, decide, datosAprobacion } from "../dist/broker.js";
import { loadAgents, saveAgents } from "../dist/modules/agents/config.js";
import { declaracionDeHerramienta, declaracionDeAprobacion } from "../dist/modules/agents/declaracion.js";
import { handoff } from "../dist/modules/agents/handoff.js";

function conProyecto(fn: (root: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), "axiom-broker-agente-"));
  const root = join(base, "p");
  try {
    assert.deepEqual(asegurarProyecto(root), { ok: true });
    fn(root);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function politicas(root: string, global: Record<string, boolean>, project: Record<string, boolean>): void {
  writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools: global, techo: { rondas: 3, tokens: 100000, calls: 500 } }, null, 2) + "\n");
  writeFileSync(join(root, "project.json"), JSON.stringify({ tools: project, presupuesto: { tokens: 50000, calls: 200 } }, null, 2) + "\n");
}

function declarar(root: string, agenteId: string, tool: string, acceso: "allow" | "ask" | "deny"): void {
  const r = loadAgents(root);
  assert.ok(r.ok, `loadAgents: ${!r.ok ? r.error : ""}`);
  if (!r.ok) return;
  const cfg = {
    ...r.config,
    agentes: r.config.agentes.map((a) =>
      a.id === agenteId
        ? { ...a, herramientas: [...a.herramientas.filter((h) => h.tool !== tool), { tool, acceso }] }
        : a,
    ),
  };
  saveAgents(root, cfg);
}

test("la declaración del agente es una cota: no concede lo que la política niega", () => {
  conProyecto((root) => {
    politicas(root, { editar: false }, { editar: true });
    declarar(root, "implementador", "editar", "allow");
    const r = check(root, "editar", undefined, declaracionDeHerramienta(root, "implementador", "editar"));
    assert.equal(r.decision, "deny");
    assert.match(r.motivo, /global\.tools\.editar=false/);
    assert.match(r.motivo, /agente implementador declara editar=allow/);
  });
});

test("lo que el agente no declara se deniega aunque la política lo permita", () => {
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    // revisor solo declara lectura (y delega): editar le queda fuera.
    const d = declaracionDeHerramienta(root, "revisor", "editar");
    assert.ok("error" in d);
    if ("error" in d) assert.match(d.error, /no declara la herramienta editar/);
    const r = check(root, "editar", undefined, d);
    assert.equal(r.decision, "deny");
    assert.match(r.motivo, /fail closed/);
    assert.equal(r.id, undefined, "una denegación no crea aprobación pendiente");
  });
});

test("ask del agente pide aprobación con su nombre y el humano la resuelve", () => {
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const d = declaracionDeHerramienta(root, "implementador", "editar");
    assert.deepEqual(d, { id: "implementador", tool: "editar", acceso: "ask" });
    const r = check(root, "editar", undefined, d);
    assert.equal(r.decision, "ask");
    assert.ok(r.id, "ask trae id de aprobación");
    const pedido = datosAprobacion(root, r.id!);
    assert.equal(pedido?.agente, "implementador");
    // Aprobar: el ask del agente es justo lo que esta decisión resuelve.
    const ok = decide(root, r.id!, true, "test", 30, declaracionDeAprobacion(root, r.id!));
    assert.equal(ok.ok, true, ok.msg);
    assert.match(ok.msg, /agente implementador/);
  });
});

test("deny del agente bloquea una aprobación ya pedida", () => {
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const r = check(root, "editar", undefined, declaracionDeHerramienta(root, "implementador", "editar"));
    assert.equal(r.decision, "ask");
    assert.ok(r.id);
    // El humano cambia la declaración entre la solicitud y la decisión.
    declarar(root, "implementador", "editar", "deny");
    const negado = decide(root, r.id!, true, "test", 30, declaracionDeAprobacion(root, r.id!));
    assert.equal(negado.ok, false);
    assert.match(negado.msg, /declara editar=deny/);
    const otraVez = decide(root, r.id!, true, "test", 30, declaracionDeAprobacion(root, r.id!));
    assert.equal(otraVez.ok, false);
    assert.match(otraVez.msg, /ya denegada-por-agente/);
  });
});

test("rechazar no revalida la declaración: queda rechazada, no denegada-por-agente", () => {
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const r = check(root, "editar", undefined, declaracionDeHerramienta(root, "implementador", "editar"));
    assert.equal(r.decision, "ask");
    assert.ok(r.id);
    // Entre la solicitud y el rechazo el agente pasa a deny: el rechazo sigue valiendo.
    declarar(root, "implementador", "editar", "deny");
    const no = decide(root, r.id!, false, "test", 30, declaracionDeAprobacion(root, r.id!));
    assert.equal(no.ok, false, "rechazar nunca es una aprobación");
    assert.equal(no.estado, "rechazada");
    assert.equal(no.aplicada, true);
    assert.match(no.msg, /rechazada/);
    // Y no se puede reabrir: la fila ya está decidida.
    const otra = decide(root, r.id!, true, "test", 30, declaracionDeAprobacion(root, r.id!));
    assert.equal(otra.estado, "rechazada");
    assert.equal(otra.aplicada, false);
  });
});

test("rechazar no revalida la política: queda rechazada aunque la hayan revocado", () => {
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const r = check(root, "editar", undefined, declaracionDeHerramienta(root, "implementador", "editar"));
    assert.ok(r.id);
    politicas(root, { editar: false }, { editar: true });
    const no = decide(root, r.id!, false, "test", 30, declaracionDeAprobacion(root, r.id!));
    assert.equal(no.estado, "rechazada");
  });
});

test("sin declaración resoluble la aprobación se cierra, no se aprueba", () => {
  conProyecto((root) => {
    politicas(root, { editar: true }, { editar: true });
    const r = check(root, "editar", undefined, declaracionDeHerramienta(root, "implementador", "editar"));
    assert.equal(r.decision, "ask");
    assert.ok(r.id);
    const sin = decide(root, r.id!, true, "test", 30, undefined);
    assert.equal(sin.ok, false);
    assert.match(sin.msg, /no está declarado/);
  });
});

test("alias históricos: read se resuelve contra leer", () => {
  conProyecto((root) => {
    const d = declaracionDeHerramienta(root, "implementador", "read");
    assert.deepEqual(d, { id: "implementador", tool: "leer", acceso: "allow" });
    const r = check(root, "read", undefined, d);
    assert.equal(r.decision, "allow");
  });
});

test("el handoff se autoriza con la declaración del agente que delega", () => {
  conProyecto((root) => {
    politicas(root, { delega: true }, { delega: true });
    // El orquestador declara delega=allow: el handoff pasa como antes.
    assert.match(handoff(root, "orquestador", "implementador", "preparar el cambio"), /registrado/);
    // Sin declaración, el mismo handoff se deniega y dice cómo arreglarlo.
    const r = loadAgents(root);
    assert.ok(r.ok);
    if (!r.ok) return;
    saveAgents(root, {
      ...r.config,
      agentes: r.config.agentes.map((a) =>
        a.id === "orquestador" ? { ...a, herramientas: a.herramientas.filter((h) => h.tool !== "delega") } : a,
      ),
    });
    const negado = handoff(root, "orquestador", "implementador", "preparar el cambio");
    assert.match(negado, /handoff denegado/);
    assert.match(negado, /no declara la herramienta delega/);
  });
});
