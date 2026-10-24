// Fase D — componentes versionados: temporal/local/global + evaluación + rollback.
import { openDb } from "./store.js";

export type Scope = "temporal" | "local" | "global";
export type CompEstado = "evaluando" | "activo" | "estable" | "rollback" | "archivado";

function table(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS componentes(
    nombre TEXT, ver TEXT, scope TEXT, estado TEXT, nota TEXT, created_at TEXT,
    PRIMARY KEY(nombre, ver))`);
}

export function crear(root: string, nombre: string, scope: Scope): string {
  const db = openDb(root);
  table(db);
  const vers: any[] = db.prepare("SELECT ver FROM componentes WHERE nombre=? ORDER BY ver DESC LIMIT 1").all(nombre);
  const next = `v${(vers.length + 1)}`;
  db.prepare("INSERT INTO componentes(nombre,ver,scope,estado,nota,created_at) VALUES(?,?,?, 'evaluando','',?)").run(nombre, next, scope, new Date().toISOString());
  db.close();
  return `${nombre}@${next} [${scope}] en evaluación (crear ≠ activar)`;
}

export function evaluar(root: string, nombre: string, ver: string, ok: boolean, evidencia = ""): string {
  const db = openDb(root);
  table(db);
  const row = db.prepare("SELECT * FROM componentes WHERE nombre=? AND ver=?").get(nombre, ver) as any;
  if (!row) { db.close(); return `componente ${nombre}@${ver} no existe`; }
  const nota = evidencia.slice(0, 500);
  if (row.scope === "global" && ok) {
    // global exige nota explícita: aquí se marca activo solo si pasa; aprobación humana va por broker ask
    db.prepare("UPDATE componentes SET estado='activo', nota=? WHERE nombre=? AND ver=?").run(nota, nombre, ver);
    db.close();
    return `${nombre}@${ver} global: evaluación OK → activo (con rollback disponible)`;
  }
  db.prepare("UPDATE componentes SET estado=?, nota=? WHERE nombre=? AND ver=?").run(ok ? "activo" : "archivado", nota, nombre, ver);
  db.close();
  return `${nombre}@${ver}: ${ok ? "activo" : "archivado (no pasó evaluación)"}`;
}

export function existeNombre(root: string, nombre: string): boolean {
  const db = openDb(root);
  table(db);
  const row = db.prepare("SELECT 1 FROM componentes WHERE nombre=? LIMIT 1").get(nombre) as any;
  db.close();
  return !!row;
}

export function existeComp(root: string, nombre: string, ver: string): boolean {
  const db = openDb(root);
  table(db);
  const row = db.prepare("SELECT 1 FROM componentes WHERE nombre=? AND ver=?").get(nombre, ver) as any;
  db.close();
  return !!row;
}

export function remove(root: string, nombre: string, ver: string): string {
  const db = openDb(root);
  table(db);
  const row = db.prepare("SELECT * FROM componentes WHERE nombre=? AND ver=?").get(nombre, ver) as any;
  if (!row) { db.close(); return `componente ${nombre}@${ver} no existe`; }
  if (row.estado === "estable" || row.estado === "activo") {
    db.close();
    return `denegado: ${nombre}@${ver} está ${row.estado} (fábrica/en-uso protegidas)`;
  }
  db.prepare("DELETE FROM componentes WHERE nombre=? AND ver=?").run(nombre, ver);
  db.close();
  return `remove ${nombre}@${ver}: eliminado (estaba ${row.estado})`;
}

export function rollback(root: string, nombre: string): string {
  const db = openDb(root);
  table(db);
  const estable: any = db.prepare("SELECT * FROM componentes WHERE nombre=? AND estado='estable' ORDER BY ver DESC LIMIT 1").get(nombre);
  const activo: any = db.prepare("SELECT * FROM componentes WHERE nombre=? AND estado='activo' ORDER BY ver DESC LIMIT 1").get(nombre);
  if (!estable) { db.close(); return `rollback ${nombre}: no hay versión estable (fábrica ausente)`; }
  if (activo) db.prepare("UPDATE componentes SET estado='rollback' WHERE nombre=? AND ver=?").run(nombre, activo.ver);
  db.prepare("UPDATE componentes SET estado='activo' WHERE nombre=? AND ver=?").run(nombre, estable.ver);
  db.close();
  return `rollback ${nombre}: ${activo ? activo.ver + " → " : ""}${estable.ver} (estable protegida, en-uso restaurado)`;
}

export function marcarEstable(root: string, nombre: string, ver: string): string {
  const db = openDb(root);
  table(db);
  db.prepare("UPDATE componentes SET estado='estable' WHERE nombre=? AND ver=?").run(nombre, ver);
  db.close();
  return `${nombre}@${ver} marcada estable (fábrica/en-uso protegidas)`;
}

export function diff(root: string, nombre: string): string {
  const par = comparables(root, nombre);
  if ("error" in par) return par.error;
  const { estable, cand } = par;
  const corta = (s: string) => (s || "-").slice(0, 120);
  const mismaEvidencia = (estable.nota || "") === (cand.nota || "") ? "idéntica" : "difiere — revisar sandbox antes de activar";
  let base = `diff ${nombre}: ${cand.ver} (${cand.estado}) vs ${estable.ver} (estable)\n- estable: ${estable.ver} [${estable.scope}] nota=${corta(estable.nota)}\n- candidata: ${cand.ver} [${cand.scope}] ${cand.estado} nota=${corta(cand.nota)}\nevidencia: ${mismaEvidencia}`;
  const ult = ultimaComparativa(root, nombre);
  if (ult && ult.estable_ver === estable.ver && ult.cand_ver === cand.ver) {
    base += `\nmedición: [${ult.cand_ver} exit=${ult.cand_exit} vs ${ult.estable_ver} exit=${ult.est_exit}] ${ult.veredicto} (cmd=${corta(ult.cmd)})`;
  } else {
    base += `\nmedición: pendiente — corre comp compare ${nombre} (batería guardada o por defecto del scope, --cmd explícito si quieres otra)`;
  }
  return base;
}

function compTable(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS comparativas(
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, estable_ver TEXT, cand_ver TEXT,
    cmd TEXT, est_exit INTEGER, cand_exit INTEGER, est_out TEXT, cand_out TEXT,
    veredicto TEXT, created_at TEXT)`);
}

export function comparables(root: string, nombre: string): { estable: any; cand: any } | { error: string } {
  const db = openDb(root);
  table(db);
  const hay: any = db.prepare("SELECT 1 FROM componentes WHERE nombre=? LIMIT 1").get(nombre);
  if (!hay) { db.close(); return { error: `componente ${nombre} no existe` }; }
  const estable: any = db.prepare("SELECT * FROM componentes WHERE nombre=? AND estado='estable' ORDER BY ver DESC LIMIT 1").get(nombre);
  const cand: any = db.prepare("SELECT * FROM componentes WHERE nombre=? AND estado IN ('activo','evaluando','rollback') ORDER BY ver DESC LIMIT 1").get(nombre);
  db.close();
  if (!estable && !cand) return { error: `diff ${nombre}: sin versiones para comparar` };
  if (!estable) return { error: `diff ${nombre}: sin estable (fábrica ausente) — candidata ${cand.ver} [${cand.scope}] ${cand.estado}` };
  if (!cand) return { error: `diff ${nombre}: sin candidata (solo estable ${estable.ver}) — nada que activar` };
  return { estable, cand };
}

export function guardarComparativa(root: string, r: { nombre: string; estable_ver: string; cand_ver: string; cmd: string; est_exit: number; cand_exit: number; est_out: string; cand_out: string; veredicto: string }): void {
  const db = openDb(root);
  table(db);
  compTable(db);
  db.prepare("INSERT INTO comparativas(nombre,estable_ver,cand_ver,cmd,est_exit,cand_exit,est_out,cand_out,veredicto,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    r.nombre, r.estable_ver, r.cand_ver, r.cmd.slice(0, 500), r.est_exit, r.cand_exit,
    r.est_out.slice(0, 500), r.cand_out.slice(0, 500), r.veredicto.slice(0, 200), new Date().toISOString());
  db.close();
}

export function ultimaComparativa(root: string, nombre: string): any | undefined {
  const db = openDb(root);
  table(db);
  compTable(db);
  const row: any = db.prepare("SELECT * FROM comparativas WHERE nombre=? ORDER BY id DESC LIMIT 1").get(nombre);
  db.close();
  return row;
}

function batTable(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS baterias(
    nombre TEXT PRIMARY KEY, cmd TEXT NOT NULL, image TEXT, updated_at TEXT)`);
}

// Batería por defecto según scope: compare funciona sin configuración previa.
// temporal/local = smoke (pasa si el sandbox inyecta AXIOM_COMP_VER en ambas); global = exige revisión (salida distinta por versión).
export function bateriaPorDefecto(scope: string): { cmd: string; motivo: string } {
  if (scope === "global")
    return { cmd: "echo ok-$AXIOM_COMP_VER", motivo: "por defecto (scope global: salida distinta por versión → exige revisión humana)" };
  return { cmd: 'test -n "$AXIOM_COMP_VER"', motivo: `por defecto (scope ${scope}: smoke — pasa si ambas ejecutan en sandbox)` };
}

export function guardarBateria(root: string, nombre: string, cmd: string, image?: string): string {
  const db = openDb(root);
  table(db);
  const hay: any = db.prepare("SELECT 1 FROM componentes WHERE nombre=? LIMIT 1").get(nombre);
  if (!hay) { db.close(); return `componente ${nombre} no existe`; }
  batTable(db);
  db.prepare("INSERT OR REPLACE INTO baterias(nombre,cmd,image,updated_at) VALUES(?,?,?,?)").run(
    nombre, cmd.slice(0, 500), (image ?? "").slice(0, 200), new Date().toISOString());
  db.close();
  return `batería ${nombre}: guardada${image ? ` (image ${image})` : ""} — comp compare la reutiliza sin --cmd`;
}

export function verBateria(root: string, nombre: string): { cmd: string; image: string } | undefined {
  const db = openDb(root);
  table(db);
  batTable(db);
  const row: any = db.prepare("SELECT cmd, image FROM baterias WHERE nombre=?").get(nombre);
  db.close();
  return row ? { cmd: row.cmd as string, image: row.image as string } : undefined;
}

export function listarBaterias(root: string): { nombre: string; cmd: string; image: string }[] {
  const db = openDb(root);
  table(db);
  batTable(db);
  const rows = db.prepare("SELECT nombre, cmd, image FROM baterias ORDER BY nombre").all() as { nombre: string; cmd: string; image: string }[];
  db.close();
  return rows;
}

export function borrarBateria(root: string, nombre: string): string {
  const db = openDb(root);
  table(db);
  batTable(db);
  const row: any = db.prepare("SELECT 1 FROM baterias WHERE nombre=?").get(nombre);
  if (!row) { db.close(); return `sin batería canónica para ${nombre}`; }
  db.prepare("DELETE FROM baterias WHERE nombre=?").run(nombre);
  db.close();
  return `batería ${nombre}: eliminada — comp compare usará la batería por defecto de su scope`;
}

export function listar(root: string): string {
  const db = openDb(root);
  table(db);
  const rows: any[] = db.prepare("SELECT nombre, ver, scope, estado FROM componentes ORDER BY nombre, ver").all();
  db.close();
  if (rows.length === 0) return "(sin componentes)";
  return rows.map((r: any) => `${r.nombre}@${r.ver} [${r.scope}] ${r.estado}`).join("\n");
}
