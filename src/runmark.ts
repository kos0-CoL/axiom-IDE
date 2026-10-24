// Runmark (F9, de harness2 runmark.py): huella de la config + marca de ejecución.
// Reanudar con otra configuración se rehúsa: restaura la config o usa un id nuevo.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./store.js";

const HUELLA_FILES = ["policies.global.json", "project.json", "adapters.config.json", "agents.config.json"];

export function huellaConfig(root: string): string {
  const h = createHash("sha256");
  for (const f of HUELLA_FILES) {
    let contenido: string;
    try {
      contenido = existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : "(ausente)";
    } catch {
      contenido = "(ilegible)";
    }
    h.update(`${f}=${contenido};`);
  }
  return h.digest("hex").slice(0, 16);
}

export interface MarcaRun {
  fingerprint: string;
  rondas: number;
  created_at: string;
}

export interface SnapshotHarness {
  fingerprint: string;
  harness: string;
  created_at: string;
}

function tabla(root: string): void {
  const db = openDb(root);
  db.exec("CREATE TABLE IF NOT EXISTS run_mark(run_id TEXT PRIMARY KEY, fingerprint TEXT, rondas INTEGER, created_at TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS harness_snapshot(run_id TEXT PRIMARY KEY, fingerprint TEXT, harness TEXT, created_at TEXT)");
  db.close();
}

// Snapshot del harness usado por el run: agents.config.json tal cual (tope 8k).
// Vive aquí (no en agents/) para no romper boundaries: runmark solo lee store + fs.
function leerHarnessRaw(root: string): string {
  try {
    const p = join(root, "agents.config.json");
    if (!existsSync(p)) return "(defecto sin guardar)";
    return readFileSync(p, "utf8").slice(0, 8000);
  } catch {
    return "(ilegible)";
  }
}

export function leerMarca(root: string, runId: string): MarcaRun | undefined {
  tabla(root);
  const db = openDb(root);
  const r = db.prepare("SELECT fingerprint, rondas, created_at FROM run_mark WHERE run_id=?").get(runId) as MarcaRun | undefined;
  db.close();
  return r;
}

export function marcarRun(root: string, runId: string, rondas: number): MarcaRun {
  tabla(root);
  const m: MarcaRun = { fingerprint: huellaConfig(root), rondas, created_at: new Date().toISOString() };
  const db = openDb(root);
  db.prepare("INSERT OR REPLACE INTO run_mark(run_id,fingerprint,rondas,created_at) VALUES(?,?,?,?)").run(runId, m.fingerprint, m.rondas, m.created_at);
  db.prepare("INSERT OR REPLACE INTO harness_snapshot(run_id,fingerprint,harness,created_at) VALUES(?,?,?,?)").run(runId, m.fingerprint, leerHarnessRaw(root), m.created_at);
  db.close();
  return m;
}

export function leerSnapshot(root: string, runId: string): SnapshotHarness | undefined {
  tabla(root);
  const db = openDb(root);
  const r = db.prepare("SELECT fingerprint, harness, created_at FROM harness_snapshot WHERE run_id=?").get(runId) as SnapshotHarness | undefined;
  db.close();
  return r;
}

export interface UltimoSnapshot extends SnapshotHarness {
  run_id: string;
}

export function ultimoSnapshot(root: string): UltimoSnapshot | undefined {
  tabla(root);
  const db = openDb(root);
  const r = db.prepare("SELECT run_id, fingerprint, harness, created_at FROM harness_snapshot ORDER BY created_at DESC LIMIT 1").get() as UltimoSnapshot | undefined;
  db.close();
  return r;
}

export function textoSnapshot(root: string, runId: string): string {
  if (!runId?.trim()) return "uso: axiom agents snapshot <run-id>";
  const s = leerSnapshot(root, runId.trim());
  if (!s) return `sin snapshot para ${runId.trim()} (corre \`axiom run ${runId.trim()}\` primero)`;
  return `harness usado por ${runId.trim()} (fp ${s.fingerprint}, ${s.created_at}):\n${s.harness}`;
}
