// Memoria entre sesiones (ADR-0005): estrategia por capas. Estos tests fijan
// las reglas — la auditoría NUNCA se poda, EXPERIENCE.md y sesiones archivadas
// solo se compactan de forma explícita, el olvido queda anotado en el propio
// archivo y dry-run no escribe nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactarMemoria, estadoMemoria, registrarLeccion, textoExperiencia, EXPERIENCE_FILE } from "../dist/experience.js";
import { openDb, recordTraza } from "../dist/store.js";

function raiz(): string {
  return mkdtempSync(join(tmpdir(), "axiom-memoria-"));
}

function sembrarChat(root: string): void {
  const db = openDb(root);
  db.prepare("INSERT INTO chat_sessions(id,titulo,archivada) VALUES(?,?,1)").run("s-arch", "archivada");
  db.prepare("INSERT INTO chat_sessions(id,titulo,archivada) VALUES(?,?,0)").run("s-act", "activa");
  const msg = db.prepare("INSERT INTO chat_messages(session_id,rol,texto) VALUES(?,?,?)");
  for (let i = 0; i < 5; i++) msg.run("s-arch", "usuario", `viejo ${i}`);
  for (let i = 0; i < 3; i++) msg.run("s-act", "usuario", `activo ${i}`);
  db.close();
}

test("estadoMemoria enumera capas: retención conocida y auditoría intacta", () => {
  const root = raiz();
  try {
    const e = estadoMemoria(root);
    assert.match(e, /EXPERIENCE\.md: \d+ B · \d+ lección/);
    assert.match(e, /retención automática: uso_log≤50 · trace_log≤500/);
    assert.match(e, /auditoría \(nunca se poda\): evidences, trace_log, handoff_log, bloqueos, aprobaciones/);
    assert.match(e, /accionable: axiom memory compact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact poda EXPERIENCE.md a las últimas N lecciones y anota la poda", () => {
  const root = raiz();
  try {
    for (let i = 0; i < 60; i++) registrarLeccion(root, `t-${i}`, "pass", "humano", `nota ${i}`);
    const ruta = join(root, EXPERIENCE_FILE);
    const contar = (): number => (readFileSync(ruta, "utf8").match(/^## /gm) ?? []).length;
    assert.equal(contar(), 60);

    // dry-run: calcula pero no escribe
    const dry = compactarMemoria(root, { keepLecciones: 10, dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.lecciones.podadas, 50);
    assert.equal(contar(), 60, "dry-run no toca el archivo");

    // compact real: quedan 10 lecciones (las más recientes) + nota de poda
    const r = compactarMemoria(root, { keepLecciones: 10 });
    assert.equal(r.lecciones.antes, 60);
    assert.equal(r.lecciones.despues, 10);
    assert.equal(r.lecciones.podadas, 50);
    const txt = readFileSync(ruta, "utf8");
    assert.equal(contar(), 10);
    assert.match(txt, /Última poda: .*50 lección\(es\) anterior\(es\) eliminadas \(keep=10\)/, "el olvido queda registrado");
    assert.ok(txt.startsWith("# EXPERIENCE"), "el encabezado se conserva");
    assert.ok(txt.includes("nota 59"), "se conservan las lecciones más recientes");
    assert.ok(!txt.includes("nota 0"), "las más viejas se van");
    // La lectura sigue funcionando tras la poda.
    assert.match(textoExperiencia(root, 3), /nota 59/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact solo poda mensajes de sesiones ARCHIVADAS, nunca las activas", () => {
  const root = raiz();
  try {
    sembrarChat(root);
    const cuenta = (db: ReturnType<typeof openDb>, s: string): number =>
      ((db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=?").get(s) as { c: number }).c);

    const dry = compactarMemoria(root, { keepMensajes: 2, dryRun: true });
    assert.equal(dry.mensajes.podados, 3, "dry-run solo calcula");

    const r = compactarMemoria(root, { keepMensajes: 2 });
    assert.equal(r.mensajes.podados, 3);
    assert.equal(r.mensajes.sesiones, 1, "solo la sesión archivada");
    const db = openDb(root);
    try {
      assert.equal(cuenta(db, "s-arch"), 2, "archivada: quedan los últimos 2");
      assert.equal(cuenta(db, "s-act"), 3, "activa: intacta");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("la auditoría sobrevive a cualquier compactación", () => {
  const root = raiz();
  try {
    const db = openDb(root);
    db.prepare("INSERT INTO evidences(task_id,cmd,exit,sha256,verdict,created_at) VALUES(?,?,?,?,?,?)")
      .run("t1", "axiom verify t1 pass", 0, "abc", "pass", new Date().toISOString());
    db.close();
    recordTraza(root, { origen: "cli", tool: "read", decision: "allow" });

    compactarMemoria(root, { keepLecciones: 1, keepMensajes: 1 });

    const db2 = openDb(root);
    const ev = (db2.prepare("SELECT COUNT(*) c FROM evidences").get() as { c: number }).c;
    const tz = (db2.prepare("SELECT COUNT(*) c FROM trace_log").get() as { c: number }).c;
    db2.close();
    assert.equal(ev, 1, "evidences intacta");
    assert.equal(tz, 1, "trace_log intacta");
    assert.match(compactarMemoria(root).vacuum, /ok|sin cambios|no disponible/, "vacuum informa estado, no lanza");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
