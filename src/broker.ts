import { createHash } from "node:crypto";
import { openDb } from "./store.js";
import { effectiveAllow } from "./policy.js";
import { ToolContract } from "./contracts.js";

export type Decision = "allow" | "deny" | "ask";

// Lo que el agente que usa la herramienta declara en agents.config.json.
// `acceso` = declaración vigente (cota superior, nunca concede por sí sola).
// `error` = no se pudo verificar (agente inexistente, config rota, herramienta
// no declarada): fail closed.
export type DeclaracionAgente =
  | { id: string; tool: string; acceso: Decision }
  | { id: string; error: string };

export interface Veredicto {
  decision: Decision;
  riesgo: string;
  motivo: string;
}

// Retícula de autorización: la decisión más estricta gana.
// deny > ask > allow, tanto entre políticas como entre política y agente.
const PESO: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

function masEstricta(a: Decision, b: Decision): Decision {
  return PESO[a] >= PESO[b] ? a : b;
}

// Decisión efectiva = política (global ∧ proyecto) ∧ declaración del agente.
// Si no hay agente en juego (p. ej. un check manual sin `--agente`) la decisión
// es la de la política: la dimensión del agente solo puede restringir.
function componer(base: Veredicto, agente?: DeclaracionAgente): Veredicto {
  if (!agente) return base;
  if ("error" in agente) {
    return {
      decision: "deny",
      riesgo: base.riesgo,
      motivo: `${base.motivo}; agente ${agente.id}: ${agente.error} → deny (fail closed)`,
    };
  }
  return {
    decision: masEstricta(base.decision, agente.acceso),
    riesgo: base.riesgo,
    motivo: `${base.motivo}; agente ${agente.id} declara ${agente.tool}=${agente.acceso}`,
  };
}

// Tabla de aprobaciones: `agente` recuerda quién pidió la herramienta para
// revalidar su declaración al decidir. `usada_at` marca cuándo se consumió una
// aprobación concedida (autoriza un solo uso). ALTER best-effort para bases ya creadas.
function prepararTabla(db: ReturnType<typeof openDb>): void {
  db.exec("CREATE TABLE IF NOT EXISTS aprobaciones(id TEXT PRIMARY KEY, tool TEXT, riesgo TEXT, estado TEXT, created_at TEXT, decided_by TEXT, decided_at TEXT, agente TEXT, usada_at TEXT)");
  for (const col of ["decided_by TEXT", "decided_at TEXT", "agente TEXT", "usada_at TEXT"]) {
    try { db.exec(`ALTER TABLE aprobaciones ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }
}

// Ventana de validez de una aprobación: la misma que `decide` usa para expirar
// una solicitud pendiente. Una concesión vieja no desbloquea una corrida de hoy.
const VIGENCIA_MIN = 30;

// Consume una aprobación ya concedida para (tool, agente): autoriza UN uso. El
// runner la toma antes de ejecutar; sin esto, aprobar no desbloquearía nada,
// porque cada check abre una solicitud nueva. Devuelve la aprobación consumida o
// undefined (no había, la tomó otro proceso o está fuera de vigencia).
export function consumirAprobacion(root: string, tool: string, agente: string): { id: string } | undefined {
  const db = openDb(root);
  try {
    prepararTabla(db);
    const desde = new Date(Date.now() - VIGENCIA_MIN * 60000).toISOString();
    const row = db
      .prepare("SELECT id FROM aprobaciones WHERE tool=? AND agente=? AND estado='aprobada' AND decided_at>=? ORDER BY decided_at ASC LIMIT 1")
      .get(tool, agente, desde) as { id?: string } | undefined;
    if (!row?.id) return undefined;
    // CAS sobre el estado: si dos procesos compiten, solo uno la consume.
    const marca = db.prepare("UPDATE aprobaciones SET estado='usada', usada_at=? WHERE id=? AND estado='aprobada'").run(new Date().toISOString(), row.id);
    return Number(marca.changes ?? 0) > 0 ? { id: row.id } : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

// Qué herramienta (y qué agente, si lo hubo) originó una aprobación.
export function datosAprobacion(root: string, id: string): { tool: string; agente?: string } | undefined {
  const db = openDb(root);
  try {
    prepararTabla(db);
    const row = db.prepare("SELECT tool, agente FROM aprobaciones WHERE id=?").get(id) as { tool?: string; agente?: string | null } | undefined;
    if (!row?.tool) return undefined;
    return { tool: row.tool, agente: row.agente ?? undefined };
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

// `estado` es cómo quedó la fila, que no es lo mismo que `ok`: rechazar es una
// decisión tomada (`ok: false`, estado `rechazada`), mientras que denegar por
// política o agente o llegar tarde es el broker negándose (`denegada-*`, `expirada`).
// `aplicada` dice si esta llamada escribió el estado final (false = ya estaba
// decidida o no existe), para que la web no pinte en verde una fila que no tocó.
export interface DecideResult { ok: boolean; msg: string; estado: string; aplicada: boolean }

export function decide(
  root: string,
  id: string,
  aprueba: boolean,
  quien?: string,
  expiraMin = 30,
  agente?: DeclaracionAgente,
): DecideResult {
  const db = openDb(root);
  prepararTabla(db);
  const row = db.prepare("SELECT * FROM aprobaciones WHERE id=?").get(id) as any;
  if (!row) { db.close(); return { ok: false, msg: `aprobación ${id} no existe`, estado: "no-existe", aplicada: false }; }
  const cerrar = (estado: string, msg: string): DecideResult => {
    db.prepare("UPDATE aprobaciones SET estado=?, decided_by=?, decided_at=? WHERE id=?").run(estado, quien ?? "sistema", new Date().toISOString(), id);
    db.close();
    return { ok: false, msg, estado, aplicada: true };
  };
  const ageMin = (Date.now() - new Date(row.created_at).getTime()) / 60000;
  if (ageMin > expiraMin) return cerrar("expirada", `aprobación ${id} expirada (>${expiraMin}min) = deny`);
  if (row.estado !== "pendiente") { db.close(); return { ok: false, msg: `aprobación ${id} ya ${row.estado}`, estado: String(row.estado), aplicada: false }; }
  // Rechazar no concede nada: la fila se cierra como `rechazada` con el humano que
  // la rechazó, sin revalidar cotas (revalidar solo puede convertir un rechazo en
  // una denegación del broker y falsear la auditoría). Aprobar sí revalida: manda
  // la política y la declaración vigentes, no las del momento de la solicitud.
  if (aprueba) {
    const r = effectiveAllow(root, row.tool);
    if (r.decision === "deny") return cerrar("denegada-por-politica", `denegada por política vigente: ${r.motivo}`);
    // Segunda cota: el agente que la pidió debe seguir declarándola. Un `ask`
    // del agente es justo lo que esta decisión humana resuelve; `deny` no.
    if (row.agente) {
      if (!agente) return cerrar("denegada-sin-agente", `aprobación ${id}: el agente ${row.agente} no está declarado (fail closed)`);
      if ("error" in agente) return cerrar("denegada-por-agente", `aprobación ${id}: agente ${row.agente} → ${agente.error} (fail closed)`);
      if (agente.id !== row.agente) return cerrar("denegada-por-agente", `aprobación ${id}: la declaración de ${agente.id} no corresponde a ${row.agente} (fail closed)`);
      if (agente.acceso === "deny") return cerrar("denegada-por-agente", `aprobación ${id}: el agente ${agente.id} declara ${agente.tool}=deny`);
    }
  }
  db.prepare("UPDATE aprobaciones SET estado=?, decided_by=?, decided_at=? WHERE id=?").run(aprueba ? "aprobada" : "rechazada", quien ?? "sistema", new Date().toISOString(), id);
  db.close();
  const cota = row.agente ? `, agente ${row.agente}` : "";
  return { ok: aprueba, msg: `${id} ${aprueba ? "aprobada" : "rechazada"} (${row.tool}, riesgo ${row.riesgo}${cota})`, estado: aprueba ? "aprobada" : "rechazada", aplicada: true };
}

export function check(
  root: string,
  toolName: string,
  tool?: ToolContract,
  agente?: DeclaracionAgente,
): Veredicto & { id?: string } {
  const r = componer(effectiveAllow(root, toolName, tool), agente);
  if (r.decision === "ask") {
    // Una solicitud pendiente vigente para la misma (herramienta, agente) se
    // reutiliza: reintentar una corrida bloqueada no debe llenar Aprobaciones de
    // duplicados ni invalidar el id que el usuario ya está mirando.
    try {
      const db = openDb(root);
      prepararTabla(db);
      const desde = new Date(Date.now() - VIGENCIA_MIN * 60000).toISOString();
      const previa = db
        .prepare("SELECT id FROM aprobaciones WHERE tool=? AND agente IS ? AND estado='pendiente' AND created_at>=? ORDER BY created_at ASC LIMIT 1")
        .get(toolName, agente?.id ?? null, desde) as { id?: string } | undefined;
      if (previa?.id) { db.close(); return { ...r, id: previa.id }; }
      const id = createHash("sha256").update(`${toolName}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
      // audita solicitud en SQLite (tabla aprobaciones best-effort)
      db.prepare("INSERT INTO aprobaciones(id,tool,riesgo,estado,created_at,agente) VALUES(?,?,?,?,?,?)").run(
        id,
        toolName,
        r.riesgo,
        "pendiente",
        new Date().toISOString(),
        agente?.id ?? null,
      );
      db.close();
      return { ...r, id };
    } catch { /* best effort: se devuelve la decisión sin id */ }
  }
  return r;
}
