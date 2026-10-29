// Turnos con id de correlación: `turnos` une el mensaje del usuario, el modelo,
// las herramientas (trace_log.turno_id) y la respuesta final. Sin esta fila, la
// cadena se adivinaba por el texto de `contexto` y se rompía con cualquier
// cambio de formato. Reglas que fijan estos tests:
//  - el id viaja del broker a cada traza de la corrida;
//  - un turno sin fila NUNCA rompe la respuesta (best-effort);
//  - `status --trace` muestra el turno y sus trazas juntas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { check } from "../dist/broker.js";
import { listTurnos, openDb, recordTraza, recordTurno, trazasDeTurno } from "../dist/store.js";
import { lineaTurno } from "../dist/commands.js";
import { startWeb } from "../dist/web.js";
import { saveConfig } from "../dist/modules/adapters/config.js";

function raiz(): string {
  return mkdtempSync(join(tmpdir(), "axiom-turnos-"));
}

test("el id del turno viaja del broker a la traza y agrupa solo sus herramientas", () => {
  const root = raiz();
  try {
    check(root, "read", undefined, undefined, { origen: "run", turno: "t-a", entrada: { ruta: "a.md" } });
    check(root, "read", undefined, undefined, { origen: "run", turno: "t-a", entrada: { ruta: "b.md" } });
    check(root, "read", undefined, undefined, { origen: "cli", entrada: { ruta: "suelta.md" } });
    const propias = trazasDeTurno(root, "t-a");
    assert.equal(propias.length, 2, "solo las trazas de ese turno");
    assert.deepEqual(propias.map((t) => t.turno_id), ["t-a", "t-a"]);
    assert.equal(trazasDeTurno(root, "t-b").length, 0, "un turno sin trazas devuelve vacío, no todo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordTurno guarda mensaje, modelo, cache y costo; listTurnos devuelve el más reciente primero", () => {
  const root = raiz();
  try {
    recordTurno(root, {
      id: "t-1", sesionId: "s-1", mensajeUsuarioId: 3, mensajeId: 4,
      proveedor: "openrouter", model: "m/x", promptSha: "a".repeat(64),
      tokens: 1200, cacheLectura: 800, cacheEscritura: 50, costoUsd: 0.0021,
      llamadas: 2, herramientas: 1, ok: true, ms: 432,
    });
    recordTurno(root, { id: "t-2", agente: "coder", ok: false, error: "timeout" });
    const [reciente, anterior] = listTurnos(root, 8);
    assert.equal(reciente.id, "t-2");
    assert.equal(reciente.ok, 0);
    assert.equal(reciente.error, "timeout");
    assert.equal(anterior.id, "t-1");
    assert.equal(anterior.sesion_id, "s-1");
    assert.equal(anterior.mensaje_usuario_id, 3);
    assert.equal(anterior.mensaje_id, 4);
    assert.equal(anterior.tokens, 1200);
    assert.equal(anterior.cache_lectura, 800);
    assert.equal(anterior.costo_usd, 0.0021);
    const linea = lineaTurno(anterior);
    assert.match(linea, /^t-1 /);
    assert.match(linea, /sesion=s-1/);
    assert.match(linea, /msg=3→4/);
    assert.match(linea, /1200tok cache=800r\+50w \$0\.002100/);
    assert.match(linea, /llm=2 tools=1 msg=3→4 432ms ok$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("un turno que no se puede escribir no rompe al que lo produjo", () => {
  const base = raiz();
  const archivo = join(base, "no-es-dir");
  try {
    writeFileSync(archivo, "x");
    // projectRoot apunta a un archivo: openDb no puede crear la DB.
    assert.doesNotThrow(() => recordTurno(join(archivo, "axiom"), { id: "t-x" }));
    assert.doesNotThrow(() => recordTraza(join(archivo, "axiom"), { origen: "cli", tool: "read", decision: "allow" }));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("una DB vieja gana turno_id en trace_log sin perder filas", () => {
  const root = raiz();
  try {
    const db = new DatabaseSync(join(root, "axiom.db"));
    db.exec("CREATE TABLE trace_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, origen TEXT, tool TEXT, agente TEXT DEFAULT '', decision TEXT, riesgo TEXT DEFAULT '', motivo TEXT DEFAULT '', approval_id TEXT DEFAULT '', entrada TEXT DEFAULT '', salida TEXT DEFAULT '', sha_io TEXT DEFAULT '', contexto TEXT DEFAULT '', ok INTEGER DEFAULT 1, ms INTEGER DEFAULT 0)");
    db.prepare("INSERT INTO trace_log(ts,origen,tool,decision) VALUES(?,?,?,?)").run("2026-10-01", "cli", "read", "allow");
    db.close();
    const migrada = openDb(root);
    const filas = migrada.prepare("SELECT tool, turno_id FROM trace_log").all() as { tool: string; turno_id: string }[];
    assert.deepEqual(filas.map((f) => [f.tool, f.turno_id]), [["read", ""]], "la fila vieja queda con turno vacío");
    migrada.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("un turno del chat queda ligado al mensaje del usuario y a la respuesta", async () => {
  const base = raiz();
  const mock = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", () => {
      let stream = false;
      try { stream = (JSON.parse(cuerpo) as { stream?: unknown }).stream === true; } catch { /* ilegible */ }
      if (!stream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "Listo, revisado." } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Listo, revisado."}}]}\n\n');
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
  const srv = startWeb(base, 0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "Revisá el archivo y decime qué ves", modo: "ask" }),
    });
    assert.equal(r.status, 200);
    const [turno] = listTurnos(base, 5);
    assert.ok(turno, "el turno quedó registrado");
    assert.match(turno.id, /^t-[0-9a-f]{8}$/);
    assert.ok(turno.sesion_id, "el turno nombra su sesión");
    assert.equal(typeof turno.mensaje_usuario_id, "number");
    assert.equal(typeof turno.mensaje_id, "number", "la respuesta final queda enlazada");
    assert.equal(turno.proveedor, "openai");
    assert.equal(turno.modelo, "mock");
    assert.equal(turno.tokens, 5);
    assert.equal(turno.llamadas, 1);
    assert.equal(turno.ok, 1);
    assert.match(turno.prompt_sha, /^[0-9a-f]{64}$/, "se guarda el sha del prompt, no el prompt");
    const db = openDb(base);
    const msg = db.prepare("SELECT session_id, rol FROM chat_messages WHERE id=?").get(turno.mensaje_usuario_id) as { session_id: string; rol: string };
    db.close();
    assert.deepEqual([msg.session_id, msg.rol], [turno.sesion_id, "usuario"]);
  } finally {
    srv.close();
    mock.close();
    rmSync(base, { recursive: true, force: true });
  }
});
