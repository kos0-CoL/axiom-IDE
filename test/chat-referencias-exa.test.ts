// El eslabón que faltaba: que las referencias de EXA lleguen de verdad al
// prompt que recibe el proveedor, y qué pasa cuando EXA falla. Los tests del
// módulo inyectan `fetchFn` e ignoran el camino real (chat → broker → enrich →
// prompt). Acá se recorre /api/chat/enviar contra el servidor de verdad y un EXA
// simulado local, sin red: interceptamos solo api.exa.ai y dejamos pasar el resto
// del fetch.
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
import { check } from "../dist/broker.js";
import { openDb } from "../dist/store.js";

const BUSCAR = {
  name: "buscar",
  description: "búsqueda externa",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};
const DECLARACION = { id: "planificador", tool: "buscar", acceso: "allow" as const };
const PEDIDO = "un tablero de turnos para un kiosco con productos, ventas del día y cierre de caja";

function proyecto(): string {
  const base = mkdtempSync(join(tmpdir(), "axiom-exa-"));
  writeFileSync(join(base, "axiom.json"), "{}");
  writeFileSync(join(base, "axiom.db"), "");
  writeFileSync(
    join(base, "agents.config.json"),
    JSON.stringify({ config_version: 2, agentes: [{ id: "planificador", rol: "nodo", herramientas: [{ tool: "buscar", acceso: "allow" }] }], aristas: [] }),
  );
  writeFileSync(join(base, "policies.global.json"), JSON.stringify({ tools: { buscar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }));
  return base;
}

function estadoDe(base: string, id: string): { estado?: string; devuelta_at?: string | null; usada_por?: string | null } {
  const db = openDb(base);
  try {
    return (db.prepare("SELECT estado, devuelta_at, usada_por FROM aprobaciones WHERE id=?").get(id) as { estado?: string; devuelta_at?: string | null; usada_por?: string | null }) ?? {};
  } finally {
    db.close();
  }
}

interface Resultado {
  ok?: boolean;
  aviso?: string;
  prompt: string;
  consultas: { query?: string }[];
  estado?: string;
  // Marca del intento fallido: queda escrito que la concesión se usó y se devolvió.
  devuelta?: string | null;
}

// Corre un Plan real contra /api/chat/enviar con una aprobación pendiente y un
// EXA que decide el test. Devuelve lo que hace falta para juzgar: el aviso que
// ve el chat, el prompt que recibió el proveedor, las consultas a EXA y cómo
// quedó la aprobación.
async function correrPlan(exa: () => Promise<Response>): Promise<Resultado> {
  const base = proyecto();
  const cuerposProveedor: unknown[] = [];
  const consultas: { query?: string }[] = [];
  const proveedor = createServer((req, res) => {
    let bruto = "";
    req.on("data", (c) => { bruto += c; });
    req.on("end", () => {
      try { cuerposProveedor.push(JSON.parse(bruto)); } catch { cuerposProveedor.push(bruto); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "## Plan\n\n- paso uno\n" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((ok) => proveedor.listen(0, "127.0.0.1", ok));
  const puertoProveedor = (proveedor.address() as AddressInfo).port;

  // Solo se intercepta el host de EXA; el proveedor y el propio servidor de la
  // web siguen usando el fetch real de Node.
  const fetchReal = globalThis.fetch;
  const fetchSimulado = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url);
    if (url.startsWith("https://api.exa.ai/")) {
      consultas.push(JSON.parse(String(init?.body ?? "{}")) as { query?: string });
      return exa();
    }
    return fetchReal(input as RequestInfo, init);
  }) as typeof fetch;

  const exaPrevio = process.env.EXA_API_KEY;
  const openaiPrevio = process.env.OPENAI_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  // El driver exige una key aunque el proveedor sea local: fail closed.
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = fetchSimulado;
  try {
    saveConfig(base, { proveedor: "openai", model: "mock", baseUrl: `http://127.0.0.1:${puertoProveedor}`, timeoutMs: 10_000, maxChars: 8_000 });
    // Riesgo alto: la política deja la herramienta en `ask`, así que hay una
    // solicitud pendiente real que el reintento del chat concede y gasta.
    const a = check(base, "buscar", BUSCAR, DECLARACION);
    if (!a.id) throw new Error("el broker no abrió solicitud de aprobación");
    const id = a.id;
    const srv = startWeb(base, 0);
    try {
      const s = crearSesion(base, "referencias", "plan");
      if (!s.ok) throw new Error(s.error);
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, modo: "plan", texto: PEDIDO, aprobacion: id, stream: false }),
      });
      const d = (await r.json()) as { ok?: boolean; aviso_busqueda?: string };
      const fila = estadoDe(base, id);
      return {
        ok: d.ok,
        aviso: d.aviso_busqueda,
        prompt: JSON.stringify(cuerposProveedor[0] ?? ""),
        consultas,
        estado: fila.estado,
        devuelta: fila.devuelta_at ?? null,
      };
    } finally {
      srv.close();
    }
  } finally {
    globalThis.fetch = fetchReal;
    if (exaPrevio === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = exaPrevio;
    if (openaiPrevio === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openaiPrevio;
    await new Promise<void>((ok) => proveedor.close(() => ok()));
    rmSync(base, { recursive: true, force: true });
  }
}

test("el reintento aprobado mete las referencias de EXA en el prompt del Plan", async () => {
  const r = await correrPlan(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          results: [
            { title: "Tablero de turnos: qué mide cada panel", url: "https://ejemplo.invalid/turnos", highlights: ["Un tablero muestra caja, turnos y ventas del día"] },
            { title: "Cierre de caja paso a paso", url: "https://ejemplo.invalid/caja", text: "Arqueo y diferencia de caja al cerrar el turno" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  assert.equal(r.ok, true);
  // Con referencias no hay aviso de por qué faltaron.
  assert.equal(r.aviso, undefined, `no debería avisar: ${r.aviso}`);
  // Se buscó una vez, con el pedido del usuario como consulta.
  assert.equal(r.consultas.length, 1);
  assert.equal(r.consultas[0].query, PEDIDO);
  // Y el bloque viajó DENTRO del prompt que recibió el proveedor.
  assert.match(r.prompt, /referencias externas \(EXA\)/);
  assert.match(r.prompt, /ejemplo\.invalid\/turnos/);
  assert.match(r.prompt, /Cierre de caja paso a paso/);
  // La aprobación quedó gastada por ese uso, no viva ni revocada.
  assert.equal(r.estado, "usada");
  assert.equal(r.devuelta, null, "una búsqueda exitosa no se devuelve");
});

// EXA rechaza la key: el plan sale igual (la búsqueda es contexto opcional), el
// chat dice el motivo real y la concesión vuelve a `aprobada`: el permiso era
// para buscar, no para un intento que EXA rechazó. Queda el rastro del intento.
test("EXA responde 401: aviso con el motivo y la concesión vuelve a aprobada", async () => {
  const r = await correrPlan(() =>
    Promise.resolve(new Response(JSON.stringify({ error: "invalid api key" }), { status: 401, headers: { "content-type": "application/json" } })),
  );
  assert.equal(r.ok, true, "el plan se genera aunque EXA falle");
  assert.match(r.aviso ?? "", /sin referencias externas/);
  assert.match(r.aviso ?? "", /EXA HTTP 401/);
  // Sin id no hay nada que aprobar: la línea no ofrece botón.
  assert.doesNotMatch(r.aviso ?? "", /axiom approve/);
  assert.doesNotMatch(r.prompt, /referencias externas \(EXA\)/, "no hay bloque de referencias vacío");
  assert.equal(r.consultas.length, 1, "se intentó una sola vez antes del 401");
  assert.equal(r.estado, "aprobada", "el 401 no gasta la aprobación");
  assert.ok(r.devuelta, "queda escrito que el intento existió");
});

// Timeout: el cliente aborta y buscarExterno lo traduce; el aviso lo nombra y la
// concesión vuelve a aprobada, igual que con el 401.
test("EXA no responde a tiempo: aviso con timeout y la concesión vuelve a aprobada", async () => {
  const r = await correrPlan(() => {
    const aborto = new Error("The operation was aborted");
    aborto.name = "AbortError";
    return Promise.reject(aborto);
  });
  assert.equal(r.ok, true, "el plan se genera aunque la búsqueda se corte");
  assert.match(r.aviso ?? "", /timeout de EXA/);
  assert.doesNotMatch(r.aviso ?? "", /axiom approve/);
  assert.doesNotMatch(r.prompt, /referencias externas \(EXA\)/);
  assert.equal(r.estado, "aprobada", "el timeout no gasta la aprobación");
  assert.ok(r.devuelta, "queda escrito que el intento existió");
  assert.equal(r.consultas.length, 1, "se intentó una sola vez");
});
