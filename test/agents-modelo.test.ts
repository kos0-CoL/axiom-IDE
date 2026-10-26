import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "../dist/modules/adapters/index.js";
import { modeloDeAgente } from "../dist/modules/agents/ejecucion.js";

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

// Proyecto temporal con adapters.config.json apuntando al servidor de prueba.
function proyectoCon(baseUrl: string, modelGlobal: string): string {
  const root = mkdtempSync(join(tmpdir(), "axiom-modelo-"));
  writeFileSync(join(root, "adapters.config.json"), JSON.stringify({
    proveedor: "openai",
    model: modelGlobal,
    baseUrl,
    timeoutMs: 5000,
    maxChars: 1000,
  }, null, 2) + "\n");
  return root;
}

function okJson(res: ServerResponse, texto: string): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: texto } }] }));
}

test("spawn usa el modelo del agente cuando se pasa como override", async () => {
  const vistos: string[] = [];
  const { server, base } = await listen((req, res) => {
    let cuerpo = "";
    req.on("data", (t) => { cuerpo += t; });
    req.on("end", () => {
      try { vistos.push(JSON.parse(cuerpo).model); } catch { vistos.push("ilegible"); }
      okJson(res, "listo");
    });
  });
  const root = proyectoCon(base, "modelo-global");
  try {
    const conOverride = await spawn(root, "hola", { key: "sk-test", model: "modelo-del-agente" });
    assert.equal(conOverride.ok, true, conOverride.ok ? "" : conOverride.error);
    assert.equal(vistos[0], "modelo-del-agente", "el request debe pedir el modelo del agente");
    assert.equal(conOverride.model, "modelo-del-agente", "SpawnResult.model debe reportar el modelo real");

    const sinOverride = await spawn(root, "hola", { key: "sk-test" });
    assert.equal(sinOverride.ok, true, sinOverride.ok ? "" : sinOverride.error);
    assert.equal(vistos[1], "modelo-global", "sin override debe pedir el modelo global");
    assert.equal(sinOverride.model, "modelo-global");
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    rmSync(root, { recursive: true, force: true });
  }
});

test("un override vacío o con espacios no rompe: cae al modelo global", async () => {
  const vistos: string[] = [];
  const { server, base } = await listen((req, res) => {
    let cuerpo = "";
    req.on("data", (t) => { cuerpo += t; });
    req.on("end", () => {
      try { vistos.push(JSON.parse(cuerpo).model); } catch { vistos.push("ilegible"); }
      okJson(res, "listo");
    });
  });
  const root = proyectoCon(base, "modelo-global");
  try {
    const r = await spawn(root, "hola", { key: "sk-test", model: "   " });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.deepEqual(vistos, ["modelo-global"]);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    rmSync(root, { recursive: true, force: true });
  }
});

test("el error del proveedor por modelo inexistente se propaga (sin caer al global)", async () => {
  const pedidos: string[] = [];
  const { server, base } = await listen((req, res) => {
    let cuerpo = "";
    req.on("data", (t) => { cuerpo += t; });
    req.on("end", () => {
      let modelo = "";
      try { modelo = String(JSON.parse(cuerpo).model ?? ""); } catch { /* cuerpo ilegible */ }
      pedidos.push(modelo);
      if (modelo === "modelo-que-no-existe") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "model not found: modelo-que-no-existe" } }));
        return;
      }
      okJson(res, "listo");
    });
  });
  const root = proyectoCon(base, "modelo-global");
  try {
    const r = await spawn(root, "hola", { key: "sk-test", model: "modelo-que-no-existe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /model not found/);
    assert.equal(r.model, "modelo-que-no-existe", "el error debe nombrar el modelo pedido");
    assert.deepEqual(pedidos, ["modelo-que-no-existe"], "no debe reintentar con el modelo global");
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    rmSync(root, { recursive: true, force: true });
  }
});

test("modeloDeAgente: hereda-proveedor y vacío significan modelo global", () => {
  assert.equal(modeloDeAgente({ modelo: "hereda-proveedor" }), undefined);
  assert.equal(modeloDeAgente({ modelo: "" }), undefined);
  assert.equal(modeloDeAgente({ modelo: "   " }), undefined);
  assert.equal(modeloDeAgente({ modelo: "anthropic/claude-sonnet-4.5" }), "anthropic/claude-sonnet-4.5");
  assert.equal(modeloDeAgente({ modelo: "  gpt-4o-mini  " }), "gpt-4o-mini");
});
