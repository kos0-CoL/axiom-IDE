import { createHash } from "node:crypto";
import { openDb } from "./store.js";
import { effectiveAllow } from "./policy.js";
import { ToolContract } from "./contracts.js";

export type Decision = "allow" | "deny" | "ask";

export function decide(root: string, id: string, aprueba: boolean, quien?: string, expiraMin = 30): { ok: boolean; msg: string } {
  const db = openDb(root);
  db.exec("CREATE TABLE IF NOT EXISTS aprobaciones(id TEXT PRIMARY KEY, tool TEXT, riesgo TEXT, estado TEXT, created_at TEXT, decided_by TEXT, decided_at TEXT)");
  try { db.exec("ALTER TABLE aprobaciones ADD COLUMN decided_by TEXT"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE aprobaciones ADD COLUMN decided_at TEXT"); } catch { /* ya existe */ }
  const row = db.prepare("SELECT * FROM aprobaciones WHERE id=?").get(id) as any;
  if (!row) { db.close(); return { ok: false, msg: `aprobación ${id} no existe` }; }
  const ageMin = (Date.now() - new Date(row.created_at).getTime()) / 60000;
  if (ageMin > expiraMin) {
    db.prepare("UPDATE aprobaciones SET estado='expirada', decided_by=?, decided_at=? WHERE id=?").run(quien ?? "sistema", new Date().toISOString(), id);
    db.close();
    return { ok: false, msg: `aprobación ${id} expirada (>${expiraMin}min) = deny` };
  }
  if (row.estado !== "pendiente") { db.close(); return { ok: false, msg: `aprobación ${id} ya ${row.estado}` }; }
  // revalida política vigente al momento de decidir (no la de solicitud)
  const r = effectiveAllow(root, row.tool);
  if (r.decision === "deny") {
    db.prepare("UPDATE aprobaciones SET estado='denegada-por-politica', decided_by=?, decided_at=? WHERE id=?").run(quien ?? "sistema", new Date().toISOString(), id);
    db.close();
    return { ok: false, msg: `denegada por política vigente: ${r.motivo}` };
  }
  db.prepare("UPDATE aprobaciones SET estado=?, decided_by=?, decided_at=? WHERE id=?").run(aprueba ? "aprobada" : "rechazada", quien ?? "sistema", new Date().toISOString(), id);
  db.close();
  return { ok: aprueba, msg: `${id} ${aprueba ? "aprobada" : "rechazada"} (${row.tool}, riesgo ${row.riesgo})` };
}

export function check(root: string, toolName: string, tool?: ToolContract): { decision: Decision; riesgo: string; motivo: string; id?: string } {
  const r = effectiveAllow(root, toolName, tool);
  if (r.decision === "ask") {
    const id = createHash("sha256").update(`${toolName}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
    // audita solicitud en SQLite (tabla aprobaciones best-effort)
    try {
      const db = openDb(root);
      db.exec("CREATE TABLE IF NOT EXISTS aprobaciones(id TEXT PRIMARY KEY, tool TEXT, riesgo TEXT, estado TEXT, created_at TEXT, decided_by TEXT, decided_at TEXT)");
      db.prepare("INSERT INTO aprobaciones(id,tool,riesgo,estado,created_at) VALUES(?,?,?,?,?)").run(id, toolName, r.riesgo, "pendiente", new Date().toISOString());
      db.close();
    } catch { /* best effort */ }
    return { ...r, id };
  }
  return r;
}
