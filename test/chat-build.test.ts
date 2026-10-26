import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../dist/store.js";
import { DatabaseSync } from "node:sqlite";
import { guardarMensaje, mensajesDe, usoSesion } from "../dist/sessions.js";
import { crearProyecto } from "../dist/proyectos.js";
import { startWeb } from "../dist/web.js";
import { aplicarBuildPropuesta, contextoPlanAprobado, guardarArtefactosPlan, guardarBuildPropuesta, obtenerBuildPropuesta, parseBuildChanges } from "../dist/chat-build.js";

function tempDir(prefix: string): string { return mkdtempSync(join(tmpdir(), prefix)); }
function session(root: string, id: string, mode = "build"): void {
  const db = openDb(root);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO chat_sessions(id,titulo,modo,archivada,created_at,updated_at) VALUES(?,?,?,0,?,?)").run(id, "dashboard", mode, now, now);
  db.close();
}

test("PLAN persiste un único spec y plan asociados a su propuesta, reutilizables al aprobar", () => {
  const root = tempDir("axiom-plan-artifacts-");
  try {
    session(root, "s-test", "plan");
    const db = openDb(root);
    db.prepare("INSERT INTO chat_messages(session_id,rol,texto,created_at) VALUES(?,?,?,?)").run("s-test", "usuario", "Crea un dashboard de ventas", new Date().toISOString());
    db.close();
    const proposal = guardarArtefactosPlan(root, "s-test", "Crea un dashboard de ventas", "1. Diseñar\n2. Implementar", undefined, { proveedor: "openrouter", model: "nvidia/nemotron-3-ultra-550b" });
    assert.equal(proposal.ok, true);
    if (!proposal.ok) return;
    const repeated = guardarArtefactosPlan(root, "s-test", "otro", "otro plan", proposal.proposal_id);
    assert.deepEqual(repeated, proposal);
    const files = proposal.files.map((path) => readFileSync(join(root, path), "utf8"));
    assert.match(files[0], /Crea un dashboard de ventas/);
    assert.match(files[0], /\*\*generado con:\*\* openrouter\/nvidia\/nemotron-3-ultra-550b · \d{4}-/);
    assert.match(files[1], /1\. Diseñar/);
    assert.match(files[1], /\*\*generado con:\*\* openrouter\/nvidia\/nemotron-3-ultra-550b · \d{4}-/, "plan.md también lleva el encabezado de generación");
    const measured = guardarArtefactosPlan(root, "s-test", "Crea un dashboard de ventas", "1. Diseñar\n2. Implementar", undefined, { proveedor: "openrouter", model: "nvidia/nemotron-3-ultra-550b", uso: { prompt: 1200, respuesta: 900, total: 2100, fuente: "medido" } });
    assert.equal(measured.ok, true);
    if (measured.ok) {
      assert.match(readFileSync(join(root, measured.files[0]), "utf8"), /\*\*generado con:\*\* openrouter\/nvidia\/nemotron-3-ultra-550b · \d{4}-\d{2}-\d{2}[^\n]* · 2100 tok \(1200p\/900r\)/, "spec.md muestra los tokens cuando el proveedor los mide");
      assert.match(readFileSync(join(root, measured.files[1]), "utf8"), / · 2100 tok \(1200p\/900r\)/, "plan.md lleva los mismos tokens que spec.md");
    }
    const estimated = guardarArtefactosPlan(root, "s-test", "Crea un dashboard de ventas", "1. Diseñar\n2. Implementar", undefined, { proveedor: "openrouter", model: "nvidia/nemotron-3-ultra-550b", uso: { prompt: 50, respuesta: 40, total: 90, fuente: "estimado" } });
    assert.equal(estimated.ok, true);
    if (estimated.ok) {
      assert.doesNotMatch(readFileSync(join(root, estimated.files[0]), "utf8"), / tok \(/, "spec.md no muestra tokens estimados");
    }
    const check = openDb(root);
    assert.equal(check.prepare("SELECT count(*) AS n FROM plan_propuestas WHERE id=?").get(proposal.proposal_id)?.n, 1);
    assert.equal(check.prepare("SELECT count(*) AS n FROM specs WHERE id=?").get(proposal.spec_id)?.n, 1);
    check.prepare("UPDATE plan_propuestas SET estado='aprobada' WHERE id=?").run(proposal.proposal_id);
    check.close();
    assert.match(contextoPlanAprobado(root, "s-test"), /dashboard de ventas/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("reenviado persiste la línea de sistema con intento y error original", async () => {
  const parent = tempDir("axiom-reenvio-");
  const created = crearProyecto(parent, "reenvio-test");
  try {
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const server = startWeb(created.path, 0);
    try {
      const post = (path: string, body: object) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port: server.port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => { raw += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
        });
        req.on("error", reject);
        req.end(JSON.stringify(body));
      });
      const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port: server.port, path, method: "GET" }, (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => { raw += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
        });
        req.on("error", reject);
        req.end();
      });
      const ses = await post("/api/chat/sesiones", { modo: "ask" });
      const sessionId = (JSON.parse(ses.body) as { sesion: { id: string } }).sesion.id;
      await post("/api/chat/enviar", { session_id: sessionId, modo: "ask", texto: "hola test", reenviado: true, intento: 2, error_previo: "openrouter: timeout 100ms" });
      await post("/api/chat/enviar", { session_id: sessionId, modo: "ask", texto: "otra", reenviado: true });
      await post("/api/chat/enviar", { session_id: sessionId, modo: "ask", texto: "más", reenviado: true, intento: 9, error_previo: "   " });
      const list = await get(`/api/chat/sesiones/${sessionId}/mensajes`);
      const parsed = JSON.parse(list.body) as { mensajes: { rol: string; texto: string }[]; uso?: { ok: boolean; tokens: number; llamadas: number } };
      assert.deepEqual(parsed.uso, { ok: true, tokens: 0, llamadas: 0 }, "el historial trae el uso agregado de la sesión");
      const mensajes = parsed.mensajes;
      const lineas = mensajes.filter((m) => m.rol === "sistema").map((m) => m.texto);
      const reenvios = lineas.filter((t) => t.startsWith("Mensaje reenviado tras error"));
      assert.match(reenvios[0], /Mensaje reenviado tras error · intento 2 de 3 · Error original: openrouter: timeout 100ms/);
      assert.equal(reenvios[1], "Mensaje reenviado tras error", "sin intento/error válido cae a la línea simple");
      assert.equal(reenvios[2], "Mensaje reenviado tras error", "error en blanco cae a la línea simple");
    } finally { server.close(); }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("Reenviado en modo Plan responde confirmación corta sin generar spec", async () => {
  const parent = tempDir("axiom-reenvio-plan-");
  const created = crearProyecto(parent, "reenvio-plan-test");
  try {
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const server = startWeb(created.path, 0);
    try {
      const post = (path: string, body: object) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port: server.port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => { raw += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
        });
        req.on("error", reject);
        req.end(JSON.stringify(body));
      });
      const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port: server.port, path, method: "GET" }, (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => { raw += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
        });
        req.on("error", reject);
        req.end();
      });
      const ses = await post("/api/chat/sesiones", { modo: "plan" });
      const sessionId = (JSON.parse(ses.body) as { sesion: { id: string } }).sesion.id;
      const envio = await post("/api/chat/enviar", { session_id: sessionId, modo: "plan", texto: "plan de ventas", reenviado: true, intento: 2, error_previo: "openrouter: timeout" });
      const denvio = JSON.parse(envio.body) as { ok: boolean; texto: string; reenvio_confirmado?: boolean };
      assert.equal(denvio.ok, true, "el reenvío en plan responde ok sin llamar al proveedor");
      assert.equal(denvio.reenvio_confirmado, true);
      assert.match(denvio.texto, /Reenvío confirmado \(intento 2 de 3\)/);
      assert.match(denvio.texto, /no se regenera la spec completa/);
      const list = await get(`/api/chat/sesiones/${sessionId}/mensajes`);
      const dlist = JSON.parse(list.body) as { mensajes: { rol: string; texto: string }[] };
      const roles = dlist.mensajes.map((m) => m.rol);
      assert.ok(roles.includes("asistente"), "la confirmación quedó en el historial");
      assert.ok(dlist.mensajes.some((m) => m.rol === "sistema" && m.texto.includes("Error original: openrouter: timeout")), "la sub-línea de reenvío sigue registrada");
      const specs = await get("/api/specs");
      const dspecs = JSON.parse(specs.body) as { specs: unknown[] };
      assert.deepEqual(dspecs.specs, [], "no se crearon specs por el reenvío en plan");
    } finally { server.close(); }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("uso del chat: tokens por mensaje, agregado de sesión y migración de DBs viejas", () => {
  const root = tempDir("axiom-chat-uso-");
  try {
    // DB con el esquema previo (sin columna tokens): el único INSERT sucumbe; hay migración
    const vieja = new DatabaseSync(join(root, "axiom.db"));
    vieja.exec("CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY, titulo TEXT, modo TEXT, archivada INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);");
    vieja.exec("CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, rol TEXT, texto TEXT, proveedor TEXT, model TEXT, skill TEXT, ms INTEGER, created_at TEXT);");
    const now = new Date().toISOString();
    vieja.prepare("INSERT INTO chat_sessions(id,titulo,modo,archivada,created_at,updated_at) VALUES(?,?,?,0,?,?)").run("s-vieja", "viejo", "ask", now, now);
    vieja.prepare("INSERT INTO chat_messages(session_id,rol,texto,created_at) VALUES(?,?,?,?)").run("s-vieja", "asistente", "respuesta previa", now);
    vieja.close();
    openDb(root);
    const checkMig = openDb(root);
    const fila = checkMig.prepare("SELECT tokens FROM chat_messages WHERE session_id='s-vieja' LIMIT 1").get() as { tokens: number } | undefined;
    checkMig.close();
    assert.equal(fila?.tokens, 0, "la migración añade la columna sin perder datos");

    session(root, "s-uso", "ask");
    guardarMensaje(root, "s-uso", "usuario", "¿cuánto gastaste?");
    guardarMensaje(root, "s-uso", "asistente", "resp", { proveedor: "openrouter", model: "m", ms: 120, tokens: 2100 });
    const msgs = mensajesDe(root, "s-uso");
    assert.equal(msgs.ok, true);
    if (msgs.ok) {
      assert.equal(msgs.mensajes[0].tokens, 0, "los mensajes del usuario no gastan tokens");
      assert.equal(msgs.mensajes[1].tokens, 2100, "el mensaje del asistente guarda lo informado por el proveedor");
    }
    guardarMensaje(root, "s-uso", "asistente", "resp 2", { proveedor: "openrouter", model: "m", ms: 80, tokens: 43.7 });
    assert.deepEqual(usoSesion(root, "s-uso"), { ok: true, tokens: 2144, llamadas: 2 }, "agregado: tokens sumados y llamadas solo del asistente");
    assert.equal(usoSesion(root, "s-inexistente").ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Build valida JSON y bloquea destinos inseguros", () => {
  assert.deepEqual(parseBuildChanges('{"summary":"ok","changes":[{"path":"src/main.ts","content":"ok"}]}'), {
    ok: true, changes: [{ path: "src/main.ts", content: "ok" }], summary: "ok",
  });
  for (const path of ["../outside", "/etc/passwd", ".axiom-secrets.json", "node_modules/pkg/a.js", "src\\..\\bad"]) {
    assert.equal(parseBuildChanges(JSON.stringify({ changes: [{ path, content: "x" }] })).ok, false, `should reject ${path}`);
  }
  assert.equal(parseBuildChanges("Here is some code").ok, false);
});

test("Build no aplica sin confirmar, y reemplazar necesita permiso explícito", () => {
  const root = tempDir("axiom-build-approval-");
  try {
    session(root, "s-test");
    const saved = guardarBuildPropuesta(root, "s-test", [{ path: "src/App.tsx", content: "export default 1;" }]);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(existsSync(join(root, "src/App.tsx")), false);
    assert.equal(aplicarBuildPropuesta(root, saved.id, false).ok, true);
    assert.equal(readFileSync(join(root, "src/App.tsx"), "utf8"), "export default 1;");
    assert.equal(aplicarBuildPropuesta(root, saved.id, false).ok, false);
    const replacement = guardarBuildPropuesta(root, "s-test", [{ path: "src/App.tsx", content: "export default 2;" }]);
    assert.equal(replacement.ok, true);
    if (!replacement.ok) return;
    assert.equal(aplicarBuildPropuesta(root, replacement.id, false).ok, false);
    assert.equal(readFileSync(join(root, "src/App.tsx"), "utf8"), "export default 1;");
    assert.equal(aplicarBuildPropuesta(root, replacement.id, true).ok, true);
    assert.equal(readFileSync(join(root, "src/App.tsx"), "utf8"), "export default 2;");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Build revalida enlaces simbólicos agregados después de guardar la propuesta", () => {
  const root = tempDir("axiom-build-symlink-");
  const outside = tempDir("axiom-build-outside-");
  try {
    session(root, "s-test");
    writeFileSync(join(outside, "keep.txt"), "no tocar");
    const proposal = guardarBuildPropuesta(root, "s-test", [{ path: "safe/new.ts", content: "ok" }]);
    assert.equal(proposal.ok, true);
    if (!proposal.ok) return;
    assert.equal(obtenerBuildPropuesta(root, proposal.id).ok, true);
    symlinkSync(outside, join(root, "safe"), "dir");
    assert.equal(obtenerBuildPropuesta(root, proposal.id).ok, false);
    assert.equal(aplicarBuildPropuesta(root, proposal.id, true).ok, false);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "no tocar");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("el chat API se niega a crear sesiones sin un proyecto inicializado", async () => {
  const root = tempDir("axiom-no-project-");
  const server = startWeb(root, 0);
  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: server.port, path: "/api/chat/sesiones", method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ modo: "build" }));
    });
    assert.equal(response.status, 409);
    assert.match(response.body, /No hay ningún proyecto activo/);
    assert.equal(existsSync(join(root, "axiom.db")), false);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("crear proyecto genera el esqueleto esperado y deja listo el store persistente", () => {
  const parent = tempDir("axiom-project-create-");
  try {
    const created = crearProyecto(parent, "dashboard");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(existsSync(join(created.path, "axiom.json")), true);
    assert.equal(existsSync(join(created.path, "axiom.db")), true);
    assert.equal(existsSync(join(created.path, "specs/active")), true);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
