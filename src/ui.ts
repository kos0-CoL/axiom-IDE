// A4 — TUI mínima: 2 vistas mismo store SQLite + consola broker
import { getConsumo, listTrazas, listUsos, openDb, type TrazaLeida } from "./store.js";
import { loadPolicies } from "./policy.js";
import { asegurarColumnaArchivos } from "./staging.js";

export function renderOrquestacion(root: string): string {
  const db = openDb(root);
  const tasks: any[] = db.prepare("SELECT estado, COUNT(*) c FROM tasks GROUP BY estado").all();
  const aprob: any[] = (() => {
    try { return db.prepare("SELECT id, tool, riesgo, estado FROM aprobaciones ORDER BY created_at DESC LIMIT 5").all(); }
    catch { return []; }
  })();
  const { global } = loadPolicies(root);
  db.close();
  const out: string[] = [];
  out.push("+-- AXIOM ORQUESTACIÓN ----------------------------------+");
  out.push(`techo rondas=${global.techo.rondas} tokens=${global.techo.tokens} calls=${global.techo.calls}`);
  out.push(`tareas: ${tasks.map((t: any) => `${t.estado}=${t.c}`).join(" ") || "0"}`);
  out.push(`usos: ${listUsos(root, 5).map((u) => `+${u.total}tok(${u.fuente})`).join(" ") || "(sin spawns)"}`);
  out.push("aprobaciones recientes:");
  for (const a of aprob as any[]) out.push(`  [${a.estado}] ${a.id} ${a.tool} riesgo=${a.riesgo}`);
  if ((aprob as any[]).length === 0) out.push("  (vacío)");
  return out.join("\n");
}

export interface AprobacionView { id: string; tool: string; riesgo: string; estado: string; created_at: string; decided_by: string; decided_at: string; agente: string }

// JSON para la web: mismas consultas que el texto (criterio UI-SPEC 5: sin divergencia).
export interface UsoView { prompt: number; respuesta: number; total: number; fuente: string; created_at: string }
export function datosOrquestacion(root: string): { techo: { rondas: number; tokens: number; calls: number }; consumo: { tokens: number; calls: number }; usos: UsoView[]; tareas: { estado: string; n: number }[]; aprobaciones: AprobacionView[] } {
  const db = openDb(root);
  const tasks = db.prepare("SELECT estado, COUNT(*) c FROM tasks GROUP BY estado").all() as any[];
  // `agente` identifica a quién se le pidió la herramienta; en bases anteriores
  // a esa columna se degrada a la consulta sin ella en vez de perder las filas.
  let aprob: any[] = [];
  for (const sql of [
    "SELECT id, tool, riesgo, estado, created_at, decided_by, decided_at, agente FROM aprobaciones ORDER BY created_at DESC LIMIT 20",
    "SELECT id, tool, riesgo, estado, created_at FROM aprobaciones ORDER BY created_at DESC LIMIT 20",
  ]) {
    try { aprob = db.prepare(sql).all() as any[]; break; } catch { /* columna ausente en base vieja */ }
  }
  const { global } = loadPolicies(root);
  db.close();
  const consumo = getConsumo(root);
  const usos = (() => { try { return listUsos(root, 8); } catch { return []; } })();
  return {
    techo: global.techo, consumo, usos,
    tareas: tasks.map((t) => ({ estado: t.estado, n: t.c })),
    aprobaciones: aprob.map((a) => ({ id: a.id, tool: a.tool, riesgo: a.riesgo, estado: a.estado, created_at: a.created_at ?? "", decided_by: a.decided_by ?? "", decided_at: a.decided_at ?? "", agente: a.agente ?? "" })),
  };
}

export function datosTrabajo(root: string): { specs: { id: string; ver: string; title: string; status: string; tareas: { id: string; ver: string; estado: string; archivos: number }[] }[] } {
  asegurarColumnaArchivos(root);
  const db = openDb(root);
  const specs = db.prepare("SELECT id, ver, title, status FROM specs").all() as any[];
  const tasks = db.prepare("SELECT id, spec_id, spec_ver, estado FROM tasks ORDER BY id LIMIT 100").all() as any[];
  const evs = db.prepare("SELECT task_id, archivos FROM evidences").all() as any[];
  db.close();
  const nArch = (id: string): number => {
    const e = evs.find((x) => x.task_id === id);
    return typeof e?.archivos === "string" && e.archivos ? e.archivos.split("\n").length : 0;
  };
  return {
    specs: specs.map((s) => ({
      id: s.id, ver: s.ver, title: s.title, status: s.status,
      tareas: tasks.filter((t) => t.spec_id === s.id).map((t) => ({ id: t.id, ver: t.spec_ver, estado: t.estado, archivos: nArch(t.id) })),
    })),
  };
}

export function renderTrabajo(root: string): string {
  asegurarColumnaArchivos(root);
  const db = openDb(root);
  const specs: any[] = db.prepare("SELECT id, ver, title, status FROM specs").all();
  const tasks: any[] = db.prepare("SELECT id, spec_id, spec_ver, estado FROM tasks ORDER BY id LIMIT 20").all();
  let evs: any[] = [];
  try { evs = db.prepare("SELECT task_id, archivos FROM evidences").all() as any[]; } catch { evs = []; }
  db.close();
  const out: string[] = [];
  out.push("+-- AXIOM TRABAJO ----------------------------------------+");
  for (const s of specs as any[]) {
    out.push(`[SPEC ${s.id}:${s.ver}] ${s.title} (${s.status})`);
    for (const t of (tasks as any[]).filter((x: any) => x.spec_id === s.id)) {
      const mark = t.estado === "bloqueado" ? "/// BLOQUEADO" : t.estado === "verificado" ? "[VERIFICADO]" : `[${t.estado}]`;
      const e = evs.find((x: any) => x.task_id === t.id);
      const n = typeof e?.archivos === "string" && e.archivos ? e.archivos.split("\n").length : 0;
      out.push(`  ${mark} ${t.id} spec=${t.spec_ver} archivos=${n}`);
    }
  }
  if ((specs as any[]).length === 0) out.push("  (sin specs; corre axiom spec)");
  out.push("Sin evidencia no hay verde. Verificación = cmd+salida+hash.");
  return out.join("\n");
}

// JSON para la web: mismas filas que `axiom status --trace` (AXM-066),
// ordenadas de más reciente a más antigua. El formato de línea lo aplica
// web.ts con lineaTraza, la misma función de la CLI: sin divergencia.
export function datosTrazas(root: string, contexto?: string, limite = 50): TrazaLeida[] {
  return listTrazas(root, limite, contexto || undefined);
}
