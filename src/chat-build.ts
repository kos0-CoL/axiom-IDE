import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { tituloAuto } from "./sessions.js";
import { openDb } from "./store.js";

export interface FileChange { path: string; content: string }
export interface BuildProposal {
  id: string;
  session_id: string;
  changes: FileChange[];
  existing: string[];
  state: "proposed" | "applied";
  created_at: string;
}
type Failure = { ok: false; error: string };
type Success<T> = { ok: true } & T;

function safeRelativePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 240 || raw.includes("\\") || raw.includes("\0")) return null;
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) return null;
  const path = normalize(raw).split(sep).join("/");
  if (path === "." || path.startsWith("../") || path.includes("/../") || path === "..") return null;
  if (path.split("/").some((part) => !part || part.startsWith("."))) return null;
  if (path.split("/").some((part) => ["node_modules", ".git", "dist", "dist-test"].includes(part))) return null;
  return path;
}

export function contextoWorkspace(root: string, maxChars = 24_000): string {
  const projectRoot = resolve(root);
  const excludedDirs = new Set(["node_modules", ".git", ".next", "dist", "dist-test", "build", "coverage", ".cache"]);
  const allowed = /(?:^|\/)(?:README(?:\.[^/]*)?|package\.json|tsconfig(?:\.[^/]*)?\.json|vite\.config\.[^/]+|index\.html|[^/]+\.(?:tsx?|jsx?|css|html|json|md))$/i;
  const results: string[] = [];
  let total = 0;
  const visit = (dir: string, depth: number): void => {
    if (depth > 4 || total >= maxChars) return;
    try { if (lstatSync(dir).isSymbolicLink()) return; } catch { return; }
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.endsWith(".db")) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) visit(path, depth + 1);
      } else if (entry.isFile() && allowed.test(path.slice(projectRoot.length + 1))) {
        try {
          const content = readFileSync(path, "utf8");
          if (content.includes("\0")) continue;
          const rel = relative(projectRoot, path).split(sep).join("/");
          const block = `--- ${rel} ---\n${content.slice(0, 5000)}`;
          const clipped = block.slice(0, maxChars - total);
          if (!clipped) return;
          results.push(clipped);
          total += clipped.length;
        } catch { /* ignore unreadable files */ }
      }
      if (total >= maxChars) return;
    }
  };
  visit(resolve(root), 0);
  return results.length ? `Archivos existentes del proyecto (solo contexto; no cambies nada fuera de changes[]):\n${results.join("\n\n")}` : "El proyecto aún no contiene archivos fuente relevantes.";
}

export function contextoPlanAprobado(root: string, sessionId: string, maxChars = 16_000): string {
  const db = openDb(root);
  try {
    const row = db.prepare("SELECT pa.spec_id FROM plan_artifacts pa JOIN plan_propuestas pp ON pp.id=pa.proposal_id WHERE pp.session_id=? AND pp.estado='aprobada' ORDER BY pp.decided_at DESC LIMIT 1").get(sessionId) as { spec_id: string } | undefined;
    if (!row) return "La sesión aún no tiene un plan aprobado.";
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.spec_id)) return "El identificador del plan guardado no es válido.";
    const dir = join(resolve(root), "specs", "active", row.spec_id);
    const spec = readFileSync(join(dir, "spec.md"), "utf8").slice(0, maxChars / 2);
    const plan = readFileSync(join(dir, "plan.md"), "utf8").slice(0, maxChars / 2);
    return `${spec}\n\n${plan}`.slice(0, maxChars);
  } catch { return "Los artefactos del plan aprobado no están disponibles; continúa usando la solicitud y el contexto del workspace."; }
  finally { db.close(); }
}

export function parseBuildChanges(text: string): { ok: true; changes: FileChange[]; summary?: string } | Failure {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return { ok: false, error: "El modelo no devolvió JSON válido para la propuesta de archivos." }; }
  const entries = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? (payload as { changes?: unknown }).changes : null;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 20) return { ok: false, error: "La propuesta debe contener entre 1 y 20 archivos en changes[]." };
  const changes: FileChange[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "Cada cambio debe tener path y content de texto." };
    const item = entry as { path?: unknown; content?: unknown };
    const path = safeRelativePath(item.path);
    if (!path || typeof item.content !== "string" || item.content.length > 200_000) return { ok: false, error: "Ruta insegura o contenido inválido (máximo 200 KB por archivo)." };
    if (seen.has(path)) return { ok: false, error: `Ruta duplicada: ${path}` };
    seen.add(path);
    changes.push({ path, content: item.content });
  }
  if (changes.reduce((sum, change) => sum + Buffer.byteLength(change.content, "utf8"), 0) > 1_000_000) return { ok: false, error: "La propuesta supera el límite total de 1 MB." };
  const summary = payload && typeof payload === "object" && "summary" in payload && typeof payload.summary === "string" ? payload.summary.slice(0, 1000) : undefined;
  return { ok: true, changes, summary };
}

function validarTargets(root: string, changes: FileChange[]): Failure | null {
  const project = resolve(root);
  for (const change of changes) {
    const safePath = safeRelativePath(change.path);
    if (!safePath || safePath !== change.path) return { ok: false, error: `Ruta insegura: ${change.path}` };
    const target = resolve(project, safePath);
    const rel = relative(project, target);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { ok: false, error: `Ruta fuera del proyecto: ${change.path}` };
    let current = project;
    for (const segment of safePath.split("/")) {
      current = join(current, segment);
      if (!existsSync(current)) continue;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return { ok: false, error: `No se permiten enlaces simbólicos: ${change.path}` };
      if (current !== target && !stat.isDirectory()) return { ok: false, error: `Un componente de la ruta no es directorio: ${change.path}` };
      if (current === target && !stat.isFile()) return { ok: false, error: `El destino existe y no es archivo regular: ${change.path}` };
    }
  }
  return null;
}

export function guardarBuildPropuesta(root: string, sessionId: string, changes: FileChange[]): Success<{ id: string }> | Failure {
  if (!Array.isArray(changes) || !changes.length || changes.length > 20) return { ok: false, error: "Cantidad de cambios inválida." };
  const invalid = validarTargets(root, changes);
  if (invalid) return invalid;
  const db = openDb(root);
  try {
    if (!db.prepare("SELECT id FROM chat_sessions WHERE id=?").get(sessionId)) return { ok: false, error: "La sesión de chat no existe en este proyecto." };
    const id = `bp-${randomUUID().slice(0, 10)}`;
    db.prepare("INSERT INTO build_proposals(id,session_id,changes_json,state,created_at) VALUES(?,?,?,?,?)").run(id, sessionId, JSON.stringify(changes), "proposed", new Date().toISOString());
    return { ok: true, id };
  } finally { db.close(); }
}

export function obtenerBuildPropuesta(root: string, id: string): Success<{ proposal: BuildProposal }> | Failure {
  const db = openDb(root);
  let row: { id: string; session_id: string; changes_json: string; state: string; created_at: string } | undefined;
  try { row = db.prepare("SELECT id,session_id,changes_json,state,created_at FROM build_proposals WHERE id=?").get(id) as typeof row; }
  finally { db.close(); }
  if (!row) return { ok: false, error: `propuesta inexistente: ${id}` };
  let changes: FileChange[];
  try {
    const decoded: unknown = JSON.parse(row.changes_json);
    if (!Array.isArray(decoded)) throw new Error("changes no es una lista");
    const parsed = parseBuildChanges(JSON.stringify({ changes: decoded }));
    if (!parsed.ok) return { ok: false, error: "La propuesta guardada está dañada o contiene rutas inseguras." };
    changes = parsed.changes;
  } catch { return { ok: false, error: "La propuesta guardada está dañada." }; }
  const invalid = validarTargets(root, changes);
  if (invalid) return invalid;
  return { ok: true, proposal: { id: row.id, session_id: row.session_id, changes, existing: changes.map((change) => change.path).filter((path) => existsSync(resolve(root, path))), state: row.state === "applied" ? "applied" : "proposed", created_at: row.created_at } };
}

export function aplicarBuildPropuesta(root: string, id: string, overwrite: boolean): Success<{ files: string[] }> | Failure {
  const current = obtenerBuildPropuesta(root, id);
  if (!current.ok) return current;
  if (current.proposal.state !== "proposed") return { ok: false, error: "Esta propuesta ya fue aplicada." };
  const { changes, session_id: sessionId } = current.proposal;
  const invalid = validarTargets(root, changes);
  if (invalid) return invalid;
  const existing = changes.map((change) => change.path).filter((path) => existsSync(resolve(root, path)));
  if (existing.length && !overwrite) return { ok: false, error: `Algunos destinos ya existen: ${existing.join(", ")}. Debes confirmar explícitamente su reemplazo.`, conflicts: existing } as Failure & { conflicts: string[] };

  const originals = new Map<string, string | null>();
  const written: string[] = [];
  const createdDirs: string[] = [];
  try {
    for (const change of changes) {
      const target = resolve(root, change.path);
      originals.set(target, existsSync(target) ? readFileSync(target, "utf8") : null);
      const missingDirs: string[] = [];
      let parent = dirname(target);
      while (parent !== resolve(root) && !existsSync(parent)) { missingDirs.unshift(parent); parent = dirname(parent); }
      mkdirSync(dirname(target), { recursive: true });
      createdDirs.push(...missingDirs);
      written.push(target);
      writeFileSync(target, change.content, { encoding: "utf8", flag: originals.get(target) === null ? "wx" : "w" });
    }
    const db = openDb(root);
    try {
      db.exec("BEGIN IMMEDIATE");
      const update = db.prepare("UPDATE build_proposals SET state='applied' WHERE id=? AND state='proposed'").run(id);
      if (Number(update.changes) !== 1) throw new Error("La propuesta cambió de estado antes de confirmar.");
      db.prepare("UPDATE chat_sessions SET updated_at=? WHERE id=?").run(new Date().toISOString(), sessionId);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
      throw error;
    } finally { db.close(); }
    return { ok: true, files: changes.map((change) => change.path) };
  } catch (error) {
    for (const target of written.reverse()) {
      try {
        const original = originals.get(target);
        if (original === null) unlinkSync(target);
        else if (original !== undefined) writeFileSync(target, original, "utf8");
      } catch { /* report primary failure; rollback is best effort */ }
    }
    for (const dir of createdDirs.reverse()) { try { rmdirSync(dir); } catch { /* remove only directories created by this proposal */ } }
    return { ok: false, error: `No se pudo aplicar la propuesta: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function guardarArtefactosPlan(root: string, sessionId: string, solicitud: string, plan: string, proposalId?: string, generado?: { proveedor: string; model: string; uso?: { prompt: number; respuesta: number; total: number; fuente: string } }): Success<{ spec_id: string; proposal_id: string; files: string[] }> | Failure {
  if (!solicitud.trim() || solicitud.length > 20000 || !plan.trim() || plan.length > 20000) return { ok: false, error: "La solicitud y el plan deben tener entre 1 y 20000 caracteres." };
  const titulo = tituloAuto(solicitud);
  const base = solicitud.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "feature";
  let id = "";
  let actualProposalId = proposalId ?? `plan-${randomUUID().slice(0, 10)}`;
  const db = openDb(root);
  let dir = "";
  let created = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    if (!db.prepare("SELECT id FROM chat_sessions WHERE id=?").get(sessionId)) throw new Error("La sesión de chat no existe en este proyecto.");
    let solicitudGuardada = solicitud.trim();
    let planGuardado = plan.trim();
    if (proposalId) {
      const existing = db.prepare("SELECT session_id,estado,texto FROM plan_propuestas WHERE id=?").get(proposalId) as { session_id: string; estado: string; texto: string } | undefined;
      if (!existing || existing.session_id !== sessionId || existing.estado !== "propuesta") throw new Error("La propuesta de plan no existe o ya fue decidida.");
      planGuardado = existing.texto;
      const userMessage = db.prepare("SELECT texto FROM chat_messages WHERE session_id=? AND rol='usuario' ORDER BY id DESC LIMIT 1").get(sessionId) as { texto: string } | undefined;
      if (userMessage?.texto) solicitudGuardada = userMessage.texto;
      const linked = db.prepare("SELECT spec_id FROM plan_artifacts WHERE proposal_id=?").get(proposalId) as { spec_id: string } | undefined;
      if (linked) {
        const specPath = join(resolve(root), "specs", "active", linked.spec_id);
        if (!existsSync(join(specPath, "spec.md")) || !existsSync(join(specPath, "plan.md"))) throw new Error("Faltan los archivos del plan ya guardado.");
        db.exec("COMMIT");
        return { ok: true, spec_id: linked.spec_id, proposal_id: proposalId, files: [`specs/active/${linked.spec_id}/spec.md`, `specs/active/${linked.spec_id}/plan.md`] };
      }
      actualProposalId = proposalId;
    } else {
      db.prepare("INSERT INTO plan_propuestas(id,session_id,texto,estado,created_at,decided_at) VALUES(?,?,?,?,?,?)").run(actualProposalId, sessionId, plan.trim(), "propuesta", new Date().toISOString(), "");
    }
    const specsRoot = join(resolve(root), "specs", "active");
    mkdirSync(specsRoot, { recursive: true });
    id = base;
    for (let suffix = 2; existsSync(join(specsRoot, id)); suffix++) id = `${base.slice(0, 32)}-${suffix}`;
    dir = join(specsRoot, id);
    mkdirSync(dir, { recursive: false });
    created = true;
    const tokenInfo = generado?.uso && generado.uso.fuente === "medido" && typeof generado.uso.prompt === "number" && typeof generado.uso.respuesta === "number"
      ? ` · ${generado.uso.total ?? (generado.uso.prompt + generado.uso.respuesta)} tok (${generado.uso.prompt}p/${generado.uso.respuesta}r)`
      : "";
    const meta = generado ? `\n**generado con:** ${generado.proveedor ?? "?"}/${generado.model ?? "?"} · ${new Date().toISOString()}${tokenInfo}` : "";
    const spec = `# Spec ${id} — ${titulo}\n\n**estado:** propuesta\n**sesión:** ${sessionId}${meta}\n\n## Objetivo solicitado\n\n${solicitudGuardada}\n\n## Criterios de aceptación\n\n- [ ] Cumplir el objetivo solicitado y los pasos del plan aprobado.\n- [ ] Verificar el resultado en el proyecto.\n`;
    const planDoc = `# Plan ${id} — ${titulo}\n\n**estado:** propuesta para revisión\n**sesión:** ${sessionId}${meta}\n\n${planGuardado}\n`;
    writeFileSync(join(dir, "spec.md"), spec, { encoding: "utf8", flag: "wx" });
    writeFileSync(join(dir, "plan.md"), planDoc, { encoding: "utf8", flag: "wx" });
    db.prepare("INSERT INTO specs(id,ver,title,path,status) VALUES(?,?,?,?,?)").run(id, "v1", titulo, `specs/active/${id}/spec.md`, "draft");
    db.prepare("INSERT INTO plan_artifacts(proposal_id,spec_id) VALUES(?,?)").run(actualProposalId, id);
    db.exec("COMMIT");
    return { ok: true, spec_id: id, proposal_id: actualProposalId, files: [`specs/active/${id}/spec.md`, `specs/active/${id}/plan.md`] };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
    if (created) {
      for (const file of [join(dir, "spec.md"), join(dir, "plan.md")]) { try { unlinkSync(file); } catch { /* rollback cleanup only files created here */ } }
      try { rmdirSync(dir); } catch { /* directory may remain empty */ }
    }
    return { ok: false, error: `No se pudieron guardar los artefactos del plan: ${error instanceof Error ? error.message : String(error)}` };
  } finally { db.close(); }
}
