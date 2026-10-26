import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../dist/store.js";
import { guardarMensaje, crearSesion, borrarSesion, listarSesiones, mensajesDe } from "../dist/sessions.js";

function raiz(): string {
  return mkdtempSync(join(tmpdir(), "ax-cascada-"));
}

function nuevaS(root: string): string {
  const r = crearSesion(root);
  if (!r.ok) throw new Error("seed sesión");
  return r.sesion.id;
}

function sembrarSpec(db: ReturnType<typeof openDb>, sesion: string, specId: string): void {
  db.prepare("INSERT INTO plan_propuestas(id,session_id,texto,estado,created_at,decided_at) VALUES(?,?,?,?,?,?)")
    .run("pp-" + specId, sesion, "plan", "aprobada", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT INTO plan_artifacts(proposal_id,spec_id) VALUES(?,?)").run("pp-" + specId, specId);
  db.prepare("INSERT INTO specs(id,ver,title,path,status) VALUES(?,?,?,?,?)").run(specId, "v1", specId, `specs/active/${specId}/spec.md`, "draft");
  db.prepare("INSERT INTO tasks(id,spec_id,spec_ver,title,scenario,estado,owner) VALUES(?,?,?,?,?,?,?)").run("t-" + specId, specId, "v1", "tarea", "esc", "pendiente", "nodo");
}

test("borrarSesion borra en cascada mensajes, sesión, propuestas, artifacts, specs, tasks y carpetas en disco", () => {
  const root = raiz();
  try {
    const db = openDb(root);
    const s = nuevaS(root);
    guardarMensaje(root, s, "usuario", "hola");
    guardarMensaje(root, s, "sistema", "reenviado");
    guardarMensaje(root, s, "sistema", "respuesta final");
    sembrarSpec(db, s, "prueba-cascada-uno");
    sembrarSpec(db, s, "prueba-cascada-dos");
    // spec de otra sesión: debe sobrevivir
    const otra = nuevaS(root);
    sembrarSpec(db, otra, "prueba-cascada-otra");
    // carpetas en disco para las dos specs de la sesión borrada
    const d1 = join(root, "specs", "active", "prueba-cascada-uno");
    const d2 = join(root, "specs", "active", "prueba-cascada-dos");
    mkdirSync(d1, { recursive: true }); mkdirSync(d2, { recursive: true }); mkdirSync(join(root, "specs", "active", "prueba-cascada-otra"), { recursive: true });
    for (const d of [d1, d2, join(root, "specs", "active", "prueba-cascada-otra")]) {
      writeFileSync(join(d, "spec.md"), "# spec");
      writeFileSync(join(d, "plan.md"), "# plan");
    }
    db.close();

    const r = borrarSesion(root, s);
    assert.ok(r.ok, "el borrado debe ser ok");
    assert.equal(r.ok && r.specs.sort().join(","), "prueba-cascada-dos,prueba-cascada-uno");

    const db2 = openDb(root);
    assert.equal((db2.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=?").get(s) as { c: number }).c, 0, "mensajes de la sesión");
    assert.equal(db2.prepare("SELECT id FROM chat_sessions WHERE id=?").get(s), undefined, "sesión");
    assert.equal((db2.prepare("SELECT COUNT(*) c FROM plan_propuestas WHERE session_id=?").get(s) as { c: number }).c, 0, "propuestas de la sesión");
    assert.equal((db2.prepare("SELECT COUNT(*) c FROM plan_artifacts WHERE spec_id IN ('prueba-cascada-uno','prueba-cascada-dos')").get() as { c: number }).c, 0, "artifacts de las specs borradas");
    assert.equal((db2.prepare("SELECT COUNT(*) c FROM specs WHERE id LIKE 'prueba-cascada-uno'").get() as { c: number }).c, 0, "spec uno");
    assert.equal((db2.prepare("SELECT COUNT(*) c FROM tasks WHERE spec_id LIKE 'prueba-cascada-uno'").get() as { c: number }).c, 0, "tasks de la spec uno");
    db2.close();

    assert.equal(existsSync(d1) && existsSync(join(d1, "spec.md")), false, "carpeta uno en disco");
    assert.equal(existsSync(d2), false, "carpeta dos en disco");
    assert.ok(existsSync(join(root, "specs", "active", "prueba-cascada-otra", "spec.md")), "la spec de otra sesión sobrevive");

    const l = listarSesiones(root);
    assert.ok(l.ok, "listar ok");
    const ids = l.ok ? l.sesiones.filter((x) => x.id === s).length : -1;
    assert.equal(ids, 0, "la sesión ya no aparece listada");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("borrarSesion: inexistente falla honesto y sin borrar nada", () => {
  const root = raiz();
  try {
    const r = borrarSesion(root, "s-no-existe");
    assert.ok(!r.ok);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("borrarSesion sin propuestas (sesión solo bits) también borra limpia y no toca specs de nadie", () => {
  const root = raiz();
  try {
    const s = nuevaS(root);
    guardarMensaje(root, s, "usuario", "solo pregunta");
    const r = borrarSesion(root, s);
    assert.ok(r.ok, "borrado ok");
    assert.equal(r.ok ? r.specs.length : -1, 0, "sin specs asociadas");
    assert.ok(existsSync(join(root, "axiom.db")), "la db queda operativa");
    const m = mensajesDe(root, s);
    assert.ok(!m.ok, "la sesión borrada ya no sirve mensajes (sin huérfanos)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
