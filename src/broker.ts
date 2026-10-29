import { createHash } from "node:crypto";
import { openDb, recordTraza } from "./store.js";
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
// aprobación concedida (autoriza un solo uso) y `usada_por` qué corrida la gastó:
// sin ese dato, «usada» en la vista es un estado sin explicación.
// ALTER best-effort para bases ya creadas.
function prepararTabla(db: ReturnType<typeof openDb>): void {
  db.exec("CREATE TABLE IF NOT EXISTS aprobaciones(id TEXT PRIMARY KEY, tool TEXT, riesgo TEXT, estado TEXT, created_at TEXT, decided_by TEXT, decided_at TEXT, agente TEXT, usada_at TEXT, usada_por TEXT, devuelta_at TEXT, devuelta_por TEXT)");
  for (const col of ["decided_by TEXT", "decided_at TEXT", "agente TEXT", "usada_at TEXT", "usada_por TEXT", "devuelta_at TEXT", "devuelta_por TEXT"]) {
    try { db.exec(`ALTER TABLE aprobaciones ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }
}

// Ventana de validez de una aprobación: la misma que `decide` usa para expirar
// una solicitud pendiente. Una concesión vieja no desbloquea una corrida de hoy.
const VIGENCIA_MIN = 30;

// Consume una aprobación ya concedida para (tool, agente): autoriza UN uso. El
// runner la toma antes de ejecutar; sin esto, aprobar no desbloquearía nada,
// porque cada check abre una solicitud nueva. `por` deja escrito qué corrida la
// gastó, que es lo que la vista necesita para explicar el estado `usada`.
// Devuelve la aprobación consumida o undefined (no había, la tomó otro proceso o
// está fuera de vigencia).
export function consumirAprobacion(root: string, tool: string, agente: string, por = "", turnoId = ""): { id: string } | undefined {
  const db = openDb(root);
  try {
    prepararTabla(db);
    const desde = new Date(Date.now() - VIGENCIA_MIN * 60000).toISOString();
    const row = db
      .prepare("SELECT id FROM aprobaciones WHERE tool=? AND agente=? AND estado='aprobada' AND decided_at>=? ORDER BY decided_at ASC LIMIT 1")
      .get(tool, agente, desde) as { id?: string } | undefined;
    if (!row?.id) return undefined;
    // CAS sobre el estado: si dos procesos compiten, solo uno la consume.
    const marca = db.prepare("UPDATE aprobaciones SET estado='usada', usada_at=?, usada_por=? WHERE id=? AND estado='aprobada'").run(new Date().toISOString(), por, row.id);
    const consumida = Number(marca.changes ?? 0) > 0;
    // Traza del uso real (AXM-066): la aprobación consumida ES la tool call
    // autorizada; sin esta fila, `status --trace` vería la solicitud pero no el uso.
    if (consumida) {
      recordTraza(root, {
        origen: "run", tool, agente, decision: "allow",
        motivo: `aprobación ${row.id} consumida por ${agente}:${tool}`,
        approvalId: row.id, entrada: { tool, agente, por }, salida: { consumida: true },
        contexto: por, turnoId, ok: true,
      });
    }
    return consumida ? { id: row.id } : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

// Consume una aprobación ya concedida SIN agente en la fila: es el espejo de
// consumirAprobacion para tool calls manuales (CLI o web, p. ej. las acciones
// del módulo browser, ADR-0006) — filas con agente NULL. Mismo CAS de un solo
// uso y misma ventana de vigencia que la del runner. El texto de la traza deja
// escrito qué uso la gastó (AXM-066).
export function consumirAprobacionManual(root: string, tool: string, contexto = "", origen = "cli"): { id: string } | undefined {
  const db = openDb(root);
  try {
    prepararTabla(db);
    const desde = new Date(Date.now() - VIGENCIA_MIN * 60000).toISOString();
    const row = db
      .prepare("SELECT id FROM aprobaciones WHERE tool=? AND agente IS NULL AND estado='aprobada' AND decided_at>=? ORDER BY decided_at ASC LIMIT 1")
      .get(tool, desde) as { id?: string } | undefined;
    if (!row?.id) return undefined;
    const marca = db.prepare("UPDATE aprobaciones SET estado='usada', usada_at=?, usada_por=? WHERE id=? AND estado='aprobada'").run(new Date().toISOString(), contexto, row.id);
    const consumida = Number(marca.changes ?? 0) > 0;
    if (consumida) {
      recordTraza(root, {
        origen, tool, agente: "", decision: "allow",
        motivo: `aprobación manual ${row.id} usada en «${tool}»${contexto ? ` (${contexto})` : ""}`,
        approvalId: row.id, entrada: { tool, contexto }, salida: { consumida: true },
        contexto, ok: true,
      });
    }
    return consumida ? { id: row.id } : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

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

// Revoca una concesión que nadie llegó a gastar. La vigencia de 30 min es para
// el humano que aprueba mirando Aprobaciones; un reintento automático del chat no
// puede heredar esa ventana: si el plan que la pidió termina sin usar la búsqueda
// (el enrich no llegó a correr, la declaración del agente cambió entre la
// concesión y el uso, el proveedor devolvió una respuesta cortada), dejar la fila
// en `aprobada` autorizaría un uso que ya nadie está aprobando. Solo toca
// `aprobada`:
// `pendiente` se cierra con `decide`, y usada/rechazada/expirada ya tienen dueño.
// El estado `revocada` no se confunde con un rechazo humano (`rechazada`) ni con
// una denegación del broker (`denegada-*`).
export function revocarAprobacion(root: string, id: string): { ok: boolean; revocada: boolean; estado: string; msg: string } {
  const db = openDb(root);
  try {
    prepararTabla(db);
    const row = db.prepare("SELECT estado FROM aprobaciones WHERE id=?").get(id) as { estado?: string } | undefined;
    if (!row) return { ok: false, revocada: false, estado: "no-existe", msg: `aprobación ${id} no existe` };
    if (row.estado !== "aprobada") return { ok: true, revocada: false, estado: String(row.estado), msg: `aprobación ${id} ${row.estado}: no hay concesión que revocar` };
    // Una concesión que ya se intentó usar y falló no se revoca al terminar el
    // reintento: el permiso existe, el intento existió y el fallo fue de la
    // herramienta, no del humano. Revocarla lo obligaria a aprobar de nuevo por
    // un 401 o un timeout.
    const devuelta = db.prepare("SELECT devuelta_at FROM aprobaciones WHERE id=?").get(id) as { devuelta_at?: string | null } | undefined;
    if (devuelta?.devuelta_at) return { ok: true, revocada: false, estado: "aprobada", msg: `aprobación ${id} se conserva aprobada: el uso falló (${devuelta.devuelta_at}) y el intento ya existió` };
    // CAS sobre el estado: si el runner la consume en paralelo, gana uno solo.
    const marca = db.prepare("UPDATE aprobaciones SET estado='revocada', decided_by=?, decided_at=? WHERE id=? AND estado='aprobada'").run("reintento", new Date().toISOString(), id);
    if (Number(marca.changes ?? 0) === 0) return { ok: false, revocada: false, estado: "usada", msg: `aprobación ${id} ya la consumió otro uso` };
    return { ok: true, revocada: true, estado: "revocada", msg: `aprobación ${id} revocada: el reintento terminó sin usarla` };
  } catch {
    return { ok: false, revocada: false, estado: "error", msg: `aprobación ${id} no se pudo revocar` };
  } finally {
    db.close();
  }
}

// Devuelve a `aprobada` una concesión gastada en un uso que falló (EXA 401,
// timeout): el permiso era para ejecutar la herramienta, no para un intento que
// no produjo nada. Marca `devuelta_at`/`devuelta_por` como evidencia de que el
// intento existió —así el estado no cambia sin explicación y `revocarAprobacion`
// sabe que no debe cerrarla al terminar el reintento— y deja la fila consumible
// otra vez mientras siga en vigencia. No escribe traza: la fila ya cuenta el
// intento y una tool call fallida con `decision: allow` mentiría.
export function devolverAprobacion(root: string, id: string, motivo = ""): boolean {
  const db = openDb(root);
  try {
    prepararTabla(db);
    const marca = db.prepare(
      "UPDATE aprobaciones SET estado='aprobada', usada_at=NULL, usada_por=NULL, devuelta_at=?, devuelta_por=? WHERE id=? AND estado='usada'",
    ).run(new Date().toISOString(), motivo.slice(0, 200), id);
    return Number(marca.changes ?? 0) > 0;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

// Contexto opcional de la llamada para la traza (AXM-066): quién origina la
// tool call y con qué IO de entrada. Los llamadores existentes son compatibles
// porque el parámetro es opcional.
export interface LlamadaTrazable {
  origen?: string; // cli | web | run | telegram | handoff
  entrada?: unknown;
  contexto?: string; // p. ej. "run <spec>/<tarea>"
  /** Turno que originó la llamada (correlación con `turnos`). */
  turno?: string;
}

export function check(
  root: string,
  toolName: string,
  tool?: ToolContract,
  agente?: DeclaracionAgente,
  llamada?: LlamadaTrazable,
): Veredicto & { id?: string } {
  const t0 = Date.now();
  const r = componer(effectiveAllow(root, toolName, tool), agente);
  let id: string | undefined;
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
      if (previa?.id) {
        db.close();
        id = previa.id;
      } else {
        id = createHash("sha256").update(`${toolName}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
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
      }
    } catch { /* best effort: se devuelve la decisión sin id */ }
  }
  // Traza por tool call (AXM-066): el broker es el único punto de decisión, así
  // que TODA llamada a herramienta pasa por aquí (CLI, web, run, telegram,
  // handoff). Best-effort: la traza nunca cambia ni rompe la decisión.
  recordTraza(root, {
    origen: llamada?.origen ?? "cli",
    tool: toolName,
    agente: agente ? ("error" in agente ? `${agente.id}(error)` : agente.id) : "",
    decision: r.decision,
    riesgo: r.riesgo,
    motivo: r.motivo,
    approvalId: id ?? "",
    entrada: llamada?.entrada ?? {},
    salida: { decision: r.decision, id: id ?? null },
    contexto: llamada?.contexto ?? "",
    turnoId: llamada?.turno ?? "",
    ok: r.decision === "allow",
    ms: Date.now() - t0,
  });
  return id ? { ...r, id } : r;
}
