// «Probar conexión» (Ajustes → Proveedor LLM): el botón manda un spawn mínimo al
// proveedor elegido en el formulario, sin guardarlo, y la vista tiene que poder
// enseñar el error REAL del proveedor (401 por key revocada, por ejemplo), no un
// «no hay modelos» que deja al usuario sin saber qué pasó.
//
// El endpoint es /api/adapters/spawn con `proveedor`/`model`/`baseUrl`/`maxChars`
// del formulario: aquí se prueba contra un proveedor de mentira local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startWeb } from "../dist/web.js";
import { setSecrets } from "../dist/secrets.js";

let raiz = "";
let base = "";
let cerrar: () => void = () => {};
let cerrarProv: () => void = () => {};
let baseProveedor = "";
let envOpenai: string | undefined;

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

interface Prueba {
  ok: boolean;
  text?: string;
  error?: string;
  ms?: number;
  proveedor?: string;
  model?: string;
  truncada?: boolean;
  uso?: { prompt: number; respuesta: number; total: number; fuente: string };
}

async function probar(cuerpo: Record<string, unknown>): Promise<{ status: number; d: Prueba }> {
  const r = await fetch(`${base}/api/adapters/spawn`, { method: "POST", body: JSON.stringify(cuerpo) });
  return { status: r.status, d: (await r.json()) as Prueba };
}

before(async () => {
  // Sin keys del entorno: con una exportada, el caso «sin key» saldría del equipo.
  envOpenai = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  // Proveedor de mentira: la key que empieza por «mala» es rechazada con el típico
  // 401 de OpenAI («No auth credentials found»).
  const prov = createHttpServer((req, res) => {
    const auth = String(req.headers.authorization ?? "");
    let texto = "ok";
    let chunks = "";
    req.on("data", (c) => { chunks += c; });
    req.on("end", () => {
      try {
        const body = JSON.parse(chunks) as { model?: string };
        if (String(body.model ?? "").includes("largo")) texto = "x".repeat(50);
      } catch { /* sin JSON: se responde corto */ }
      const buena = auth.startsWith("Bearer buena");
      const cuerpo = buena
        ? { choices: [{ message: { content: texto } }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }
        : { error: { message: "No auth credentials found" } };
      res.writeHead(buena ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(cuerpo));
    });
  });
  const puertoProv = await puertoLibre();
  await new Promise<void>((r) => prov.listen(puertoProv, "127.0.0.1", r));
  baseProveedor = `http://127.0.0.1:${puertoProv}`;
  cerrarProv = () => prov.close();

  raiz = mkdtempSync(join(tmpdir(), "axiom-prueba-"));
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
  cerrarProv();
  if (envOpenai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = envOpenai;
  rmSync(raiz, { recursive: true, force: true });
});

test("un proveedor que no existe es 400 con los valores admitidos", async () => {
  const { status, d } = await probar({ task: "responde ok", proveedor: "gemini" });
  assert.equal(status, 400);
  assert.equal(d.ok, false);
  assert.match(d.error ?? "", /proveedor inválido: gemini/);
  assert.match(d.error ?? "", /openrouter/);
});

test("sin key el motivo dice qué guardar, antes de salir a la red", async () => {
  const { status, d } = await probar({ task: "responde ok", proveedor: "openrouter" });
  assert.equal(status, 500);
  assert.equal(d.ok, false);
  assert.equal(d.proveedor, "openrouter");
  assert.match(d.error ?? "", /OPENROUTER_API_KEY/);
});

test("una key que el proveedor rechaza devuelve SU error, no uno genérico", async () => {
  setSecrets(raiz, { OPENAI_API_KEY: "mala-123" });
  const { status, d } = await probar({ task: "responde ok", proveedor: "openai", baseUrl: baseProveedor, timeoutMs: 5000 });
  assert.equal(status, 500);
  assert.equal(d.ok, false);
  assert.equal(d.proveedor, "openai");
  assert.match(d.error ?? "", /openai: No auth credentials found/);
});

test("con una key buena devuelve ok, texto, tokens medidos y lo elegido sin guardar", async () => {
  setSecrets(raiz, { OPENAI_API_KEY: "buena-abc" });
  const { status, d } = await probar({
    task: "responde solo con la palabra ok",
    proveedor: "openai",
    model: "gpt-4o-mini",
    baseUrl: baseProveedor,
    timeoutMs: 5000,
    maxChars: 200,
  });
  assert.equal(status, 200);
  assert.equal(d.ok, true);
  assert.equal(d.text, "ok");
  assert.equal(d.proveedor, "openai");
  assert.equal(d.model, "gpt-4o-mini");
  assert.deepEqual(d.uso, { prompt: 5, respuesta: 1, total: 6, fuente: "medido" });
  // La config guardada sigue siendo la de antes: probar no guarda el proveedor.
  const cfg = JSON.parse(
    (await import("node:fs")).readFileSync(join(raiz, "adapters.config.json"), "utf8"),
  ) as { proveedor: string; model: string };
  assert.equal(cfg.proveedor, "off");
  assert.equal(cfg.model, "llama3.1");
});

test("maxChars acota la respuesta de la prueba", async () => {
  setSecrets(raiz, { OPENAI_API_KEY: "buena-abc" });
  const { status, d } = await probar({ task: "responde ok", proveedor: "openai", model: "modelo-largo", baseUrl: baseProveedor, timeoutMs: 5000, maxChars: 10 });
  assert.equal(status, 200);
  assert.equal(d.text, "x".repeat(10));
  assert.equal(d.truncada, true);
});
