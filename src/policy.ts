import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ToolContract, riskOf } from "./contracts.js";

export interface Techo { rondas: number; tokens: number; calls: number }
export interface GlobalPolicy { tools: Record<string, boolean>; techo: Techo }
export interface ProjectPolicy { tools: Record<string, boolean>; presupuesto: { tokens: number; calls: number } }

export function loadJson<T>(p: string, fallback: T): T {
  try { if (!existsSync(p)) return fallback; return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; }
}

export function loadPolicies(root: string): { global: GlobalPolicy; project: ProjectPolicy } {
  const global = loadJson<GlobalPolicy>(join(root, "policies.global.json"), { tools: {}, techo: { rondas: 3, tokens: 100000, calls: 500 } });
  const project = loadJson<ProjectPolicy>(join(root, "project.json"), { tools: {}, presupuesto: { tokens: 50000, calls: 200 } });
  return { global, project };
}

// allow efectivo = allow_global AND allow_project (ausencia = deny por defecto salvo lectura bajo riesgo)
export function effectiveAllow(root: string, toolName: string, tool?: ToolContract): { decision: "allow" | "deny" | "ask"; riesgo: "bajo" | "medio" | "alto"; motivo: string } {
  const { global, project } = loadPolicies(root);
  const g = global.tools[toolName];
  const p = project.tools[toolName];
  // riesgo por anotación o por nombre conocido
  let riesgo: "bajo" | "medio" | "alto" = "medio";
  if (tool) riesgo = riskOf(tool);
  else if (toolName === "terminal" || toolName === "publish" || toolName === "network") riesgo = "alto";
  else if (toolName === "read" || toolName === "status" || toolName === "validate-spec") riesgo = "bajo";

  if (g === false) return { decision: "deny", riesgo, motivo: `global.tools.${toolName}=false (no eludible)` };
  if (riesgo === "alto") return { decision: g === true && p !== false ? "ask" : "deny", riesgo, motivo: "riesgo alto exige aprobación humana" };
  if (riesgo === "medio") {
    if (g === true && p === true) return { decision: "allow", riesgo, motivo: "global+proyecto permiten" };
    if (g === true && p === undefined) return { decision: "ask", riesgo, motivo: "proyecto no define, se pregunta" };
    return { decision: "deny", riesgo, motivo: "sin permiso explícito global+proyecto" };
  }
  // bajo (g===false ya retornó deny arriba)
  return { decision: "allow", riesgo, motivo: "riesgo bajo auto" };
}

export function checkTecho(root: string, rondas = 1, intentos = 1, paralelismo = 1): { ok: boolean; motivo: string } {
  const { global } = loadPolicies(root);
  const techo = global.techo.rondas;
  const producto = rondas * intentos * paralelismo;
  if (producto > techo * 3) return { ok: false, motivo: `techo agregado excedido: ${rondas}x${intentos}x${paralelismo}=${producto} > ${techo * 3}` };
  // reserva 20% verificación: lee consumo y bloquea nueva unidad si no hay margen
  try {
    const db = new DatabaseSync(join(root, "axiom.db"));
    const row = db.prepare("SELECT tokens, calls FROM consumo WHERE unit='global'").get() as { tokens: number; calls: number } | undefined;
    db.close();
    if (row && row.tokens >= global.techo.tokens * 0.8) return { ok: false, motivo: "sin reserva 20% para verificación" };
  } catch { /* sin consumo aún */ }
  return { ok: true, motivo: `dentro de techo ${producto}<=${techo * 3}` };
}

const cycleSeen = new Map<string, number>();
export function cicloImproductivo(key: string, root?: string): { esCiclo: boolean; veces: number } {
  if (root) {
    // persistente entre procesos vía SQLite para que el CLI detecte ciclos reales
    try {
      const db = new DatabaseSync(join(root, "axiom.db"));
      db.exec("CREATE TABLE IF NOT EXISTS ciclos(key TEXT PRIMARY KEY, veces INTEGER)");
      const row = db.prepare("SELECT veces FROM ciclos WHERE key=?").get(key) as { veces: number } | undefined;
      const v = (row?.veces ?? 0) + 1;
      db.prepare("INSERT OR REPLACE INTO ciclos(key,veces) VALUES(?,?)").run(key, v);
      db.close();
      return { esCiclo: v >= 3, veces: v };
    } catch { /* fallback memoria */ }
  }
  const v = (cycleSeen.get(key) ?? 0) + 1;
  cycleSeen.set(key, v);
  return { esCiclo: v >= 3, veces: v };
}
export function resetCiclos(): void { cycleSeen.clear(); }
