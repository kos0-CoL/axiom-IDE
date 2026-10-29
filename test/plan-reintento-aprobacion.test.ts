// El reintento del aviso no puede dejar una aprobación viva. El chat trae el id
// pendiente, el servidor la concede para esa corrida y la revoca al terminar si
// la búsqueda no llegó a gastarla: un plan que falla (proveedor caído) no puede
// heredar los 30 min de vigencia que existen para el humano de Aprobaciones.
// Se prueba contra el servidor real y un proveedor simulado que falla, sin red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWeb } from "../dist/web.js";
import { crearSesion } from "../dist/sessions.js";
import { saveConfig } from "../dist/modules/adapters/config.js";
import { check, decide, consumirAprobacion, devolverAprobacion, revocarAprobacion } from "../dist/broker.js";
import { openDb } from "../dist/store.js";

// buscar declara criterio abierto (riesgo alto): con la política global en true
// y el proyecto sin definir, el broker responde `ask` y abre la solicitud.
const BUSCAR = {
  name: "buscar",
  description: "búsqueda externa",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};
const DECLARACION = { id: "planificador", tool: "buscar", acceso: "allow" as const };

function proyecto(): string {
  const base = mkdtempSync(join(tmpdir(), "axiom-reintento-"));
  writeFileSync(join(base, "axiom.json"), "{}");
  writeFileSync(join(base, "axiom.db"), "");
  writeFileSync(
    join(base, "agents.config.json"),
    JSON.stringify({ config_version: 2, agentes: [{ id: "planificador", rol: "nodo", herramientas: [{ tool: "buscar", acceso: "allow" }] }], aristas: [] }),
  );
  writeFileSync(join(base, "policies.global.json"), JSON.stringify({ tools: { buscar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }));
  return base;
}

function estadoDe(base: string, id: string): string | undefined {
  const db = openDb(base);
  try {
    const row = db.prepare("SELECT estado FROM aprobaciones WHERE id=?").get(id) as { estado?: string } | undefined;
    return row?.estado;
  } finally {
    db.close();
  }
}

test("revocar solo toca la concesión sin gastar", () => {
  const base = proyecto();
  try {
    const a = check(base, "buscar", BUSCAR, DECLARACION);
    assert.equal(a.decision, "ask");
    if (!a.id) return assert.fail("el broker no abrió solicitud de aprobación");
    const id = a.id;
    assert.equal(estadoDe(base, id), "pendiente");

    // Pendiente no es una concesión: revocar no la cierra por la espalda.
    const pendiente = revocarAprobacion(base, id);
    assert.equal(pendiente.revocada, false);
    assert.equal(pendiente.estado, "pendiente");
    assert.equal(estadoDe(base, id), "pendiente");

    assert.equal(decide(base, id, true, "chat", 30, DECLARACION).estado, "aprobada");
    const revocada = revocarAprobacion(base, id);
    assert.equal(revocada.ok, true);
    assert.equal(revocada.revocada, true);
    assert.equal(revocada.estado, "revocada");
    assert.equal(estadoDe(base, id), "revocada");

    // Idempotente: una segunda revocación informa el estado real sin reescribirlo.
    const otra = revocarAprobacion(base, id);
    assert.equal(otra.revocada, false);
    assert.equal(otra.estado, "revocada");

    // Concesión que la búsqueda sí gastó: queda `usada`, no se pisa.
    const b = check(base, "buscar", BUSCAR, DECLARACION);
    if (!b.id) return assert.fail("el broker no abrió la segunda solicitud");
    assert.equal(decide(base, b.id, true, "chat", 30, DECLARACION).estado, "aprobada");
    assert.deepEqual(consumirAprobacion(base, "buscar", "planificador", "plan demo"), { id: b.id });
    assert.equal(revocarAprobacion(base, b.id).revocada, false);
    assert.equal(estadoDe(base, b.id), "usada");

    // Concesión devuelta tras un uso que falló (EXA 401): se conserva aprobada y
    // el cierre del reintento no la revoca; el rastro del intento queda escrito.
    const c = check(base, "buscar", BUSCAR, DECLARACION);
    if (!c.id) return assert.fail("el broker no abrió la tercera solicitud");
    assert.equal(decide(base, c.id, true, "chat", 30, DECLARACION).estado, "aprobada");
    assert.deepEqual(consumirAprobacion(base, "buscar", "planificador", "enrich planificador"), { id: c.id });
    assert.equal(devolverAprobacion(base, c.id, "buscarExterno: EXA HTTP 401"), true);
    assert.equal(estadoDe(base, c.id), "aprobada");
    const conservada = revocarAprobacion(base, c.id);
    assert.equal(conservada.revocada, false);
    assert.equal(conservada.estado, "aprobada");
    assert.match(conservada.msg, /se conserva aprobada/);
    // Devolver algo que no se gastó no inventa nada.
    assert.equal(devolverAprobacion(base, c.id, "otra vez"), false);

    // Y un id que no existe no inventa una revocación.
    const fantasma = revocarAprobacion(base, "deadbeef");
    assert.equal(fantasma.ok, false);
    assert.equal(fantasma.estado, "no-existe");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("un reintento que falla no deja la aprobación viva", async () => {
  const base = proyecto();
  const mock = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "proveedor caído" } }));
    });
  });
  await new Promise<void>((ok) => mock.listen(0, "127.0.0.1", ok));
  const puertoMock = (mock.address() as AddressInfo).port;
  // El driver exige una key aunque el proveedor sea local: fail closed.
  process.env.OPENAI_API_KEY = "test-key";
  // Sin EXA_API_KEY el enrich no pide ni gasta la aprobación: el reintento la
  // concede y el servidor la revoca al terminar, que es el caso que se prueba.
  const exaPrevio = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  try {
    saveConfig(base, { proveedor: "openai", model: "mock", baseUrl: `http://127.0.0.1:${puertoMock}`, timeoutMs: 5_000, maxChars: 8_000 });
    const a = check(base, "buscar", BUSCAR, DECLARACION);
    if (!a.id) return assert.fail("el broker no abrió solicitud de aprobación");
    const id = a.id;
    const srv = startWeb(base, 0);
    try {
      const s = crearSesion(base, "reintento", "plan");
      assert.equal(s.ok, true);
      if (!s.ok) return;
      // El aviso mostró `axiom approve <id>`: el botón reenvía con ese id.
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, modo: "plan", texto: "un dashboard de kiosco con productos, ventas y reportes", aprobacion: id, stream: false }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; aviso_busqueda?: string };
      assert.equal(d.ok, false, "el proveedor simulado falla");
      assert.ok(d.error, "el fallo se explica en la respuesta");
      // Sin key el enrich no gasta nada, así que el servidor libera la concesión
      // al terminar la respuesta: el plan que falló no deja la aprobación viva.
      assert.match(d.aviso_busqueda ?? "", /EXA_API_KEY/);
      const estado = estadoDe(base, id);
      assert.equal(estado, "revocada", "el plan que falló no deja la concesión viva");
      assert.equal(decide(base, id, true, "chat", 30, DECLARACION).estado, estado, "ya no se puede volver a aprobar");
      // Un mensaje normal (sin id) no revive ni gasta nada de lo anterior.
      const otra = await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, modo: "plan", texto: "otra solicitud cualquiera del kiosco", stream: false }),
      });
      assert.equal(((await otra.json()) as { ok?: boolean }).ok, false);
      assert.equal(estadoDe(base, id), estado, "un mensaje normal no toca la fila anterior");
      // Un pedido trivial no busca nada, así que tampoco concede: la solicitud
      // sigue esperando a un humano en vez de quedar aprobada por la puerta de atrás.
      const pendiente = check(base, "buscar", BUSCAR, DECLARACION);
      if (!pendiente.id) return assert.fail("el broker no abrió la solicitud trivial");
      await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, modo: "plan", texto: "hola", aprobacion: pendiente.id, stream: false }),
      });
      assert.equal(estadoDe(base, pendiente.id), "pendiente", "sin búsqueda no se concede la aprobación");
    } finally {
      srv.close();
    }
  } finally {
    await new Promise<void>((ok) => mock.close(() => ok()));
    delete process.env.OPENAI_API_KEY;
    if (exaPrevio === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = exaPrevio;
    rmSync(base, { recursive: true, force: true });
  }
});
