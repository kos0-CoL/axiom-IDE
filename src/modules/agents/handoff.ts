// Handoff entre agentes (F8): contrato propio y chico, autorizado por el broker.
// El subagente recibe solo contexto permitido + presupuesto; sin ejecución real aún:
// el handoff queda auditado y el avance lo hace el agente/usuario.
import { openDb } from "../../store.js";
import { check } from "../../broker.js";
import { loadAgents } from "./config.js";
import { declaracionDeHerramienta } from "./declaracion.js";
import type { ToolContract } from "../../contracts.js";

// Exportado: el runner autoriza sus propias delegaciones con el mismo contrato de
// riesgo que el handoff manual, para que el broker decida igual en ambos caminos.
export const DELEGA_CONTRACT: ToolContract = {
  name: "delega",
  description: "Transfiere una tarea de un agente a otro (solo contexto permitido + presupuesto).",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export interface Handoff {
  id: number;
  de: string;
  a: string;
  tarea: string;
  decision: string;
  approval_id: string;
  created_at: string;
}

function tabla(root: string): void {
  const db = openDb(root);
  db.exec(
    "CREATE TABLE IF NOT EXISTS handoff_log(id INTEGER PRIMARY KEY AUTOINCREMENT, de TEXT, a TEXT, tarea TEXT, decision TEXT, approval_id TEXT DEFAULT '', created_at TEXT)",
  );
  db.close();
}

export function handoff(root: string, de?: string, a?: string, tarea?: string): string {
  if (!de || !a || !tarea?.trim()) return "uso: axiom agents handoff <de> <a> <tarea...>";
  const t = tarea.trim().slice(0, 2000);
  if (!t) return "uso: axiom agents handoff <de> <a> <tarea...>";
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  const porId = new Map(r.config.agentes.map((x) => [x.id, x]));
  const o = porId.get(de);
  const d = porId.get(a);
  if (!o) return `agente inexistente: ${de}`;
  if (!d) return `agente inexistente: ${a}`;
  if (o.estado !== "activo") return `${de} no está activo (${o.estado})`;
  if (d.estado !== "activo") return `${a} no está activo (${d.estado})`;
  const arista = r.config.aristas.find((e) => e.de === de && e.a === a && (e.tipo === "delega" || e.tipo === "escala"));
  if (!arista) return `sin arista de delegación ${de} → ${a} (usa \`agents link ${de} ${a} delega\`)`;
  // Quien delega es el agente `de`: la herramienta se autoriza con SU
  // declaración, no solo con la política del proyecto.
  const c = check(root, "delega", DELEGA_CONTRACT, declaracionDeHerramienta(root, de, "delega"), { origen: "handoff", entrada: { de, a, tarea: t }, contexto: t });
  tabla(root);
  const db = openDb(root);
  if (c.decision === "deny") {
    db.prepare("INSERT INTO handoff_log(de,a,tarea,decision,approval_id,created_at) VALUES(?,?,?,?,?,?)").run(de, a, t, "denegada", "", new Date().toISOString());
    db.close();
    return `handoff denegado: ${c.motivo}`;
  }
  if (c.decision === "ask") {
    db.prepare("INSERT INTO handoff_log(de,a,tarea,decision,approval_id,created_at) VALUES(?,?,?,?,?,?)").run(de, a, t, "pendiente", c.id ?? "", new Date().toISOString());
    db.close();
    return `handoff pendiente de aprobación: ${c.id} (${c.motivo}) — aprueba con \`axiom approve ${c.id}\``;
  }
  db.prepare("INSERT INTO handoff_log(de,a,tarea,decision,approval_id,created_at) VALUES(?,?,?,?,?,?)").run(de, a, t, "aprobada", "", new Date().toISOString());
  db.close();
  return `handoff ${de} → ${a} registrado (aprobado: ${c.motivo}). El subagente recibe solo contexto permitido + presupuesto; el avance lo hace el agente/usuario.`;
}

export function listarHandoffs(root: string, limit = 20): Handoff[] {
  tabla(root);
  const db = openDb(root);
  const n = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
  const rows = db.prepare("SELECT id,de,a,tarea,decision,approval_id,created_at FROM handoff_log ORDER BY id DESC LIMIT ?").all(n) as unknown as Handoff[];
  db.close();
  return rows;
}

export function textoHandoffs(root: string): string {
  const l = listarHandoffs(root);
  if (!l.length) return "sin handoffs";
  return l.map((h) => `#${h.id} ${h.de} → ${h.a} [${h.decision}]${h.approval_id ? ` aprobación ${h.approval_id}` : ""}: ${h.tarea.slice(0, 80)}`).join("\n");
}
