import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnOpenAICompat } from "../dist/modules/adapters/openai_compat.js";

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test("HTTP 200 con cuerpo no-JSON se reporta como sin JSON, no como timeout", async () => {
  const { server, base } = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>pagina inesperada</html>");
  });
  try {
    const r = await spawnOpenAICompat("openrouter", base, "modelo", "hola", "sk-test", { timeoutMs: 5000, maxChars: 100 });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /sin JSON/);
    assert.doesNotMatch(r.error ?? "", /timeout/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test("el timeout al leer el cuerpo se reporta como timeout accionable, no como sin JSON", async () => {
  const { server, base } = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.flushHeaders(); // cabeceras al cliente ya, cuerpo tarde: el aborto ocurre dentro de r.json()
    setTimeout(() => { try { res.end("{}"); } catch { /* cliente ya desconectado */ } }, 1500);
  });
  try {
    const r = await spawnOpenAICompat("openrouter", base, "modelo", "hola", "sk-test", { timeoutMs: 250, maxChars: 100 });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /timeout 250ms al leer la respuesta/);
    assert.match(r.error ?? "", /Ajustes/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});
