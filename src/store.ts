import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS specs(id TEXT, ver TEXT, title TEXT, path TEXT, status TEXT, PRIMARY KEY(id, ver));
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, spec_id TEXT, spec_ver TEXT, title TEXT, scenario TEXT, estado TEXT, owner TEXT);
CREATE TABLE IF NOT EXISTS evidences(task_id TEXT, cmd TEXT, exit INTEGER, sha256 TEXT, verdict TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS consumo(unit TEXT PRIMARY KEY, tokens INTEGER, calls INTEGER);
CREATE TABLE IF NOT EXISTS bloqueos(id TEXT PRIMARY KEY, task_id TEXT, causa TEXT);
CREATE TABLE IF NOT EXISTS uso_log(id INTEGER PRIMARY KEY AUTOINCREMENT, prompt INTEGER, respuesta INTEGER, total INTEGER, fuente TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY, titulo TEXT, modo TEXT, archivada INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, rol TEXT, texto TEXT, proveedor TEXT, model TEXT, skill TEXT, ms INTEGER, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
CREATE TABLE IF NOT EXISTS plan_propuestas(id TEXT PRIMARY KEY, session_id TEXT, texto TEXT, estado TEXT, created_at TEXT, decided_at TEXT);
`;

export function openDb(projectRoot: string): DatabaseSync {
  mkdirSync(projectRoot, { recursive: true });
  const db = new DatabaseSync(join(projectRoot, "axiom.db"));
  db.exec(SCHEMA_V1);
  db.prepare("INSERT OR IGNORE INTO meta(k,v) VALUES('schema','1')").run();
  return db;
}

export function dbPath(projectRoot: string): string {
  return join(projectRoot, "axiom.db");
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

export function storeDir(projectRoot: string): string {
  return projectRoot;
}

// Ingesta real de consumo: acumula tokens/calls por unidad (reserva 20% la lee policy.checkTecho).
export function addConsumo(projectRoot: string, tokens: number, calls: number, unit = "global"): { tokens: number; calls: number } {
  const db = openDb(projectRoot);
  const row = db.prepare("SELECT tokens, calls FROM consumo WHERE unit=?").get(unit) as { tokens: number; calls: number } | undefined;
  const next = { tokens: (row?.tokens ?? 0) + tokens, calls: (row?.calls ?? 0) + calls };
  db.prepare("INSERT OR REPLACE INTO consumo(unit,tokens,calls) VALUES(?,?,?)").run(unit, next.tokens, next.calls);
  db.close();
  return next;
}

export function getConsumo(projectRoot: string, unit = "global"): { tokens: number; calls: number } {
  const db = openDb(projectRoot);
  const row = db.prepare("SELECT tokens, calls FROM consumo WHERE unit=?").get(unit) as { tokens: number; calls: number } | undefined;
  db.close();
  return { tokens: row?.tokens ?? 0, calls: row?.calls ?? 0 };
}

export interface UsoRegistrado { prompt: number; respuesta: number; total: number; fuente: string; created_at: string }

// Cada spawn con uso (medido o estimado) deja una fila; se conservan las últimas 50.
export function recordUso(projectRoot: string, uso: { prompt: number; respuesta: number; total: number; fuente: string }): void {
  const db = openDb(projectRoot);
  db.prepare("INSERT INTO uso_log(prompt,respuesta,total,fuente,created_at) VALUES(?,?,?,?,?)").run(uso.prompt, uso.respuesta, uso.total, uso.fuente, new Date().toISOString());
  db.prepare("DELETE FROM uso_log WHERE id NOT IN (SELECT id FROM uso_log ORDER BY id DESC LIMIT 50)").run();
  db.close();
}

export function listUsos(projectRoot: string, limit = 8): UsoRegistrado[] {
  const db = openDb(projectRoot);
  const rows = db.prepare("SELECT prompt, respuesta, total, fuente, created_at FROM uso_log ORDER BY id DESC LIMIT ?").all(limit) as unknown as UsoRegistrado[];
  db.close();
  return rows;
}

// Bloqueos reales: verify fail registra causa; rechazar en Telegram puede añadir dependientes después.
export function recordBloqueo(projectRoot: string, taskId: string, causa: string): void {
  const db = openDb(projectRoot);
  const id = `${taskId}:${Date.now()}`;
  db.prepare("INSERT OR IGNORE INTO bloqueos(id,task_id,causa) VALUES(?,?,?)").run(id, taskId, causa);
  db.close();
}

export function listBloqueos(projectRoot: string, limit = 20): { id: string; task_id: string; causa: string }[] {
  const db = openDb(projectRoot);
  const rows = db.prepare("SELECT id, task_id, causa FROM bloqueos ORDER BY id DESC LIMIT ?").all(limit) as { id: string; task_id: string; causa: string }[];
  db.close();
  return rows;
}

export { dirname };
