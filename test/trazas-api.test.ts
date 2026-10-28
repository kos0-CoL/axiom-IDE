// GET /api/trazas sobre un servidor real (startWeb): mismas filas que la CLI,
// con `linea` formateado por lineaTraza (una sola fuente de formato), filtro
// por contexto, límites sanados y la vista del panel anunciada en el HTML.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { startWeb, PAGE } from "../dist/web.js";
import { recordTraza } from "../dist/store.js";

let raiz = "";
let base = "";
let cerrar: () => void = () => {};

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

before(async () => {
  raiz = mkdtempSync(join(tmpdir(), "axiom-trazas-api-"));
  const w = startWeb(raiz, await puertoLibre());
  base = `http://127.0.0.1:${w.port}`;
  cerrar = w.close;
});

after(() => {
  cerrar();
  rmSync(raiz, { recursive: true, force: true });
});

interface TrazaApi {
  ok: boolean;
  limite: number;
  contexto: string;
  trazas: {
    tool: string;
    agente: string;
    decision: string;
    ms: number;
    contexto: string;
    sha_io: string;
    linea: string;
  }[];
}

test("GET /api/trazas devuelve filas con linea formateado y filtra por contexto", async () => {
  recordTraza(raiz, {
    origen: "cli", tool: "editar", agente: "n1", decision: "allow",
    riesgo: "medio", motivo: "política", approvalId: "ap-1",
    entrada: { ruta: "a.ts" }, salida: { ok: true },
    contexto: "run demo/T1", ok: true, ms: 12,
  });
  recordTraza(raiz, {
    origen: "run", tool: "terminal", agente: "n2", decision: "deny",
    motivo: "terminal off", entrada: "ls", salida: "",
    contexto: "otra-cosa", ok: false, ms: 3,
  });

  const r = await fetch(`${base}/api/trazas`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as TrazaApi;
  assert.equal(d.ok, true);
  assert.equal(d.limite, 50, "limite por defecto sanado");
  assert.ok(d.trazas.length >= 2, "las dos trazas registradas se listan");

  const t = d.trazas.find((z) => z.tool === "editar");
  assert.ok(t, "aparece la traza registrada");
  // `linea` es literalmente la línea de la CLI (lineaTraza), no un formato propio.
  assert.match(t.linea, /editar\(n1\): allow id=ap-1 12ms /);
  assert.match(t.linea, /sha=[0-9a-f]{8}/);
  assert.match(t.linea, /\[run demo\/T1\]$/);
  assert.equal(t.contexto, "run demo/T1");

  const denegada = d.trazas.find((z) => z.tool === "terminal");
  assert.ok(denegada && denegada.linea.includes(": deny"), "la denegada también queda trazada");

  // Filtro por contexto (LIKE), igual que `axiom status --trace <tarea>`.
  const f = (await (await fetch(`${base}/api/trazas?contexto=${encodeURIComponent("demo/T1")}`)).json()) as TrazaApi;
  assert.equal(f.trazas.length, 1, "contexto LIKE aísla la tarea");
  assert.equal(f.trazas[0].contexto, "run demo/T1");

  // Parámetros sanados: no numérico o fuera de rango cae al defecto, sin 500.
  const l = (await (await fetch(`${base}/api/trazas?limite=abc`)).json()) as TrazaApi;
  assert.equal(l.limite, 50);
  const l2 = (await (await fetch(`${base}/api/trazas?limite=9999`)).json()) as TrazaApi;
  assert.equal(l2.limite, 200, "tope 200");
});

test("el vacío por filtro sin coincidencias es 200 ok y distinto del vacío real", async () => {
  // 1) Filtro sin coincidencias: la respuesta es un 200 ok con lista vacía
  //    (no un error), con el contexto ecoado — lo que la vista usa para decir
  //    «el filtro las excluye» en vez de «todavía no hay trazas».
  const sin = (await (await fetch(`${base}/api/trazas?contexto=zzz-sin-coincidencias`)).json()) as TrazaApi;
  assert.equal(sin.ok, true, "sin coincidencias no es error: es ok con lista vacía");
  assert.deepEqual(sin.trazas, [], "el filtro aísla a cero filas");
  assert.equal(sin.contexto, "zzz-sin-coincidencias", "el endpoint ecoa el filtro aplicado");

  // 2) Sin filtro, la misma base sigue devolviendo filas: el vacío lo produjo
  //    el filtro, no la ausencia de datos.
  const todas = (await (await fetch(`${base}/api/trazas`)).json()) as TrazaApi;
  assert.ok(todas.trazas.length >= 2, "la base sí tiene trazas sin el filtro");

  // 3) Vacío real: raíz sin ninguna traza → misma forma (ok + lista vacía),
  //    así que la distinción en el panel la da el filtro activo, no la forma.
  const vacia = mkdtempSync(join(tmpdir(), "axiom-trazas-vacia-"));
  const w = startWeb(vacia, await puertoLibre());
  try {
    const r = await fetch(`http://127.0.0.1:${w.port}/api/trazas`);
    assert.equal(r.status, 200);
    const d = (await r.json()) as TrazaApi;
    assert.equal(d.ok, true);
    assert.deepEqual(d.trazas, []);
    assert.equal(d.contexto, "", "sin filtro no hay contexto ecoado");
  } finally {
    w.close();
    rmSync(vacia, { recursive: true, force: true });
  }
});

test("la vista Trazas está en el HTML y consume la API", () => {
  assert.match(PAGE, /data-view="trz"/, "botón Trazas en la barra de vistas");
  assert.match(PAGE, /id="v-trz"/, "la vista existe");
  assert.match(PAGE, /fetch\('api\/trazas'/, "la vista llama a la API (sin reimprimir datos)");
  assert.match(PAGE, /Trazas de tool calls/, "con su explicación de fuente");
});
