// Catálogo de modelos: la vista tiene que poder pedir los del proveedor que el
// usuario acaba de elegir (?proveedor=) aunque todavía no lo haya guardado — si no,
// pegar la key de OpenRouter y pulsar «Cargar modelos» devolvía la lista del
// proveedor anterior, vacía cuando aún era «off». Y «recomendados» no puede quedar
// en blanco cuando el proveedor retira sus ids curados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { startWeb } from "../dist/web.js";
import { filtrarModelosLive } from "../dist/modules/adapters/index.js";

let raiz = "";
let base = "";
let cerrar: () => void = () => {};
let keyPrevia: string | undefined;

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

interface Listado {
  ok: boolean;
  proveedor?: string;
  modelos?: { id: string; free?: boolean; recomendado?: boolean }[];
  error?: string;
}

async function modelos(query: string): Promise<{ status: number; d: Listado }> {
  const r = await fetch(`${base}/api/adapters/modelos${query}`);
  return { status: r.status, d: (await r.json()) as Listado };
}

before(async () => {
  // El servidor se prueba sin key en el entorno: con una exportada, el caso
  // «openrouter sin key» saldría a la red en vez de fallar cerrado.
  keyPrevia = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  raiz = mkdtempSync(join(tmpdir(), "axiom-modelos-"));
  writeFileSync(
    join(raiz, "adapters.config.json"),
    JSON.stringify({ proveedor: "off", model: "llama3.1", timeoutMs: 30000, maxChars: 8000 }, null, 2) + "\n",
  );
  const w = startWeb(raiz, await puertoLibre());
  base = `http://127.0.0.1:${w.port}`;
  cerrar = w.close;
});

after(() => {
  cerrar();
  if (keyPrevia === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = keyPrevia;
  rmSync(raiz, { recursive: true, force: true });
});

test("sin ?proveedor se respeta el guardado: off no inventa modelos", async () => {
  const { status, d } = await modelos("?filtro=todos");
  assert.equal(status, 200);
  assert.equal(d.ok, true);
  assert.deepEqual(d.modelos, []);
});

test("?proveedor lista el elegido aunque la config guardada diga off", async () => {
  const { status, d } = await modelos("?proveedor=ollama&filtro=todos");
  assert.equal(status, 200);
  assert.equal(d.proveedor, "ollama");
  assert.ok((d.modelos ?? []).length > 0, "el catálogo local de ollama no puede quedar vacío");
  assert.ok((d.modelos ?? []).every((m) => typeof m.id === "string" && m.id.length > 0));
});

test("un proveedor desconocido es 400 con los valores admitidos", async () => {
  const { status, d } = await modelos("?proveedor=gemini");
  assert.equal(status, 400);
  assert.equal(d.ok, false);
  assert.match(d.error ?? "", /proveedor inválido: gemini/);
  assert.match(d.error ?? "", /openrouter/);
});

test("openrouter sin key falla con un motivo accionable, no con una lista vacía", async () => {
  const { status, d } = await modelos("?proveedor=openrouter&filtro=todos");
  assert.equal(status, 500);
  assert.equal(d.ok, false);
  assert.match(d.error ?? "", /OPENROUTER_API_KEY/);
});

test("recomendados cae al catálogo completo cuando los ids curados ya no existen", () => {
  const live = [{ id: "acme/uno" }, { id: "acme/dos", free: true }];
  const out = filtrarModelosLive(live, "recomendados", ["retirado/viejo", "otro/ido"]);
  assert.deepEqual(out.map((m) => m.id), ["acme/uno", "acme/dos"]);
});

test("recomendados se queda con los curados que siguen vivos y los marca", () => {
  const live = [{ id: "acme/uno" }, { id: "acme/dos" }, { id: "acme/tres" }];
  const out = filtrarModelosLive(live, "recomendados", ["acme/dos"]);
  assert.deepEqual(out.map((m) => m.id), ["acme/dos"]);
  assert.equal(out[0].recomendado, true);
});

test("free sólo deja los gratuitos del catálogo vivo", () => {
  const live = [{ id: "acme/uno" }, { id: "acme/dos", free: true }];
  assert.deepEqual(filtrarModelosLive(live, "free", []).map((m) => m.id), ["acme/dos"]);
});
