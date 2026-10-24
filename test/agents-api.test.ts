// Tests de la API web de agentes sobre un servidor real (startWeb) y una raíz temporal:
// define, skill, pause, sus errores y el estado que devuelve GET /api/agents.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { startWeb, validateTokens, defaultWebSource, PAGE } from "../dist/web.js";
import vm from "node:vm";

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

interface Resp {
  ok: boolean;
  msg?: string;
  error?: string;
}
interface Agente {
  id: string;
  estado: string;
  skills: string[];
  instrucciones: string;
}

before(async () => {
  raiz = mkdtempSync(join(tmpdir(), "axiom-agents-"));
  const w = startWeb(raiz, await puertoLibre());
  base = `http://127.0.0.1:${w.port}`;
  cerrar = w.close;
});

after(() => {
  cerrar();
  rmSync(raiz, { recursive: true, force: true });
});

async function post(ruta: string, cuerpo: unknown): Promise<{ status: number; d: Resp }> {
  const r = await fetch(`${base}${ruta}`, { method: "POST", body: JSON.stringify(cuerpo) });
  return { status: r.status, d: (await r.json()) as Resp };
}

async function getAgentes(): Promise<{ agentes: Agente[]; aristas: unknown[] }> {
  const r = await fetch(`${base}/api/agents`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as { ok: boolean; agentes: Agente[]; aristas: unknown[] };
  assert.equal(d.ok, true);
  return d;
}

test("define instrucciones se guarda y se refleja en GET", async () => {
  const { status, d } = await post("/api/agents/define", {
    id: "nodo-code",
    campo: "instrucciones",
    valor: "instrucciones de prueba",
  });
  assert.equal(status, 200);
  assert.equal(d.ok, true);
  const g = await getAgentes();
  assert.equal(g.agentes.find((a) => a.id === "nodo-code")?.instrucciones, "instrucciones de prueba");
});

test("define con id inexistente responde 400", async () => {
  const { status, d } = await post("/api/agents/define", {
    id: "no-existe",
    campo: "instrucciones",
    valor: "x",
  });
  assert.equal(status, 400);
  assert.equal(d.ok, false);
  assert.match(d.error ?? "", /no existe/);
});

test("define instrucciones vacío responde 400 y '-' la vacía", async () => {
  const vacio = await post("/api/agents/define", { id: "nodo-code", campo: "instrucciones", valor: "" });
  assert.equal(vacio.status, 400);
  assert.equal(vacio.d.ok, false);

  const limpiar = await post("/api/agents/define", { id: "nodo-code", campo: "instrucciones", valor: "-" });
  assert.equal(limpiar.status, 200);
  const g = await getAgentes();
  assert.equal(g.agentes.find((a) => a.id === "nodo-code")?.instrucciones, "");
});

test("define campo inválido responde 400", async () => {
  const { status, d } = await post("/api/agents/define", { id: "nodo-code", campo: "otra-cosa", valor: "x" });
  assert.equal(status, 400);
  assert.match(d.error ?? "", /campo inválido/);
});

test("skill añade una skill y se refleja en GET", async () => {
  const { status, d } = await post("/api/agents/skill", { id: "nodo-review", skill: "nueva-skill" });
  assert.equal(status, 200);
  assert.equal(d.ok, true);
  const g = await getAgentes();
  assert.ok(g.agentes.find((a) => a.id === "nodo-review")?.skills.includes("nueva-skill"));
});

test("skill con id inexistente responde 400", async () => {
  const { status, d } = await post("/api/agents/skill", { id: "no-existe", skill: "x" });
  assert.equal(status, 400);
  assert.match(d.error ?? "", /no existe/);
});

test("pause alterna pausado y activo", async () => {
  const p1 = await post("/api/agents/pause", { id: "esp-seguridad" });
  assert.equal(p1.status, 200);
  let g = await getAgentes();
  assert.equal(g.agentes.find((a) => a.id === "esp-seguridad")?.estado, "pausado");

  const p2 = await post("/api/agents/pause", { id: "esp-seguridad" });
  assert.equal(p2.status, 200);
  g = await getAgentes();
  assert.equal(g.agentes.find((a) => a.id === "esp-seguridad")?.estado, "activo");
});

test("pause con id inexistente responde 400", async () => {
  const { status, d } = await post("/api/agents/pause", { id: "no-existe" });
  assert.equal(status, 400);
  assert.match(d.error ?? "", /no existe/);
});

test("GET /api/agents devuelve agentes y aristas del grafo", async () => {
  const g = await getAgentes();
  assert.ok(g.agentes.length >= 4);
  assert.ok(g.aristas.length >= 4);
});

test("el HTML se sirve con Cache-Control no-store para que la pestaña no conserve builds viejos", async () => {
  for (const ruta of ["/", "/index.html"]) {
    const r = await fetch(`${base}${ruta}`);
    assert.equal(r.status, 200, `${ruta} debe servir el HTML`);
    assert.match(r.headers.get("content-type") ?? "", /text\/html/, `${ruta} content-type HTML`);
    assert.equal(r.headers.get("cache-control"), "no-store", `${ruta} cache-control no-store (real, del servidor vivo)`);
    // ETag/Last-Modified harían que un proxy pueda servir 304 de una respuesta vieja.
    assert.equal(r.headers.get("etag"), null, `${ruta} sin ETag`);
    assert.equal(r.headers.get("last-modified"), null, `${ruta} sin Last-Modified`);
  }
});

test("validate-tokens reporta cero hex fuera de :root en src/web.ts", () => {
  const f = defaultWebSource();
  const r = validateTokens(f);
  assert.equal(r.ok, true, "validate-tokens debe estar OK");
  assert.equal(r.errores.length, 0, "no debe haber hex fuera de :root: " + r.errores.join("; "));
});

test("ciclo completo: define por API y agred pinta el tooltip con las nuevas instrucciones", async () => {
  const instr = "instrucciones del ciclo completo";
  const { status, d } = await post("/api/agents/define", { id: "nodo-code", campo: "instrucciones", valor: instr });
  assert.equal(status, 200);
  assert.equal(d.ok, true);
  const g = await getAgentes();

  const ctx: Record<string, unknown> = { console, fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) }), setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {}, document: { hidden: false, getElementById: () => ({ style: {}, innerHTML: "", value: "", textContent: "", className: "", oyentes: {}, addEventListener() {}, focus() {}, setAttribute() {}, getAttribute: () => null, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} } }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, innerHTML: "", value: "", textContent: "", className: "", oyentes: {}, addEventListener() {}, focus() {}, setAttribute() {}, getAttribute: () => null, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} } }), body: { appendChild() {}, classList: { toggle() {} } } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  const ini = PAGE.lastIndexOf("<script>") + "<script>".length;
  const fin = PAGE.lastIndexOf("</script>");
  const js = PAGE.slice(ini, fin).split("\n").filter((l) => !l.includes("redauto(); agwire();")).join("\n");
  new vm.Script(js).runInContext(ctx);
  const svg = String((ctx as Record<string, (x: unknown) => unknown>)["agred"](g));
  assert.ok(svg.includes(instr), "agred debe pintar las instrucciones nuevas en el tooltip");
});
