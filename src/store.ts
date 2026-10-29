import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS specs(id TEXT, ver TEXT, title TEXT, path TEXT, status TEXT, PRIMARY KEY(id, ver));
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, spec_id TEXT, spec_ver TEXT, title TEXT, scenario TEXT, estado TEXT, owner TEXT);
CREATE TABLE IF NOT EXISTS evidences(task_id TEXT, cmd TEXT, exit INTEGER, sha256 TEXT, verdict TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS consumo(unit TEXT PRIMARY KEY, tokens INTEGER, calls INTEGER, costo REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS bloqueos(id TEXT PRIMARY KEY, task_id TEXT, causa TEXT);
CREATE TABLE IF NOT EXISTS uso_log(id INTEGER PRIMARY KEY AUTOINCREMENT, prompt INTEGER, respuesta INTEGER, total INTEGER, fuente TEXT, proveedor TEXT NOT NULL DEFAULT '', modelo TEXT NOT NULL DEFAULT '', cache_lectura INTEGER NOT NULL DEFAULT 0, cache_escritura INTEGER NOT NULL DEFAULT 0, costo_usd REAL, created_at TEXT);
CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY, titulo TEXT, modo TEXT, archivada INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, rol TEXT, texto TEXT, proveedor TEXT, model TEXT, skill TEXT, ms INTEGER, tokens INTEGER NOT NULL DEFAULT 0, costo_usd REAL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
CREATE TABLE IF NOT EXISTS plan_propuestas(id TEXT PRIMARY KEY, session_id TEXT, texto TEXT, estado TEXT, created_at TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS build_proposals(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, changes_json TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_artifacts(proposal_id TEXT PRIMARY KEY, spec_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trace_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, origen TEXT, tool TEXT, agente TEXT DEFAULT '', decision TEXT, riesgo TEXT DEFAULT '', motivo TEXT DEFAULT '', approval_id TEXT DEFAULT '', entrada TEXT DEFAULT '', salida TEXT DEFAULT '', sha_io TEXT DEFAULT '', contexto TEXT DEFAULT '', turno_id TEXT NOT NULL DEFAULT '', ok INTEGER DEFAULT 1, ms INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS turnos(id TEXT PRIMARY KEY, run_id TEXT NOT NULL DEFAULT '', sesion_id TEXT NOT NULL DEFAULT '', mensaje_usuario_id INTEGER, mensaje_id INTEGER, agente TEXT NOT NULL DEFAULT '', proveedor TEXT NOT NULL DEFAULT '', modelo TEXT NOT NULL DEFAULT '', prompt_sha TEXT NOT NULL DEFAULT '', tokens INTEGER NOT NULL DEFAULT 0, cache_lectura INTEGER NOT NULL DEFAULT 0, cache_escritura INTEGER NOT NULL DEFAULT 0, costo_usd REAL, llamadas INTEGER NOT NULL DEFAULT 0, herramientas INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, error TEXT NOT NULL DEFAULT '', ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_turnos_created ON turnos(created_at);
`;

// Migración idempotente por columna: una DB vieja gana la columna y una nueva no
// toca nada. `ALTER TABLE` falla si dos procesos migran a la vez, así que el
// segundo intento se ignora (la columna ya está).
function asegurarColumna(db: DatabaseSync, tabla: string, columna: string, ddl: string): void {
  try { db.prepare(`SELECT ${columna} FROM ${tabla} LIMIT 1`).get(); return; } catch { /* falta */ }
  try { db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`); } catch { /* la agregó otro proceso */ }
}

export function openDb(projectRoot: string): DatabaseSync {
  mkdirSync(projectRoot, { recursive: true });
  const db = new DatabaseSync(join(projectRoot, "axiom.db"));
  db.exec(SCHEMA_V1);
  db.prepare("INSERT OR IGNORE INTO meta(k,v) VALUES('schema','1')").run();
  // DBs creadas antes de estas columnas: tokens/costo del chat y desglose de uso.
  asegurarColumna(db, "chat_messages", "tokens", "tokens INTEGER NOT NULL DEFAULT 0");
  asegurarColumna(db, "chat_messages", "costo_usd", "costo_usd REAL");
  asegurarColumna(db, "uso_log", "proveedor", "proveedor TEXT NOT NULL DEFAULT ''");
  asegurarColumna(db, "uso_log", "modelo", "modelo TEXT NOT NULL DEFAULT ''");
  asegurarColumna(db, "uso_log", "cache_lectura", "cache_lectura INTEGER NOT NULL DEFAULT 0");
  asegurarColumna(db, "uso_log", "cache_escritura", "cache_escritura INTEGER NOT NULL DEFAULT 0");
  asegurarColumna(db, "uso_log", "costo_usd", "costo_usd REAL");
  asegurarColumna(db, "consumo", "costo", "costo REAL NOT NULL DEFAULT 0");
  asegurarColumna(db, "trace_log", "turno_id", "turno_id TEXT NOT NULL DEFAULT ''");
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

// Ingesta real de consumo: acumula tokens/calls/costo por unidad (reserva 20% la lee policy.checkTecho).
// `costo` es acumulado y no se re-deriva: un cambio de `pricing.json` no reescribe
// lo que ya se gastó, por eso la fila guarda el costo del momento.
export function addConsumo(projectRoot: string, tokens: number, calls: number, unit = "global", costoUsd = 0): { tokens: number; calls: number; costo: number } {
  const db = openDb(projectRoot);
  const row = db.prepare("SELECT tokens, calls, costo FROM consumo WHERE unit=?").get(unit) as { tokens: number; calls: number; costo: number } | undefined;
  const next = { tokens: (row?.tokens ?? 0) + tokens, calls: (row?.calls ?? 0) + calls, costo: Math.round(((row?.costo ?? 0) + costoUsd) * 1e9) / 1e9 };
  db.prepare("INSERT OR REPLACE INTO consumo(unit,tokens,calls,costo) VALUES(?,?,?,?)").run(unit, next.tokens, next.calls, next.costo);
  db.close();
  return next;
}

export function getConsumo(projectRoot: string, unit = "global"): { tokens: number; calls: number; costo: number } {
  const db = openDb(projectRoot);
  const row = db.prepare("SELECT tokens, calls, costo FROM consumo WHERE unit=?").get(unit) as { tokens: number; calls: number; costo: number } | undefined;
  db.close();
  return { tokens: row?.tokens ?? 0, calls: row?.calls ?? 0, costo: row?.costo ?? 0 };
}

export interface UsoRegistrado {
  prompt: number; respuesta: number; total: number; fuente: string; created_at: string;
  proveedor: string; modelo: string; cache_lectura: number; cache_escritura: number; costo_usd: number | null;
}

/** Uso de una llamada, tal como lo produce `spawn` (con cache y costo cuando hay). */
export interface UsoEntrante {
  prompt: number; respuesta: number; total: number; fuente: string;
  proveedor?: string; model?: string; cacheLectura?: number; cacheEscritura?: number; costoUsd?: number;
}

// Cada spawn con uso (medido o estimado) deja una fila; se conservan las últimas 50.
export function recordUso(projectRoot: string, uso: UsoEntrante): void {
  const db = openDb(projectRoot);
  db.prepare("INSERT INTO uso_log(prompt,respuesta,total,fuente,proveedor,modelo,cache_lectura,cache_escritura,costo_usd,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    uso.prompt, uso.respuesta, uso.total, uso.fuente,
    (uso.proveedor ?? "").slice(0, 40), (uso.model ?? "").slice(0, 120),
    Math.max(0, Math.round(uso.cacheLectura ?? 0)), Math.max(0, Math.round(uso.cacheEscritura ?? 0)),
    typeof uso.costoUsd === "number" && Number.isFinite(uso.costoUsd) ? uso.costoUsd : null,
    new Date().toISOString(),
  );
  db.prepare("DELETE FROM uso_log WHERE id NOT IN (SELECT id FROM uso_log ORDER BY id DESC LIMIT 50)").run();
  db.close();
}

export function listUsos(projectRoot: string, limit = 8): UsoRegistrado[] {
  const db = openDb(projectRoot);
  const rows = db.prepare("SELECT prompt, respuesta, total, fuente, proveedor, modelo, cache_lectura, cache_escritura, costo_usd, created_at FROM uso_log ORDER BY id DESC LIMIT ?").all(limit) as unknown as UsoRegistrado[];
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

// --- Traza de tool calls (AXM-066) ---
// Cada llamada a herramienta deja una fila: qué tool, quién la pidió, qué
// decidió el broker y un resumen ACOTADO del IO junto al sha256 del IO
// completo (trazable byte a byte sin guardar basura). Best-effort por diseño:
// una traza que no se escribe jamás rompe la llamada que la produjo.

export interface TrazaTool {
  origen: string; // cli | web | run | telegram | handoff
  tool: string;
  agente?: string;
  decision: string;
  riesgo?: string;
  motivo?: string;
  approvalId?: string;
  entrada?: unknown;
  salida?: unknown;
  contexto?: string; // p. ej. "run <spec>/<tarea>" para vincularla a una tarea
  /** Turno que produjo la llamada: une mensaje, modelo, herramienta y respuesta. */
  turnoId?: string;
  ok?: boolean;
  ms?: number;
}

export interface TrazaLeida {
  id: number; ts: string; origen: string; tool: string; agente: string;
  decision: string; riesgo: string; motivo: string; approval_id: string;
  entrada: string; salida: string; sha_io: string; contexto: string; turno_id: string;
  ok: number; ms: number;
}

const LIMITE_IO = 500; // caracteres por resumen de IO
const LIMITE_TRAZAS = 500; // retención: como uso_log, se conservan las más recientes

function acotar(txt: string): string {
  return txt.length > LIMITE_IO ? txt.slice(0, LIMITE_IO) + `…(+${txt.length - LIMITE_IO} B)` : txt;
}

function textoIO(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v) ?? ""; } catch { return String(v); }
}

export function recordTraza(projectRoot: string, t: TrazaTool): void {
  try {
    const entrada = textoIO(t.entrada);
    const salida = textoIO(t.salida);
    const sha = createHash("sha256").update(`${entrada}\n${salida}`).digest("hex");
    const db = openDb(projectRoot);
    db.prepare(
      "INSERT INTO trace_log(ts,origen,tool,agente,decision,riesgo,motivo,approval_id,entrada,salida,sha_io,contexto,turno_id,ok,ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      new Date().toISOString(), t.origen, t.tool, t.agente ?? "", t.decision,
      t.riesgo ?? "", (t.motivo ?? "").slice(0, 300), t.approvalId ?? "",
      acotar(entrada), acotar(salida), sha, t.contexto ?? "", t.turnoId ?? "",
      t.ok === false ? 0 : 1, Math.max(0, Math.round(t.ms ?? 0)),
    );
    db.prepare("DELETE FROM trace_log WHERE id NOT IN (SELECT id FROM trace_log ORDER BY id DESC LIMIT ?)").run(LIMITE_TRAZAS);
    db.close();
  } catch { /* la traza nunca rompe la llamada */ }
}

// Últimas trazas, opcionalmente las de una tarea (contexto LIKE, p. ej.
// "run demo/T1"). Devuelve [] si la base no existe o no se puede leer.
export function listTrazas(projectRoot: string, limit = 20, contexto?: string): TrazaLeida[] {
  try {
    const db = openDb(projectRoot);
    const rows = (contexto
      ? db.prepare("SELECT * FROM trace_log WHERE contexto LIKE ? ORDER BY id DESC LIMIT ?").all(`%${contexto}%`, limit)
      : db.prepare("SELECT * FROM trace_log ORDER BY id DESC LIMIT ?").all(limit)) as unknown as TrazaLeida[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

// --- Turnos: la unidad que une mensaje, modelo, herramientas y respuesta ---
// `trace_log` dice qué hizo cada herramienta; `turnos` dice a qué pedido
// pertenece. Sin esta fila, el `contexto` es texto libre y la cadena se arma con
// coincidencias de string, que se rompen con cualquier cambio de formato.

export interface Turno {
  id: string;
  runId?: string;
  sesionId?: string;
  /** Id del mensaje de usuario que originó el turno. */
  mensajeUsuarioId?: number;
  /** Id del mensaje de asistente con la respuesta final. */
  mensajeId?: number;
  agente?: string;
  proveedor?: string;
  model?: string;
  /** sha256 del prompt efectivo (no se guarda el prompt entero). */
  promptSha?: string;
  tokens?: number;
  cacheLectura?: number;
  cacheEscritura?: number;
  costoUsd?: number;
  /** Turnos de LLM consumidos dentro de este turno. */
  llamadas?: number;
  herramientas?: number;
  ok?: boolean;
  error?: string;
  ms?: number;
}

export interface TurnoLeido {
  id: string; run_id: string; sesion_id: string;
  mensaje_usuario_id: number | null; mensaje_id: number | null;
  agente: string; proveedor: string; modelo: string; prompt_sha: string;
  tokens: number; cache_lectura: number; cache_escritura: number; costo_usd: number | null;
  llamadas: number; herramientas: number; ok: number; error: string; ms: number; created_at: string;
}

export function nuevoTurnoId(): string {
  return `t-${randomUUID().slice(0, 8)}`;
}

/** Best-effort: un turno sin fila nunca rompe la respuesta que lo produjo. */
export function recordTurno(projectRoot: string, t: Turno): void {
  try {
    const db = openDb(projectRoot);
    db.prepare(
      "INSERT OR REPLACE INTO turnos(id,run_id,sesion_id,mensaje_usuario_id,mensaje_id,agente,proveedor,modelo,prompt_sha,tokens,cache_lectura,cache_escritura,costo_usd,llamadas,herramientas,ok,error,ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      t.id, t.runId ?? "", t.sesionId ?? "",
      t.mensajeUsuarioId ?? null, t.mensajeId ?? null,
      (t.agente ?? "").slice(0, 64), (t.proveedor ?? "").slice(0, 40), (t.model ?? "").slice(0, 120),
      (t.promptSha ?? "").slice(0, 64),
      Math.max(0, Math.round(t.tokens ?? 0)), Math.max(0, Math.round(t.cacheLectura ?? 0)),
      Math.max(0, Math.round(t.cacheEscritura ?? 0)),
      typeof t.costoUsd === "number" && Number.isFinite(t.costoUsd) ? t.costoUsd : null,
      Math.max(0, Math.round(t.llamadas ?? 0)), Math.max(0, Math.round(t.herramientas ?? 0)),
      t.ok === false ? 0 : 1, (t.error ?? "").slice(0, 300), Math.max(0, Math.round(t.ms ?? 0)),
      new Date().toISOString(),
    );
    // Retención: 500 turnos, la misma escala que trace_log.
    db.prepare("DELETE FROM turnos WHERE id NOT IN (SELECT id FROM turnos ORDER BY created_at DESC, rowid DESC LIMIT 500)").run();
    db.close();
  } catch { /* la contabilidad del turno no rompe la respuesta */ }
}

export function listTurnos(projectRoot: string, limit = 10): TurnoLeido[] {
  try {
    const db = openDb(projectRoot);
    const rows = db.prepare("SELECT * FROM turnos ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as unknown as TurnoLeido[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

/** Trazas de un turno: la cadena herramienta por herramienta, sin matching de texto. */
export function trazasDeTurno(projectRoot: string, turnoId: string, limit = 50): TrazaLeida[] {
  try {
    const db = openDb(projectRoot);
    const rows = db.prepare("SELECT * FROM trace_log WHERE turno_id=? ORDER BY id ASC LIMIT ?").all(turnoId, limit) as unknown as TrazaLeida[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

export { dirname };
