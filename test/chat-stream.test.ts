// El chat abre el stream inmediatamente y lo usa para anunciar cada etapa. Antes,
// el trabajo previo al proveedor (leer el workspace, consultar EXA) corría con la
// respuesta todavía sin headers y el navegador no podía pintar nada: `ssepump`
// no arranca hasta que llega la respuesta. Este test lo fija sin depender de
// relojes: el proveedor simulado retiene su respuesta y aun así el primer evento
// (una fase) ya llegó, así que el orden es «abrir → anunciar → llamar al modelo».
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWeb } from "../dist/web.js";
import { saveConfig } from "../dist/modules/adapters/config.js";

interface Evento {
  fase?: string;
  delta?: string;
  ok?: boolean;
  texto?: string;
}

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

// Devuelve el próximo evento `data:` completo; `:open` y las líneas vacías se saltean.
async function leerEvento(
  lector: ReadableStreamDefaultReader<Uint8Array>,
  estado: { buf: string; fin: boolean },
): Promise<Evento | null> {
  const decod = new TextDecoder();
  for (;;) {
    const corte = estado.buf.indexOf("\n\n");
    if (corte >= 0) {
      const bloque = estado.buf.slice(0, corte);
      estado.buf = estado.buf.slice(corte + 2);
      const linea = bloque.split("\n").find((l) => l.startsWith("data: "));
      if (linea) return JSON.parse(linea.slice("data: ".length)) as Evento;
      continue;
    }
    if (estado.fin) return null;
    const { value, done } = await lector.read();
    if (done) { estado.fin = true; return null; }
    estado.buf += decod.decode(value, { stream: true });
  }
}

async function proyectoConProveedor(): Promise<{ base: string; cerrar: () => void; liberar: () => void; pedidos: () => number }> {
  const base = mkdtempSync(join(tmpdir(), "axiom-stream-"));
  let pedidos = 0;
  let liberar: () => void = () => {};
  const retenido = new Promise<void>((ok) => { liberar = ok; });
  const mock = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", async () => {
      pedidos++;
      // Se retiene a propósito: mientras no responda, el primer evento de fase
      // ya tiene que estar en el stream del chat.
      await retenido;
      let pideStream = false;
      try { pideStream = (JSON.parse(cuerpo) as { stream?: unknown }).stream === true; } catch { /* cuerpo ilegible */ }
      if (!pideStream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "Hola mundo" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n');
      res.write('data: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((ok) => mock.listen(0, "127.0.0.1", ok));
  const puerto = (mock.address() as AddressInfo).port;

  writeFileSync(join(base, "axiom.json"), "{}");
  writeFileSync(join(base, "axiom.db"), "");
  saveConfig(base, { proveedor: "openai", model: "mock", baseUrl: `http://127.0.0.1:${puerto}`, timeoutMs: 10_000, maxChars: 8_000 });
  process.env.OPENAI_API_KEY = "test-key";
  const srv = startWeb(base, await puertoLibre());
  return {
    base: `http://127.0.0.1:${srv.port}`,
    pedidos: () => pedidos,
    liberar: () => liberar(),
    // El mock se cierra al final: cerrar el listener apenas se libera la
    // respuesta haría que el pedido del chat (que todavía no salió) encuentre
    // el puerto vacío.
    cerrar: () => { srv.close(); mock.close(); },
  };
}

test("el stream se abre antes de llamar al modelo y anuncia la fase", async () => {
  const p = await proyectoConProveedor();
  try {
    const r = await fetch(`${p.base}/api/chat/enviar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "Hola, ¿qué tal?", modo: "ask", stream: true }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.ok(r.body, "la respuesta trae cuerpo");

    const lector = r.body.getReader();
    const estado = { buf: "", fin: false };
    const primero = await leerEvento(lector, estado);
    assert.ok(primero?.fase, `el primer evento debe ser una fase, llegó: ${JSON.stringify(primero)}`);
    assert.equal(p.pedidos(), 0, "la fase sale antes de que el proveedor reciba el pedido");

    p.liberar();
    const deltas: string[] = [];
    let final: Evento | null = null;
    for (;;) {
      const ev = await leerEvento(lector, estado);
      if (!ev) break;
      if (typeof ev.delta === "string") deltas.push(ev.delta);
      else final = ev;
    }
    assert.deepEqual(deltas, ["Hola", " mundo"], `cada delta sale por SSE en vivo, no en una sola pieza (final: ${JSON.stringify(final)})`);
    assert.equal(final?.ok, true);
    assert.equal(final?.texto, "Hola mundo");
  } finally {
    p.cerrar();
  }
});

test("sin stream la misma ruta sigue devolviendo JSON de una pieza", async () => {
  const p = await proyectoConProveedor();
  try {
    const pendiente = fetch(`${p.base}/api/chat/enviar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "Hola de nuevo", modo: "ask" }),
    });
    // El mock retiene: se libera y recién entonces llega el JSON.
    p.liberar();
    const r = await pendiente;
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /application\/json/);
    const d = (await r.json()) as Evento;
    assert.equal(d.ok, true);
    assert.equal(d.texto, "Hola mundo");
  } finally {
    p.cerrar();
  }
});
