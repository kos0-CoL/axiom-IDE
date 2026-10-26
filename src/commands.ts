// Comandos axiom: toda la lógica antes en cli.ts (composition root delegado).
// Reciben root explícito; cli.ts solo parsea args y despacha.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { addConsumo, getConsumo, listBloqueos, listUsos, openDb, recordBloqueo, recordUso } from "./store.js";
import { TaskContract } from "./contracts.js";
import { SPEC_TEMPLATE, PLAN_TEMPLATE, TASKS_TEMPLATE, VERIFICATION_TEMPLATE, OVERRIDES_README } from "./preset.js";
import { check, decide } from "./broker.js";
import { cicloImproductivo, checkTecho } from "./policy.js";
import { huellaConfig, leerMarca, marcarRun, textoSnapshot } from "./runmark.js";
import { asegurarExperience, registrarLeccion, textoExperiencia, proponerAjuste, textoPropuestas, verPropuesta, decidirPropuesta } from "./experience.js";
import { validarTodasSuperficies, nombresConocidos, moduloActivo, crearModulo, regenModulo, textoCompat } from "./modulos.js";
import { archivosFueraDeAllow, asegurarColumnaArchivos, validarArchivos } from "./staging.js";
import { renderOrquestacion, renderTrabajo, datosOrquestacion, datosTrabajo } from "./ui.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { crear, evaluar, rollback, marcarEstable, listar, remove, existeComp, existeNombre, diff as diffComp, comparables, guardarComparativa, guardarBateria, verBateria, listarBaterias, borrarBateria, bateriaPorDefecto } from "./components.js";
import { sandboxRun, imagenPermitida } from "./sandbox.js";
import { startWeb, validateTokens, defaultWebSource } from "./web.js";
import { spawn as adaptersSpawn, formatSpawn } from "./adapters.js";
import { rondaAgenteGrafo, declaracionDeHerramienta, declaracionDeAprobacion } from "./modules/agents/index.js";

export function activeDir(root: string, id: string): string {
  return join(root, "specs", "active", id);
}

// Flag numérico opcional: --tokens N / --calls M. Devuelve valor y resto sin flag.
export function flagNum(args: string[], name: string, def: number): { valor: number; resto: string[] } {
  const i = args.indexOf(name);
  if (i < 0) return { valor: def, resto: args };
  const n = parseInt(args[i + 1] ?? "", 10);
  if (!Number.isInteger(n) || n < 0) { console.error(`${name} debe ser entero >=0`); process.exit(1); }
  return { valor: n, resto: args.filter((_, j) => j !== i && j !== i + 1) };
}

export function cmdInit(root: string): void {
  mkdirSync(join(root, ".specify", "templates", "overrides"), { recursive: true });
  mkdirSync(join(root, "specs", "active"), { recursive: true });
  mkdirSync(join(root, "docs", "decisions"), { recursive: true });
  try { asegurarExperience(root); } catch { /* memoria opcional */ }
  if (!existsSync(join(root, ".specify", "feature.json")))
    writeFileSync(join(root, ".specify", "feature.json"), JSON.stringify({ active: null }, null, 2));
  writeFileSync(join(root, ".specify", "templates", "overrides", "README.md"), OVERRIDES_README);
  if (!existsSync(join(root, "axiom.json")))
    writeFileSync(join(root, "axiom.json"), JSON.stringify({ name: "axiom-project", harness: "0.2.0-a2", preset: "axiom" }, null, 2));
  if (!existsSync(join(root, "policies.global.json")))
    writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools: { terminal: false }, techo: { rondas: 3, tokens: 100000, calls: 500 } }, null, 2));
  if (!existsSync(join(root, "project.json")))
    writeFileSync(join(root, "project.json"), JSON.stringify({ tools: {}, presupuesto: { tokens: 50000, calls: 200 } }, null, 2));
  const db = openDb(root);
  db.close();
  console.log(`axiom init OK: ${root} (preset axiom A2)`);
}

export function cmdSpec(root: string, id?: string, ...titleParts: string[]): void {
  if (!id) { console.error("uso: axiom spec <id-slug> <título>"); process.exit(1); }
  const title = titleParts.join(" ") || id;
  const dir = activeDir(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), SPEC_TEMPLATE(id, title));
  const db = openDb(root);
  db.prepare("INSERT OR REPLACE INTO specs(id,ver,title,path,status) VALUES(?,?,?,?,'draft')").run(id, "v1", title, `specs/active/${id}/spec.md`);
  db.prepare("UPDATE meta SET v=? WHERE k='schema'").run("1");
  writeFileSync(join(root, ".specify", "feature.json"), JSON.stringify({ active: id }, null, 2));
  db.close();
  console.log(`spec OK: ${id} v1`);
}

export function cmdPlan(root: string, id?: string): void {
  if (!id) { console.error("uso: axiom plan <id-slug>"); process.exit(1); }
  const dir = activeDir(root, id);
  if (!existsSync(join(dir, "spec.md"))) { console.error(`no existe spec ${id}; corre axiom spec primero`); process.exit(1); }
  writeFileSync(join(dir, "plan.md"), PLAN_TEMPLATE(id));
  console.log(`plan OK: ${id}`);
}

export function cmdTasks(root: string, id?: string): void {
  if (!id) { console.error("uso: axiom tasks <id-slug>"); process.exit(1); }
  const dir = activeDir(root, id);
  if (!existsSync(join(dir, "spec.md"))) { console.error(`no existe spec ${id}`); process.exit(1); }
  writeFileSync(join(dir, "tasks.md"), TASKS_TEMPLATE(id));
  const db = openDb(root);
  for (const n of ["T1", "T2"]) {
    const tid = `${id}-${n}`;
    db.prepare("INSERT OR REPLACE INTO tasks(id,spec_id,spec_ver,title,scenario,estado,owner) VALUES(?,?,?,?,?,'implementado','unassigned')").run(
      tid, id, "v1", `${n} ${id}`, `Given contexto ${n} When acción Then resultado observable`,
    );
  }
  db.close();
  console.log(`tasks OK: ${id} (2 tareas implementado)`);
}

// Flag de texto opcional: --detalle "...". Devuelve valor y resto sin flag.
export function flagStr(args: string[], name: string): { valor: string | undefined; resto: string[] } {
  const i = args.indexOf(name);
  if (i < 0) return { valor: undefined, resto: args };
  const v = args[i + 1];
  if (v === undefined) { console.error(`${name} requiere valor`); process.exit(1); }
  return { valor: v, resto: args.filter((_, j) => j !== i && j !== i + 1) };
}

export interface VerifyResult { code: number; msg: string }

// Núcleo de verify sin process.exit (run --agente y la web lo reutilizan).
export function verificar(root: string, taskId: string | undefined, verdictArg: string | undefined, tokens = 100, calls = 1, detalle?: string, juez = "humano", archivosCSV?: string): VerifyResult {
  if (!taskId) return { code: 1, msg: "verify: task-id requerido" };
  const db = openDb(root);
  const t: any = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
  if (!t) { db.close(); return { code: 1, msg: `tarea ${taskId} no existe` }; }
  // Juez fallido ≠ trabajo fallido: no hay evidencia, no cambia estado, queda ERROR + bloqueo.
  if (verdictArg === "error") {
    const d = (detalle ?? "").trim().slice(0, 500) || "sin detalle";
    const dir = activeDir(root, t.spec_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `verification-${taskId}-ERROR.md`), `# Verification ${taskId} — JUEZ FALLIDO\n\n**detalle:** ${d}\n**juez:** ${juez}\n**fecha:** ${new Date().toISOString()}\n\n> El juez no pudo veredictar. Esto NO es un fail del trabajo: la tarea sigue implementado.\n`);
    db.close();
    recordBloqueo(root, taskId, `juez-fallido: ${d.slice(0, 120)}`);
    try { registrarLeccion(root, taskId, "error-juez", juez, d); } catch { /* la memoria nunca rompe el verify */ }
    return { code: 0, msg: `verify JUEZ-FALLIDO: ${taskId} (sin veredicto; sigue implementado)` };
  }
  const verdict = verdictArg === "fail" ? "fail" : "pass";
  const cmd = `axiom verify ${taskId} ${verdict}`;
  const sha = createHash("sha256").update(`${taskId}:${verdict}:${Date.now()}`).digest("hex");
  // Artefactos declarados: existen y están en allowlist, si no no hay firma.
  const lista = (archivosCSV ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20);
  if (lista.length > 0) {
    const v = validarArchivos(root, lista);
    if (!v.ok) return { code: 2, msg: `verify staging: ${v.fuera.join("; ")}` };
  }
  const archTxt = lista.join("\n");
  const dir = activeDir(root, t.spec_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `verification-${taskId}.md`), VERIFICATION_TEMPLATE(taskId, verdict, sha, cmd, juez, lista.join(", ")));
  asegurarColumnaArchivos(root);
  const db2 = openDb(root);
  db2.prepare("INSERT INTO evidences(task_id,cmd,exit,sha256,verdict,created_at,archivos) VALUES(?,?,?,?,?,?,?)").run(taskId, cmd, verdict === "pass" ? 0 : 1, sha, verdict, new Date().toISOString(), archTxt);
  db2.close();
  db.prepare("UPDATE tasks SET estado=? WHERE id=?").run(verdict === "pass" ? "verificado" : "bloqueado", taskId);
  db.close();
  addConsumo(root, tokens, calls);
  if (verdict === "fail") recordBloqueo(root, taskId, `verify fail ${sha.slice(0, 8)}`);
  try { registrarLeccion(root, taskId, verdict, juez, detalle); } catch { /* la memoria nunca rompe el verify */ }
  return { code: 0, msg: `verify OK: ${taskId} → ${verdict} (${sha.slice(0, 8)}, juez=${juez})` };
}

export function cmdVerify(root: string, taskId?: string, verdictArg?: string, tokens = 100, calls = 1, detalle?: string, juez = "humano", archivosCSV?: string): void {
  if (!taskId) { console.error("uso: axiom verify <task-id> [pass|fail|error] [--tokens N] [--calls M] [--detalle \"...\"] [--archivos \"a,b\"]"); process.exit(1); }
  const r = verificar(root, taskId, verdictArg, tokens, calls, detalle, juez, archivosCSV);
  if (r.code === 2) { console.error(r.msg); process.exit(2); }
  if (r.code !== 0) { console.error(r.msg); process.exit(1); }
  console.log(r.msg);
}

export function cmdDecide(root: string, id: string | undefined, ok: boolean): void {
  if (!id) { console.error("uso: axiom approve|reject <id>"); process.exit(1); }
  const r = decide(root, id, ok, "cli", 30, declaracionDeAprobacion(root, id));
  console.log(r.msg);
  if (!r.ok) process.exit(2);
}

// REVIEW-mvp0: cmdRun delega en helpers (policy/store/fs separados).
function tareasSinEvidencia(root: string, specId: string): { tareas: any[]; pendientes: any[] } {
  const db = openDb(root);
  const tareas: any[] = db.prepare("SELECT * FROM tasks WHERE spec_id=?").all(specId);
  const pendientes = tareas.filter((t) => !db.prepare("SELECT * FROM evidences WHERE task_id=?").get(t.id));
  db.close();
  return { tareas, pendientes };
}

function calcularRonda(dir: string): number {
  // Histórico: nº de informes previos + 1 (persiste entre invocaciones).
  try {
    return readdirSync(dir).filter((f) => /^informe-ronda-\d+\.md$/.test(f)).length + 1;
  } catch { return 1; }
}

function informarRondaAgente(dir: string, id: string, ronda: number, maxRondas: number, r: { hechas: number; pass: number; fail: number; fallos: string[] }, tras: any[]): void {
  const report = `# Informe ronda ${id} (agente)\n\nIntentos: ${ronda}/${maxRondas}\nTrabajo+juez: ${r.hechas} tarea(s)\nVeredictos: ${r.pass} pass, ${r.fail} fail\nFallo(s): ${r.fallos.join("; ") || "ninguno"}\nQuedan sin evidencia: ${tras.map((t: any) => t.id).join(", ") || "ninguna"}\n\n> Los artefactos del agente son datos revisables (juez=agente en verification.md). Un humano puede re-verificar con axiom verify.\n`;
  writeFileSync(join(dir, `informe-ronda-${ronda}.md`), report);
}

function informarRonda(dir: string, id: string, ronda: number, maxRondas: number, pendientes: any[]): void {
  const report = `# Informe ronda ${id}\n\nIntentos: ${ronda}/${maxRondas}\nSin evidencia: ${pendientes.map((t: any) => t.id).join(", ")}\nCausa: falta verification.md con hash.\nPróximo: axiom verify <task> pass|fail antes de reintentar.\n`;
  writeFileSync(join(dir, `informe-ronda-${ronda}.md`), report);
  console.log(`run ${id}: BLOQUEADO ronda ${ronda}/${maxRondas} — ${pendientes.length} sin evidencia. Informe en informe-ronda-${ronda}.md`);
}

export interface PlanRun {
  code: number;
  msg: string;
}

// F12: el agente hace trabajo real entre rondas — ejecución via grafo de agentes.
// El orquestador delega según agents.config.json; cada nodo ejecuta con su config (modelo, skills, instrucciones).
const MAX_TAREAS_AGENTE = 4;

// Ronda usando el grafo de agentes (nueva implementación)
async function rondaAgente(root: string, specId: string, pendientes: any[]): Promise<{ hechas: number; pass: number; fail: number; fallos: string[] }> {
  const objetivo = pendientes.slice(0, MAX_TAREAS_AGENTE);
  const tareasParaGrafo = objetivo.map((t) => ({ id: t.id, title: t.title, scenario: t.scenario }));
  const resultados = await rondaAgenteGrafo(root, specId, tareasParaGrafo);
  
  const res = { hechas: 0, pass: 0, fail: 0, fallos: [] as string[] };
  
  for (const r of resultados) {
    if (!r.ok) {
      res.fallos.push(`${r.taskId}: ${r.error}`);
      continue;
    }
    res.hechas++;
    // Persistir verificación (igual que la implementación original)
    const v = r.verdict;
    const vr = verificar(root, r.taskId, v, 0, 0, undefined, "agente", r.relPath);
    if (vr.code === 0) { if (v === "pass") res.pass++; else res.fail++; } else res.fallos.push(`${r.taskId}: ${vr.msg.slice(0, 80)}`);
  }
  return res;
}

// Núcleo de run sin process.exit (la web lo reutiliza). Dry-run no consume ni escribe informes.
// conAgente (F12): el proveedor trabaja y juzga cada pendiente (2 spawns/tarea, tope 4).
export async function planRun(root: string, id?: string, maxRondas = 3, tokens = 50, calls = 1, dryRun = false, conAgente = false): Promise<PlanRun> {
  if (!id) return { code: 1, msg: "uso: axiom run <id-slug> [--rondas N] [--tokens N] [--calls M] [--dry-run] [--agente]" };
  if (!Number.isInteger(maxRondas) || maxRondas < 1) return { code: 2, msg: "--rondas debe ser entero >=1" };
  const huella = huellaConfig(root);
  const marca = leerMarca(root, id);
  if (marca && marca.fingerprint !== huella) {
    return { code: 3, msg: `run ${id}: la configuración cambió desde la última marca (huella ${marca.fingerprint} → ${huella}); restaura la config o usa un id nuevo` };
  }
  const techo = checkTecho(root, 1, 2, 2);
  if (!techo.ok) return { code: 4, msg: `run bloqueado por techo: ${techo.motivo}` };
  const { tareas, pendientes } = tareasSinEvidencia(root, id);
  if (tareas.length === 0) return { code: 0, msg: `run ${id}: sin tareas; corre axiom tasks primero` };
  const ronda = calcularRonda(activeDir(root, id));
  if (ronda > maxRondas) return { code: 1, msg: `run ${id}: BLOQUEADO definitivo tras ${maxRondas}/${maxRondas} — escalar a humano.` };
  const fuera = archivosFueraDeAllow(root);
  const staging = fuera.length ? ` staging: ${fuera.length} fuera de allowlist (${fuera.slice(0, 3).join(", ")}${fuera.length > 3 ? ", …" : ""})` : " staging: limpio";
  const agentePlan = conAgente && pendientes.length > 0
    ? ` agente: ${Math.min(pendientes.length, MAX_TAREAS_AGENTE)} pendiente(s) con ${Math.min(pendientes.length, MAX_TAREAS_AGENTE) * 2} spawns (trabajo+juez).`
    : "";
  if (dryRun) {
    return { code: 0, msg: `run ${id}: dry-run huella=${huella} techo=ok tareas=${tareas.length} pendientes=${pendientes.length} ronda=${ronda}/${maxRondas} consumo=+${tokens}tok/+${calls}calls (sin gastar, sin informes).${agentePlan}${staging}` };
  }
  marcarRun(root, id, ronda);
  if (conAgente && pendientes.length > 0) {
    const r = await rondaAgente(root, id, pendientes);
    const { pendientes: tras } = tareasSinEvidencia(root, id);
    informarRondaAgente(activeDir(root, id), id, ronda, maxRondas, r, tras);
    const resumen = `ronda ${ronda}/${maxRondas} — agente: ${r.pass} pass, ${r.fail} fail${r.fallos.length ? `, ${r.fallos.length} fallo(s): ${r.fallos.slice(0, 2).join(" | ")}` : ""}`;
    if (tras.length === 0) return { code: 0, msg: `run ${id}: OK ${resumen} — todas con evidencia del agente. Listo para accept (revisa el artefacto).${staging}` };
    return { code: 1, msg: `run ${id}: PARCIAL ${resumen} — quedan ${tras.length} sin evidencia (informe escrito).${staging}` };
  }
  addConsumo(root, tokens, calls);
  if (pendientes.length > 0) {
    informarRonda(activeDir(root, id), id, ronda, maxRondas, pendientes);
    return { code: 1, msg: `run ${id}: BLOQUEADO ronda ${ronda}/${maxRondas} — ${pendientes.length} sin evidencia (informe escrito, marca guardada).${staging}` };
  }
  return { code: 0, msg: `run ${id}: OK ronda ${ronda}/${maxRondas} — ${tareas.length} tareas con evidencia. Listo para accept.${staging}` };
}

export async function cmdRun(root: string, id?: string, maxRondas = 3, tokens = 50, calls = 1, dryRun = false, conAgente = false): Promise<void> {
  const r = await planRun(root, id, maxRondas, tokens, calls, dryRun, conAgente);
  const out = r.code === 0 ? console.log : console.error;
  out(r.msg);
  if (r.code !== 0) process.exit(r.code);
}

export function cmdStatus(root: string, traceId?: string): void {
  if (traceId) asegurarColumnaArchivos(root);
  const db = openDb(root);
  if (traceId) {
    const t: any = db.prepare("SELECT * FROM tasks WHERE id=?").get(traceId);
    if (!t) { console.log(`trace: tarea ${traceId} no encontrada`); db.close(); return; }
    const ev: any = db.prepare("SELECT * FROM evidences WHERE task_id=?").get(traceId);
    const bloq = (() => { try { return listBloqueos(root, 100).filter((b) => b.task_id === traceId); } catch { return []; } })();
    const cons = (() => { try { return getConsumo(root); } catch { return { tokens: 0, calls: 0 }; } })();
    db.close();
    const verFile = join(activeDir(root, t.spec_id), `verification-${traceId}.md`);
    const errFile = join(activeDir(root, t.spec_id), `verification-${traceId}-ERROR.md`);
    const juezFallo = existsSync(errFile) || bloq.some((b) => b.causa.startsWith("juez-fallido:"));
    const usosTxt = (() => { try { return listUsos(root, 3).map((u) => `+${u.total}tok(${u.fuente})`).join(" ") || "sin spawns"; } catch { return "sin spawns"; } })();
    const arch = typeof ev?.archivos === "string" && ev.archivos ? ev.archivos.split("\n").length : 0;
    console.log(`trace ${t.id}: spec ${t.spec_id}:${t.spec_ver} estado=${t.estado} evidencia=${ev ? ev.verdict + " " + ev.sha256.slice(0, 8) : "PENDIENTE"} archivos=${arch} verification.md=${existsSync(verFile) ? "sí" : "falta"} juez-fallido=${juezFallo ? "sí (no es fail del trabajo)" : "no"} bloqueos=${bloq.length ? bloq.map((b) => b.causa).join("; ") : "ninguno"} consumo=tokens:${cons.tokens} calls:${cons.calls} usos=${usosTxt}`);
    return;
  }
  const counts: any[] = db.prepare("SELECT estado, COUNT(*) c FROM tasks GROUP BY estado").all();
  const specs: any[] = db.prepare("SELECT COUNT(*) c FROM specs").all();
  console.log(`proyecto: ${root}`);
  console.log(`specs: ${(specs[0] as any)?.c ?? 0} tareas: ${counts.map((c: any) => `${c.estado}=${c.c}`).join(" ") || "0"}`);
  db.close();
}

export function cmdValidate(root: string): void {
  const db = openDb(root);
  const tasks: any[] = db.prepare("SELECT * FROM tasks").all();
  let errors = 0;
  for (const t of tasks) {
    const r = TaskContract.safeParse(t);
    if (!r.success) { console.error(`INVALID ${t.id}: ${r.error.issues.map((i) => i.message).join("; ")}`); errors++; }
  }
  let dirs: string[] = [];
  try { dirs = readdirSync(join(root, "specs", "active"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* vacío ok */ }
  for (const d of dirs) {
    if (!existsSync(join(root, "specs", "active", d, "spec.md"))) { console.error(`INVALID spec ${d}: falta spec.md`); errors++; }
  }
  db.close();
  if (errors > 0) { console.error(`validate-spec: ${errors} errores`); process.exit(1); }
  console.log(`validate-spec OK: ${tasks.length} tareas, ${dirs.length} specs activas`);
}

// Preflight (F9, de harness2 check.py): comprueba dependencias y config antes de gastar.
export function preflight(root: string): { ok: boolean; lineas: string[] } {
  const lineas: string[] = [];
  const pon = (nombre: string, ok: boolean, detalle = ""): void => {
    lineas.push(`${ok ? "ok" : "FALLO"} ${nombre}${detalle ? `: ${detalle}` : ""}`);
  };
  try {
    const g = JSON.parse(readFileSync(join(root, "policies.global.json"), "utf8")) as { techo?: { rondas?: unknown } };
    pon("políticas", typeof g?.techo?.rondas === "number", typeof g?.techo?.rondas === "number" ? "" : "techo.rondas ausente");
  } catch (e) {
    pon("políticas", false, e instanceof Error ? e.message : String(e));
  }
  try {
    const a = JSON.parse(readFileSync(join(root, "adapters.config.json"), "utf8")) as { proveedor?: unknown };
    const provs = ["off", "ollama", "litellm", "openai", "anthropic", "google", "openrouter"];
    pon("adapters", typeof a?.proveedor === "string" && provs.includes(a.proveedor), typeof a?.proveedor === "string" && provs.includes(a.proveedor) ? "" : "proveedor inválido");
  } catch {
    pon("adapters", false, "ausente o ilegible (el spawn fallará en fail closed)");
  }
  try {
    const g = JSON.parse(readFileSync(join(root, "agents.config.json"), "utf8")) as { agentes?: unknown; aristas?: unknown };
    const ag = Array.isArray(g?.agentes) ? (g.agentes as { id?: unknown }[]) : undefined;
    const ar = Array.isArray(g?.aristas) ? (g.aristas as { de?: unknown; a?: unknown }[]) : undefined;
    const ids = new Set((ag ?? []).map((x) => x.id));
    const rotas = (ar ?? []).filter((e) => !ids.has(e.de) || !ids.has(e.a));
    pon("agents", !!ag && rotas.length === 0, !ag ? "usa los agentes por defecto" : rotas.length ? "aristas rotas" : "");
  } catch {
    pon("agents", true, "usa los agentes por defecto");
  }
  try {
    const sup = validarTodasSuperficies();
    const mal = sup.filter((s) => !s.ok);
    pon("modulos", mal.length === 0, mal.length ? mal.map((s) => `${s.nombre}: ${s.errores.join("; ")}`).join(" | ") : `${sup.length} superficies ok`);
  } catch (e) {
    pon("modulos", false, e instanceof Error ? e.message : String(e));
  }
  const t = checkTecho(root, 1, 2, 2);
  pon("techo", t.ok, t.motivo);
  try {
    const db = openDb(root);
    db.close();
    pon("sqlite", true, "axiom.db escribible");
  } catch (e) {
    pon("sqlite", false, e instanceof Error ? e.message : String(e));
  }
  return { ok: lineas.every((l) => l.startsWith("ok")), lineas };
}

export function cmdCheck(root: string, tool?: string, agente?: string): void {
  if (!tool) {
    const p = preflight(root);
    for (const l of p.lineas) console.log(`check ${l}`);
    if (!p.ok) process.exit(2);
    return;
  }
  // Con --agente la decisión se cruza con lo que ese agente declara.
  const declaracion = agente ? declaracionDeHerramienta(root, agente, tool) : undefined;
  const r = check(root, tool, undefined, declaracion);
  const quien = agente ? ` (agente ${agente})` : "";
  console.log(`check ${tool}${quien}: ${r.decision} (riesgo=${r.riesgo}) — ${r.motivo}${r.id ? ` id=${r.id}` : ""}`);
  if (r.decision === "deny") process.exit(2);
}

export function cmdExperiencia(root: string, limite?: string): void {
  const n = limite ? parseInt(limite, 10) : 5;
  console.log(textoExperiencia(root, Number.isInteger(n) ? n : 5));
}

export function cmdProponerHarness(root: string, taskId?: string): void {
  const m = proponerAjuste(root, taskId);
  console.log(m);
  if (/^uso: axiom|inexistente/.test(m)) process.exit(2);
}

export function cmdPropuestasHarness(root: string): void {
  console.log(textoPropuestas(root));
}

export function cmdVerPropuesta(root: string, id?: string): void {
  const m = verPropuesta(root, id);
  console.log(m);
  if (/^uso: axiom|inexistente/.test(m)) process.exit(2);
}

export function cmdDecidirPropuesta(root: string, id: string | undefined, ok: boolean): void {
  const m = decidirPropuesta(root, id, ok);
  console.log(m);
  if (/^uso: axiom|inexistente|ya /.test(m)) process.exit(2);
}

// Datos de un módulo sin cablearlo: importa su index.ts por nombre (validado
// contra conocidos) y llama a `datosModulo(root)` si lo exporta. Sin export,
// fail soft con cómo declararlo. Apagado = 409/rehúsa como el resto del módulo.
export async function cmdModuloDatos(root: string, nombre?: string): Promise<void> {
  const n = (nombre ?? "").trim();
  if (!n) { console.error("uso: axiom module datos <nombre>"); process.exit(2); }
  if (!nombresConocidos().some((c) => c.nombre === n)) { console.error(`módulo desconocido: ${n}`); process.exit(2); }
  if (!moduloActivo(root, n)) { console.error(`módulo ${n} deshabilitado (fail closed): habilítalo con \`axiom module on ${n}\``); process.exit(2); }
  try {
    const m = await import(`./modules/${n}/index.js`) as { datosModulo?: unknown };
    if (typeof m.datosModulo !== "function") {
      console.log(`módulo ${n}: sin datos (declara datosModulo(root) en src/modules/${n}/index.ts)`);
      return;
    }
    console.log(JSON.stringify((m.datosModulo as (root: string) => unknown)(root), null, 2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pista = /Cannot find module/.test(msg) ? " ¿compilaste? (npx tsc)" : "";
    console.error(`módulo ${n}: no se pudo cargar (${msg}).${pista}`);
    process.exit(2);
  }
}

export function cmdModuloCrear(root: string, nombre?: string, tipo?: string, descripcion?: string): void {
  void root;
  const m = crearModulo(nombre, tipo, descripcion);
  console.log(m);
  if (/^uso: axiom|inválido|no se pudo|no se encontró/.test(m)) process.exit(2);
}

export function cmdModuloRegen(root: string, nombre?: string): void {
  void root;
  const m = regenModulo(nombre);
  console.log(m);
  if (/^uso: axiom|desconocido|ilegible|no se pudo|inválido/.test(m)) process.exit(2);
}

export function cmdCompat(root: string, nombre?: string): void {
  void root;
  const m = textoCompat(nombre);
  console.log(m);
  if (/DESACTUALIZADO/.test(m)) process.exit(2);
}

export function cmdSnapshot(root: string, runId?: string): void {
  const m = textoSnapshot(root, runId ?? "");
  console.log(m);
  if (/^uso: axiom|sin snapshot/.test(m)) process.exit(2);
}

export function cmdUi(root: string): void {
  console.log(renderOrquestacion(root));
  console.log("");
  console.log(renderTrabajo(root));
}

export { crear, evaluar, rollback, marcarEstable, listar, remove };

// F11b: spawn con consumo real — lo medido (o estimado ~4char/tok) va a consumo global.
export async function cmdSpawn(root: string, task: string, timeoutMs?: number): Promise<string> {
  const s = await adaptersSpawn(root, task, timeoutMs ? { timeoutMs } : {});
  if (s.uso) { addConsumo(root, s.uso.total, 1); recordUso(root, s.uso); }
  return formatSpawn(s);
}

// Fase D-full: evaluación aislada en Docker. Sin --cmd, vale el veredicto explícito.
// Con --cmd, el sandbox decide salvo veredicto explícito pass|fail (que prevalece y se audita).
export async function cmdEvalComp(root: string, nombre?: string, ver?: string, verdictArg?: string, cmdStr?: string, image?: string): Promise<string> {
  if (!nombre || !ver) return "uso: axiom comp eval <nombre> <ver> [pass|fail] [--cmd \"...\"] [--image img]";
  const explicito = verdictArg === "pass" ? true : verdictArg === "fail" ? false : undefined;
  if (!existeComp(root, nombre, ver)) return `componente ${nombre}@${ver} no existe`;
  let evidencia = "";
  let ok = explicito ?? true;
  if (cmdStr) {
    const r = await sandboxRun(root, [cmdStr], image ? { image } : {});
    if (r.code === 2 && /no permitida|exige aprobación/.test(r.out)) return r.out;
    evidencia = `sandbox exit=${r.code} out=${r.out.slice(0, 200)}`;
    if (explicito === undefined) ok = r.code === 0;
  }
  return evaluar(root, nombre, ver, ok, evidencia);
}

export function cmdRemoveComp(root: string, nombre?: string, ver?: string): string {
  if (!nombre || !ver) return "uso: axiom comp remove <nombre> <ver>";
  return remove(root, nombre, ver);
}

export function cmdDiffComp(root: string, nombre?: string): string {
  if (!nombre) return "uso: axiom comp diff <nombre>";
  return diffComp(root, nombre);
}

// AXM-050: misma batería en sandbox contra estable y candidata; decide el resultado medido, no la nota.
// La batería recibe AXIOM_COMP_VER=<ver> vía --env Docker (no por prefijo shell, que expandiría antes); no auto-activa.
export function cmdBatterySet(root: string, nombre?: string, cmdStr?: string, image?: string): string {
  if (!nombre || !cmdStr) return 'uso: axiom comp battery set <nombre> --cmd "..." [--image img]';
  if (image) { const mal = imagenPermitida(image); if (mal) return mal; }
  return guardarBateria(root, nombre, cmdStr, image);
}

export function cmdBatteryShow(root: string, nombre?: string): string {
  if (!nombre) return "uso: axiom comp battery show <nombre>";
  if (!existeNombre(root, nombre)) return `componente ${nombre} no existe`;
  const b = verBateria(root, nombre);
  if (!b) return `sin batería canónica para ${nombre} — comp compare usará la por defecto de su scope (o guarda una con: comp battery set ${nombre} --cmd "...")`;
  return `batería ${nombre}: cmd=${b.cmd}${b.image ? ` image=${b.image}` : ""}`;
}

export function cmdBatteryList(root: string): string {
  const rows = listarBaterias(root);
  if (rows.length === 0) return "(sin baterías canónicas)";
  return rows.map((r) => `${r.nombre}: cmd=${r.cmd}${r.image ? ` image=${r.image}` : ""}`).join("\n");
}

export function cmdBatteryClear(root: string, nombre?: string): string {
  if (!nombre) return "uso: axiom comp battery clear <nombre>";
  return borrarBateria(root, nombre);
}

export async function cmdCompareComp(root: string, nombre?: string, cmdStr?: string, image?: string): Promise<string> {
  if (!nombre) return 'uso: axiom comp compare <nombre> [--cmd "..."] [--image img]';
  // Resolución: --cmd explícito > batería guardada > batería por defecto del scope. Nunca pide configurar.
  let cmd = cmdStr;
  let img = image;
  let origen = "explícita";
  if (!cmd) {
    const b = verBateria(root, nombre);
    if (b && b.cmd) {
      cmd = b.cmd;
      if (!img) img = b.image || undefined;
      origen = "canónica guardada";
    }
  }
  const par = comparables(root, nombre);
  if ("error" in par) return par.error;
  const { estable, cand } = par;
  if (!cmd) {
    const d = bateriaPorDefecto(cand.scope);
    cmd = d.cmd;
    origen = d.motivo;
  }
  const base = img ? { image: img } : {};
  const est = await sandboxRun(root, [cmd], { ...base, env: { AXIOM_COMP_VER: estable.ver } });
  if (est.code === 2 && /no permitida|exige aprobación/.test(est.out)) return est.out;
  const cd = await sandboxRun(root, [cmd], { ...base, env: { AXIOM_COMP_VER: cand.ver } });
  if (cd.code === 2 && /no permitida|exige aprobación/.test(cd.out)) return cd.out;
  let veredicto: string;
  if (cd.code === 0 && est.code !== 0) veredicto = "candidata supera a estable — lista para activar (con rollback disponible)";
  else if (cd.code !== 0 && est.code === 0) veredicto = "candidata regresa (estable sigue ganando) — no activar";
  else if (cd.code !== 0) veredicto = "ambas fallan — no activar";
  else if (est.out.trim() === cd.out.trim()) veredicto = "empate medido — activar solo si hay otra razón";
  else veredicto = "ambas pasan con salida distinta — revisar diff antes de activar";
  guardarComparativa(root, { nombre, estable_ver: estable.ver, cand_ver: cand.ver, cmd: `${cmd} [${origen}]`, est_exit: est.code, cand_exit: cd.code, est_out: est.out, cand_out: cd.out, veredicto });
  const corta = (s: string) => s.trim().slice(0, 200) || "-";
  return `compare ${nombre} [batería ${origen}]: [${cand.ver} exit=${cd.code} vs ${estable.ver} exit=${est.code}] ${veredicto}\n- estable out=${corta(est.out)}\n- candidata out=${corta(cd.out)}`;
}

export function cmdServe(root: string, portArg?: string): void {
  const port = portArg ? parseInt(portArg, 10) : 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("puerto inválido"); process.exit(1); }
  startWeb(root, port);
  const keep = setInterval(() => {}, 1000);
  const close = () => { clearInterval(keep); process.exit(0); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

function faltan(o: any, req: string[], donde: string, errores: string[]): void {
  for (const k of req ?? []) if (!(o !== null && typeof o === "object" && k in o)) errores.push(`${donde}: falta clave ${k}`);
}

function refLocal(spec: any, ref: string): any {
  const m = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(ref ?? "");
  if (!m) throw new Error(`$ref no local: ${ref}`);
  const s = spec.components?.schemas?.[m[1]];
  if (!s) throw new Error(`schema inexistente: ${ref}`);
  return s;
}

export function cmdValidateOpenApi(file?: string): void {
  const errores: string[] = [];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidatos = file ? [file] : [join(process.cwd(), "openapi.json"), join(here, "..", "openapi.json")];
  const f = candidatos.find((c) => existsSync(c));
  if (!f) { console.error("no se encontró openapi.json (pásalo como argumento o corre desde la raíz del proyecto)"); process.exit(1); }
  let spec: any;
  try { spec = JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.error(`INVALID openapi: JSON inválido (${e instanceof Error ? e.message : e})`); process.exit(1); }
  if (typeof spec.openapi !== "string" || !spec.openapi.startsWith("3.")) errores.push("openapi: versión 3.x requerida");
  if (!spec.info?.title) errores.push("info.title requerido");
  const paths = spec.paths ?? {};
  for (const p of ["/api/orquestacion", "/api/trabajo"]) {
    const schema = paths[p]?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
    if (!schema) errores.push(`${p}: falta GET 200 application/json`);
  }
  const dec = paths["/api/decide"]?.post;
  if (!dec?.requestBody) errores.push("/api/decide: falta POST requestBody");
  if (!dec?.responses?.["200"] || !dec?.responses?.["409"]) errores.push("/api/decide: faltan respuestas 200/409");
  // conformidad viva: required del spec contra datos reales del mismo store
  try {
    const tmp = mkdtempSync(join(tmpdir(), "ax-openapi-"));
    const o: any = datosOrquestacion(tmp);
    const t: any = datosTrabajo(tmp);
    const sO = refLocal(spec, paths["/api/orquestacion"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref);
    const sT = refLocal(spec, paths["/api/trabajo"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref);
    faltan(o, sO.required, "Orquestacion", errores);
    faltan(o.techo, sO.properties?.techo?.required, "Orquestacion.techo", errores);
    faltan(t, sT.required, "Trabajo", errores);
    const sD = refLocal(spec, dec?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref);
    faltan({ ok: true, msg: "x" }, sD.required, "DecideOut", errores);
    const sI = refLocal(spec, dec?.requestBody?.content?.["application/json"]?.schema?.$ref);
    if (!(sI.required ?? []).includes("id")) errores.push("DecideIn: id requerido");
  } catch (e) { errores.push(`conformidad: ${e instanceof Error ? e.message : e}`); }
  // deriva spec↔router: todo path /api del spec existe en web.ts
  try {
    const webCandidates = [join(here, "web.ts"), join(process.cwd(), "src", "web.ts")];
    const wf = webCandidates.find((c) => existsSync(c));
    const src = wf ? readFileSync(wf, "utf8") : "";
    for (const p of Object.keys(paths)) if (p.startsWith("/api") && !src.includes(`"${p}"`)) errores.push(`router: ${p} no está en web.ts`);
  } catch (e) { errores.push(`router: ${e instanceof Error ? e.message : e}`); }
  if (errores.length > 0) { for (const e of errores) console.error(`INVALID ${e}`); process.exit(1); }
  console.log(`validate-openapi OK: ${f}`);
}

export function cmdValidateTokens(file?: string): void {
  let f = file;
  if (!f) { try { f = defaultWebSource(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); } }
  const r = validateTokens(f as string);
  if (!r.ok) { for (const e of r.errores) console.error(`INVALID ${e}`); process.exit(1); }
  console.log(`validate-tokens OK: ${f}`);
}

export function cmdCycle(root: string, key?: string): void {
  const r = cicloImproductivo(key ?? "default", root);
  console.log(`cycle ${key ?? "default"}: veces=${r.veces} ciclo=${r.esCiclo ? "SI-escalar" : "no"}`);
  if (r.esCiclo) process.exit(3);
}
