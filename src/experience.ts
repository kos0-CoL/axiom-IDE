// experience.ts (Fase 2 — harness con memoria, de harness2 EXPERIENCE.md).
// Memoria persistente del harness: qué del harness ayudó/estorbo por verify,
// + propuestas de ajuste revisables en Plan con gate humano (sin auto-aplicar).
// Solo importa store.js (boundary) + fs/crypto/path.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./store.js";

export const EXPERIENCE_FILE = "EXPERIENCE.md";

const HEADER = `# EXPERIENCE — memoria del harness

> Una lección por verify (pass/fail/error-juez): qué del harness ayudó o estorbó.
> El harness = agentes + instrucciones + skills + aristas (agents.config.json).
> Las propuestas de ajuste se revisan en Plan y las aplica un humano
> (\`agents define\` / \`agents link\`); aquí nunca se auto-aplica nada.

`;

export function asegurarExperience(root: string): void {
  const p = join(root, EXPERIENCE_FILE);
  if (!existsSync(p)) writeFileSync(p, HEADER);
}

function huellaHarness(root: string): string {
  try {
    const raw = existsSync(join(root, "agents.config.json")) ? readFileSync(join(root, "agents.config.json"), "utf8") : "(ausente)";
    return createHash("sha256").update(raw).digest("hex").slice(0, 8);
  } catch {
    return "(ilegible)";
  }
}

export function resumenHarness(root: string): string {
  try {
    const raw = readFileSync(join(root, "agents.config.json"), "utf8");
    const g = JSON.parse(raw) as { agentes?: { id?: unknown; rol?: unknown; skills?: unknown[] }[]; aristas?: { de?: unknown; a?: unknown; tipo?: unknown }[] };
    const ag = Array.isArray(g?.agentes) ? g.agentes : [];
    const ar = Array.isArray(g?.aristas) ? g.aristas : [];
    const ids = ag.map((a) => `${String(a.id ?? "?")}:${String(a.rol ?? "?")}`).join(", ") || "sin agentes";
    const ari = ar.map((e) => `${String(e.de ?? "?")}—${String(e.tipo ?? "?")}→${String(e.a ?? "?")}`).join("; ") || "sin aristas";
    return `${ag.length} agentes (${ids}) · ${ar.length} aristas (${ari}) · fp ${huellaHarness(root)}`;
  } catch {
    return `harness por defecto (sin agents.config.json) · fp ${huellaHarness(root)}`;
  }
}

// Una lección por verify. Nunca rompe el verify: el llamador la envuelve en try/catch.
export function registrarLeccion(root: string, taskId: string, verdict: string, juez = "humano", detalle?: string): void {
  asegurarExperience(root);
  const d = (detalle ?? "").trim().slice(0, 300);
  const linea = `## ${new Date().toISOString()} — ${taskId} → ${verdict} (juez=${juez})\n\n- harness: ${resumenHarness(root)}\n- ayuda/estorba: ${d || "sin nota (usa --detalle para decir qué del harness ayudó o estorbó)"}\n`;
  const p = join(root, EXPERIENCE_FILE);
  const prev = readFileSync(p, "utf8");
  writeFileSync(p, (prev.endsWith("\n") ? prev : prev + "\n") + "\n" + linea);
}

export function textoExperiencia(root: string, limit = 5): string {
  asegurarExperience(root);
  const n = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 5;
  const raw = readFileSync(join(root, EXPERIENCE_FILE), "utf8");
  const partes = raw.split(/^## /m).filter((s) => s.trim() && !s.startsWith("# EXPERIENCE"));
  if (!partes.length) return "sin lecciones todavía: haz un `verify` con --detalle para registrar la primera";
  return partes
    .slice(-n)
    .map((s) => "## " + s.trim())
    .join("\n\n---\n\n");
}

function tablaPropuestas(root: string): void {
  const db = openDb(root);
  db.exec(
    "CREATE TABLE IF NOT EXISTS harness_propuestas(id TEXT PRIMARY KEY, task_id TEXT, verdict TEXT, propuesta TEXT, estado TEXT, created_at TEXT, decided_at TEXT)",
  );
  db.close();
}

function ultimoVeredicto(root: string, taskId: string): string {
  try {
    const db = openDb(root);
    const ev = db.prepare("SELECT verdict FROM evidences WHERE task_id=? ORDER BY rowid DESC LIMIT 1").get(taskId) as { verdict?: string } | undefined;
    const t = db.prepare("SELECT estado FROM tasks WHERE id=?").get(taskId) as { estado?: string } | undefined;
    db.close();
    return ev?.verdict ?? t?.estado ?? "desconocido";
  } catch {
    return "desconocido";
  }
}

// Propone un ajuste del harness en formato Plan (pasos numerados, revisable).
// No aplica nada: el humano aplica con `agents define/link` y luego aprueba la propuesta.
export function proponerAjuste(root: string, taskId?: string): string {
  if (!taskId?.trim()) return "uso: axiom agents proponer <task-id>";
  const id = taskId.trim().slice(0, 128);
  tablaPropuestas(root);
  const db = openDb(root);
  const t = db.prepare("SELECT id FROM tasks WHERE id=?").get(id) as { id?: string } | undefined;
  db.close();
  if (!t) return `tarea inexistente: ${id}`;
  const verdict = ultimoVeredicto(root, id);
  const harness = resumenHarness(root);
  const pid = `hp-${Date.now().toString(36).slice(-6)}`;
  const ahora = new Date().toISOString();
  const cuerpo =
    verdict === "pass" || verdict === "verificado"
      ? `Conservar el harness que produjo ${id} (${verdict}).\n1) No cambiar agentes ni aristas: el harness actual funcionó.\n2) Documentar qué ayudó con \`verify --detalle\` para la próxima lección.\n3) Si se quiere endurecer, añadir un skill de review al nodo que verificó, nunca quitar permisos.`
      : `Revisar el harness tras ${id} (${verdict}).\n1) Leer la última lección de EXPERIENCE.md y el trace de la tarea.\n2) Concretar instrucciones del agente que hizo la tarea (qué le faltó: contexto, formato, criterio de fin).\n3) Añadir skill review/evidence al verificador y comprobar la arista de delegación.\n4) Aplicar a mano (\`agents define <id> instrucciones ...\` / \`agents link ...\`) y re-verificar.`;
  const propuesta = `Plan de ajuste del harness tras verify ${id} → ${verdict}\nHarness actual: ${harness}\n${cuerpo}`;
  const db2 = openDb(root);
  db2.prepare("INSERT INTO harness_propuestas(id,task_id,verdict,propuesta,estado,created_at,decided_at) VALUES(?,?,?,?,?,?,?)").run(pid, id, verdict, propuesta, "propuesta", ahora, "");
  db2.close();
  return `${pid} propuesto tras ${id} (${verdict}). Revísalo en Plan y aplícalo a mano; luego \`axiom agents aprobar-propuesta ${pid}\` (o rechazar-propuesta).`;
}

export interface PropuestaRow {
  id: string;
  task_id: string;
  verdict: string;
  estado: string;
  created_at: string;
}

export function listarPropuestas(root: string, soloPendientes = true, limit = 10): PropuestaRow[] {
  tablaPropuestas(root);
  const n = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 10;
  const db = openDb(root);
  const rows = (soloPendientes
    ? db.prepare("SELECT id,task_id,verdict,estado,created_at FROM harness_propuestas WHERE estado='propuesta' ORDER BY created_at DESC LIMIT ?").all(n)
    : db.prepare("SELECT id,task_id,verdict,estado,created_at FROM harness_propuestas ORDER BY created_at DESC LIMIT ?").all(n)) as unknown as PropuestaRow[];
  db.close();
  return rows;
}

export function textoPropuestas(root: string): string {
  const rows = listarPropuestas(root, false, 20);
  if (!rows.length) return "sin propuestas de harness: usa `axiom agents proponer <task-id>` tras un verify";
  return rows.map((r) => `- ${r.id} [${r.estado}] ${r.task_id} → ${r.verdict} (${r.created_at}): revísala con \`axiom agents ver-propuesta ${r.id}\``).join("\n");
}

export function verPropuesta(root: string, id?: string): string {
  if (!id?.trim()) return "uso: axiom agents ver-propuesta <id>";
  tablaPropuestas(root);
  const db = openDb(root);
  const r = db.prepare("SELECT propuesta,estado FROM harness_propuestas WHERE id=?").get(id.trim()) as { propuesta?: string; estado?: string } | undefined;
  db.close();
  if (!r) return `propuesta inexistente: ${id.trim()}`;
  return `[${r.estado}]\n${r.propuesta ?? ""}`;
}

export function decidirPropuesta(root: string, id?: string, ok?: boolean): string {
  if (!id?.trim()) return ok ? "uso: axiom agents aprobar-propuesta <id>" : "uso: axiom agents rechazar-propuesta <id>";
  tablaPropuestas(root);
  const pid = id.trim();
  const db = openDb(root);
  const r = db.prepare("SELECT estado FROM harness_propuestas WHERE id=?").get(pid) as { estado?: string } | undefined;
  if (!r) { db.close(); return `propuesta inexistente: ${pid}`; }
  if (r.estado !== "propuesta") { db.close(); return `propuesta ${pid} ya ${r.estado}`; }
  db.prepare("UPDATE harness_propuestas SET estado=?, decided_at=? WHERE id=?").run(ok ? "aprobada" : "rechazada", new Date().toISOString(), pid);
  db.close();
  return ok
    ? `${pid} aprobada: aplica el plan a mano (agents define/link) — aquí no se auto-aplicó nada`
    : `${pid} rechazada: se conserva el harness actual`;
}
