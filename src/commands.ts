// Comandos axiom: toda la lógica antes en cli.ts (composition root delegado).
// Reciben root explícito; cli.ts solo parsea args y despacha.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { addConsumo, getConsumo, listBloqueos, listTrazas, listUsos, openDb, recordBloqueo, recordUso } from "./store.js";
import { TaskContract } from "./contracts.js";
import { SPEC_TEMPLATE, PLAN_TEMPLATE, TASKS_TEMPLATE, VERIFICATION_TEMPLATE, OVERRIDES_README } from "./preset.js";
import { check, decide } from "./broker.js";
import { leerSkill } from "./skills.js";
import { extraerMarcas, responderTodas } from "./modules/clarify/index.js";
import { ejecutarScriptSkill } from "./modules/skills/runner.js";
import { cicloImproductivo, checkTecho } from "./policy.js";
import { huellaConfig, leerMarca, marcarRun, textoSnapshot } from "./runmark.js";
import { asegurarExperience, registrarLeccion, textoExperiencia, proponerAjuste, textoPropuestas, verPropuesta, decidirPropuesta, estadoMemoria, compactarMemoria } from "./experience.js";
import { validarTodasSuperficies, nombresConocidos, moduloActivo, crearModulo, regenModulo, textoCompat } from "./modulos.js";
import { archivosFueraDeAllow, asegurarColumnaArchivos, validarArchivos } from "./staging.js";
import { renderOrquestacion, renderTrabajo, datosOrquestacion, datosTrabajo } from "./ui.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, relative, sep } from "node:path";
import { crear, evaluar, rollback, marcarEstable, listar, remove, existeComp, existeNombre, diff as diffComp, comparables, guardarComparativa, guardarBateria, verBateria, listarBaterias, borrarBateria, bateriaPorDefecto } from "./components.js";
import { sandboxRun, imagenPermitida } from "./sandbox.js";
import { startWeb, validateTokens, defaultWebSource } from "./web.js";
import { spawn as adaptersSpawn, formatSpawn } from "./adapters.js";
import { rondaAgenteGrafo, declaracionDeHerramienta, declaracionDeAprobacion } from "./modules/agents/index.js";
import { capturar } from "./modules/browser/index.js";
import { ejecutar, listarSesiones, esAccion, type RespuestaAccion, type TipoAccion } from "./modules/browser/sesion.js";

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
export function verificar(root: string, taskId: string | undefined, verdictArg: string | undefined, tokens = 100, calls = 1, detalle?: string, juez = "humano", archivosCSV?: string, url?: string, modo?: "png" | "dom"): VerifyResult {
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
  let verdict = verdictArg === "fail" ? "fail" : "pass";
  // Captura browser (--url): primero la evidencia observable, después el
  // veredicto. Si la captura falla no hay evidencia ni cambio de estado
  // (fail closed). El artefacto se escribe en specs/active/<spec>/ junto a
  // verification-<tarea>.md (mismo trato que el propio md: lo genera Axiom).
  const dir = activeDir(root, t.spec_id);
  let captura: { rel: string; sha: string; bytes: number; motor: string } | undefined;
  let errorPagina: string | undefined;
  let timeoutMs: number | undefined;
  if (url) {
    if (!moduloActivo(root, "browser")) return { code: 2, msg: "verify --url: módulo browser deshabilitado (habilítalo con `axiom module on browser`)" };
    const cap = capturar(root, url, modo ?? "png", dir);
    if (!cap.ok || !cap.ruta) return { code: 1, msg: `verify: captura fallida para ${url} — ${cap.error ?? "sin ruta de artefacto"}` };
    const shaCaptura = createHash("sha256").update(readFileSync(cap.ruta)).digest("hex");
    captura = { rel: relative(root, cap.ruta).split(sep).join("/"), sha: shaCaptura, bytes: cap.bytes ?? 0, motor: cap.motor ?? "—" };
    // Página de error del navegador (DNS/conexión/TLS) ≠ URL cargada: si el
    // juez pedía pass, el veredicto se ajusta a fail. Queda constancia en el
    // verification.md, en el motivo de bloqueo y en el mensaje.
    errorPagina = cap.errorPagina;
    // Timeout de red: el motor colgó sin terminar. Hay parte de timeout como
    // evidencia, pero la URL tampoco quedó cargada ⇒ mismo ajuste pass→fail.
    timeoutMs = cap.timeoutMs;
    if ((errorPagina || timeoutMs) && verdict === "pass") verdict = "fail";
  }
  // Texto del motivo negativo (una u otro): página de error o timeout de red.
  const motivo = errorPagina ? `página de error del navegador (${errorPagina})` : timeoutMs ? `timeout de red (el motor superó ${timeoutMs} ms sin terminar la carga)` : undefined;
  const ajuste = motivo && verdictArg !== "fail" ? " → veredicto ajustado de pass a fail" : "";
  const cmd = captura
    ? `axiom verify ${taskId} ${verdict} --url ${url}${modo === "dom" ? " --dom" : ""}`
    : `axiom verify ${taskId} ${verdict}`;
  // Firma: con captura, el sha256 es el del contenido capturado (trazable al
  // byte); sin captura, la firma sintética de siempre.
  const sha = captura ? captura.sha : createHash("sha256").update(`${taskId}:${verdict}:${Date.now()}`).digest("hex");
  // Artefactos declarados: existen y están en allowlist, si no no hay firma.
  const lista = (archivosCSV ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20);
  if (lista.length > 0) {
    const v = validarArchivos(root, lista);
    if (!v.ok) return { code: 2, msg: `verify staging: ${v.fuera.join("; ")}` };
  }
  if (captura) lista.push(captura.rel);
  const archTxt = lista.join("\n");
  mkdirSync(dir, { recursive: true });
  const md = VERIFICATION_TEMPLATE(taskId, verdict, sha, cmd, juez, lista.join(", "))
    + (captura ? `**captura browser:** \`${captura.rel}\` · sha256 \`${captura.sha}\` · ${captura.bytes} B · motor ${captura.motor} · url ${url}\n` : "")
    + (motivo ? `**nota:** ${motivo}${ajuste}\n` : "");
  writeFileSync(join(dir, `verification-${taskId}.md`), md);
  asegurarColumnaArchivos(root);
  const db2 = openDb(root);
  db2.prepare("INSERT INTO evidences(task_id,cmd,exit,sha256,verdict,created_at,archivos) VALUES(?,?,?,?,?,?,?)").run(taskId, cmd, verdict === "pass" ? 0 : 1, sha, verdict, new Date().toISOString(), archTxt);
  db2.close();
  db.prepare("UPDATE tasks SET estado=? WHERE id=?").run(verdict === "pass" ? "verificado" : "bloqueado", taskId);
  db.close();
  addConsumo(root, tokens, calls);
  if (verdict === "fail") recordBloqueo(root, taskId, motivo ? `verify fail ${sha.slice(0, 8)} · ${motivo}` : `verify fail ${sha.slice(0, 8)}`);
  try { registrarLeccion(root, taskId, verdict, juez, motivo ? `${detalle ?? ""} [${motivo}]`.trim() : detalle); } catch { /* la memoria nunca rompe el verify */ }
  return { code: 0, msg: `verify OK: ${taskId} → ${verdict} (${sha.slice(0, 8)}, juez=${juez})${motivo ? ` · ${motivo.toUpperCase()}${ajuste.replace(" → veredicto ajustado de pass a fail", " (veredicto ajustado a fail)")}` : ""}${captura ? ` · captura ${captura.rel}` : ""}` };
}

export function cmdVerify(root: string, taskId?: string, verdictArg?: string, tokens = 100, calls = 1, detalle?: string, juez = "humano", archivosCSV?: string, url?: string, modo?: "png" | "dom"): void {
  if (!taskId) { console.error("uso: axiom verify <task-id> [pass|fail|error] [--tokens N] [--calls M] [--detalle \"...\"] [--archivos \"a,b\"] [--url <url> [--dom]]"); process.exit(1); }
  const r = verificar(root, taskId, verdictArg, tokens, calls, detalle, juez, archivosCSV, url, modo);
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
  // Una ronda bloqueada por el broker no crea trabajo, así que el directorio
  // puede no existir: el informe es justo lo que hay que dejar por escrito.
  mkdirSync(dir, { recursive: true });
  const report = `# Informe ronda ${id} (agente)\n\nIntentos: ${ronda}/${maxRondas}\nTrabajo+juez: ${r.hechas} tarea(s)\nVeredictos: ${r.pass} pass, ${r.fail} fail\nFallo(s): ${r.fallos.join("; ") || "ninguno"}\nQuedan sin evidencia: ${tras.map((t: any) => t.id).join(", ") || "ninguna"}\n\n> Los artefactos del agente son datos revisables (juez=agente en verification.md). Un humano puede re-verificar con axiom verify.\n`;
  writeFileSync(join(dir, `informe-ronda-${ronda}.md`), report);
}

function informarRonda(dir: string, id: string, ronda: number, maxRondas: number, pendientes: any[]): void {
  mkdirSync(dir, { recursive: true });
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

// Núcleo de `axiom build` sin process.exit (tests y web lo reutilizan).
// Corre el pipeline Speckit con el coder LLM real; `--resume` retoma un
// build pausado sin reescribir lo ya hecho.
export interface ResultadoBuildCli { code: number; msg: string }

export async function construirBuild(
  root: string,
  specArg?: string,
  resume = false,
  generarCodigo?: (ruta: string, spec: string) => Promise<string> | string,
): Promise<ResultadoBuildCli> {
  const { resolverSpecBuild, asegurarTasksDesdePlan } = await import("./orchestrator/desde-plan.js");
  let specRel: string;
  try {
    specRel = resolverSpecBuild(specArg);
  } catch (e) {
    return { code: 2, msg: e instanceof Error ? e.message : String(e) };
  }
  // Id de spec activa: asegura tasks.md (reutiliza o deriva UNA vez con el proveedor).
  const m = /^specs\/active\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/tasks\.md$/.exec(specRel);
  if (m && !resume) {
    const { spawn } = await import("./modules/adapters/index.js");
    const puente = await asegurarTasksDesdePlan(root, m[1], async (prompt) => {
      const r = await spawn(root, prompt, { maxChars: 2000, timeoutMs: 60000 });
      if (!r.ok) throw new Error(r.error ?? "proveedor sin respuesta");
      return r.text ?? "";
    });
    if (!puente.ok) return { code: 2, msg: `build: ${puente.error}` };
  }
  const { AgentOrchestrator } = await import("./orchestrator/orchestrator.js");
  const { reanudarBuild } = await import("./orchestrator/resume.js");
  const { generarCodigoLLM } = await import("./nodes/coder-llm.js");
  const gen = generarCodigo ?? ((ruta: string, spec: string) => generarCodigoLLM(root, ruta, spec));
  const lineas: string[] = [`build ${resume ? "reanudado" : "iniciado"}: ${specRel}`];
  const emitir = (e: { type: string; ruta?: string; mensaje?: string; intento?: number }): void => {
    if (e.type === "file_start") lineas.push(`  → ${e.ruta} (intento ${e.intento ?? 1})`);
    else if (e.type === "file_success") lineas.push(`  ✔ ${e.ruta}`);
    else if (e.type === "error") lineas.push(`  ! ${e.ruta ?? "build"}: ${e.mensaje ?? ""}`);
  };
  try {
    const r = resume
      ? await reanudarBuild(root, specRel, { generarCodigo: gen, emitir })
      : await new AgentOrchestrator(root, specRel, { generarCodigo: gen, emitir }).ejecutar();
    const n = Object.keys(r.fallos ?? {}).length;
    lineas.push(r.estado === "completo" ? `build completo: ${r.procesados} archivo(s)` : `build pausado: ${r.procesados} archivo(s), ${n} con fallos`);
    return { code: r.estado === "completo" ? 0 : 1, msg: lineas.join("\n") };
  } catch (e) {
    return { code: 2, msg: `build: ${e instanceof Error ? e.message : e}` };
  }
}

export async function cmdBuild(root: string, specArg?: string, resume = false): Promise<void> {
  const r = await construirBuild(root, specArg, resume);
  const out = r.code === 0 ? console.log : console.error;
  out(r.msg);
  if (r.code !== 0) process.exit(r.code);
}

// Núcleo de `axiom skills run` sin process.exit: ejecuta un script
// determinista de la skill con el runner acotado (timeout, cwd fijado,
// entorno filtrado). Destructivos exigen dryRun.
export interface ResultadoSkillsRun { code: number; msg: string }

export function construirSkillsRun(root: string, id?: string, script?: string, dryRun = false): ResultadoSkillsRun {
  if (!id || !script) return { code: 2, msg: "uso: axiom skills run <id> <script> [--dry-run]" };
  const s = leerSkill(root, id);
  if (!s.ok) return { code: 2, msg: s.error };
  const r = ejecutarScriptSkill(root, id, script, { dryRun });
  const cabeza = `skill ${id} · ${script} · sha ${r.sha256.slice(0, 8)} · ${r.ms}ms`;
  if (!r.ok) return { code: 1, msg: `${cabeza}\nERROR: ${r.error ?? "falló"}\n${r.salida}` };
  return { code: 0, msg: `${cabeza}${r.dryRun ? " [dry-run]" : ""}\n${r.salida}` };
}

export interface ResultadoClarifyCli { code: number; msg: string }

/** Núcleo no interactivo de `axiom clarify` (testeable sin stdin). */
export function construirClarify(spec: string, respuestas: string[]): { code: number; msg: string; markdown: string } {
  const marcas = extraerMarcas(spec);
  if (!marcas.length) return { code: 0, msg: "clarify: sin marcas [NEEDS CLARIFICATION], nada que preguntar", markdown: spec };
  const r = responderTodas(spec, respuestas);
  const lineas = [`clarify: ${r.hechas} respondida(s), ${r.omitidas} omitida(s), ${r.pendientes} pendiente(s)`];
  return { code: 0, msg: lineas.join("\n"), markdown: r.markdown };
}

export async function cmdClarify(root: string, specArg?: string): Promise<void> {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const { extraerMarcas, formatearPregunta, aplicarRespuesta, proponerPreguntas, MAX_PREGUNTAS } = await import("./modules/clarify/index.js");
  if (!specArg) { console.error("uso: axiom clarify <spec> (p. ej. axiom clarify .speckit/build.md)"); process.exit(2); }
  const p = specArg.startsWith("/") ? specArg : `${root}/${specArg}`;
  if (!existsSync(p)) { console.error(`clarify: spec no encontrada: ${specArg}`); process.exit(2); }
  let spec = readFileSync(p, "utf8");
  // Sin marcas, detección propia: el proveedor propone (UNA llamada).
  // Sin preguntas útiles no se toca nada.
  let preguntas = extraerMarcas(spec).slice(0, MAX_PREGUNTAS);
  let auto = false;
  if (!preguntas.length) {
    const { spawn } = await import("./modules/adapters/index.js");
    preguntas = await proponerPreguntas(spec, async (prompt) => {
      const r = await spawn(root, prompt, { maxChars: 2000, timeoutMs: 60000 });
      if (!r.ok) throw new Error(r.error ?? "proveedor sin respuesta");
      return r.text ?? "";
    });
    if (!preguntas.length) { console.log("clarify: sin marcas y sin ambigüedad detectada, nada que preguntar"); return; }
    auto = true;
    console.log(`clarify: sin marcas; el proveedor detectó ${preguntas.length} ambigüedad(es)`);
  }
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pedir = (texto: string): Promise<string> => new Promise((res) => rl.question(texto, res));
  try {
    for (let i = 0; i < preguntas.length; i++) {
      console.log(formatearPregunta(preguntas[i], i + 1, preguntas.length));
      const r = await pedir("Respuesta: ");
      spec = aplicarRespuesta(spec, preguntas[i], r).markdown;
    }
  } finally {
    rl.close();
  }
  writeFileSync(p, spec);
  const resto = auto ? 0 : extraerMarcas(spec).length;
  console.log(`clarify: listo (${resto} marca(s) restante(s)${resto ? ", corre de nuevo o edita a mano" : ""})`);
}

export function cmdSkillsRun(root: string, id?: string, script?: string, dryRun = false): void {
  const r = construirSkillsRun(root, id, script, dryRun);
  const out = r.code === 0 ? console.log : console.error;
  out(r.msg);
  if (r.code !== 0) process.exit(r.code);
}

// Formato de una traza de tool call para la consola: qué, quién, qué decidió,
// cuánto tardó y el IO resumido (AXM-066). Exportado para los tests.
export function lineaTraza(z: { ts: string; origen: string; tool: string; agente: string; decision: string; approval_id: string; entrada: string; salida: string; sha_io: string; contexto: string; ms: number }): string {
  const io = [z.entrada, z.salida].filter(Boolean).join(" → ") || "sin IO";
  return `${z.ts} ${z.origen} ${z.tool}${z.agente ? `(${z.agente})` : ""}: ${z.decision}${z.approval_id ? ` id=${z.approval_id}` : ""} ${z.ms}ms io=${io} sha=${z.sha_io.slice(0, 8)}${z.contexto ? ` [${z.contexto}]` : ""}`;
}

// conTrace: `status --trace` sin id añade las últimas trazas globales (AXM-066).
export function cmdStatus(root: string, traceId?: string, conTrace = false): void {
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
    // Tool calls de ESTA tarea (AXM-066): las trazas cuyo contexto la nombra
    // (p. ej. "run <spec>/<tarea>"). Sin trazas se dice, no se calla.
    const trazas = listTrazas(root, 50, traceId);
    console.log(`trace ${t.id}: spec ${t.spec_id}:${t.spec_ver} estado=${t.estado} evidencia=${ev ? ev.verdict + " " + ev.sha256.slice(0, 8) : "PENDIENTE"} archivos=${arch} verification.md=${existsSync(verFile) ? "sí" : "falta"} juez-fallido=${juezFallo ? "sí (no es fail del trabajo)" : "no"} bloqueos=${bloq.length ? bloq.map((b) => b.causa).join("; ") : "ninguno"} consumo=tokens:${cons.tokens} calls:${cons.calls} usos=${usosTxt} trazas=${trazas.length}`);
    for (const z of trazas) console.log(`  traza ${lineaTraza(z)}`);
    if (trazas.length === 0) console.log("  trazas: ninguna para esta tarea");
    return;
  }
  const counts: any[] = db.prepare("SELECT estado, COUNT(*) c FROM tasks GROUP BY estado").all();
  const specs: any[] = db.prepare("SELECT COUNT(*) c FROM specs").all();
  console.log(`proyecto: ${root}`);
  console.log(`specs: ${(specs[0] as any)?.c ?? 0} tareas: ${counts.map((c: any) => `${c.estado}=${c.c}`).join(" ") || "0"}`);
  db.close();
  if (conTrace) {
    const trazas = listTrazas(root, 10);
    console.log(`trazas: ${trazas.length ? `últimas ${trazas.length}` : "ninguna"}`);
    for (const z of trazas) console.log(`  ${lineaTraza(z)}`);
  }
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
  const r = check(root, tool, undefined, declaracion, { origen: "cli", entrada: { agente: agente ?? null } });
  const quien = agente ? ` (agente ${agente})` : "";
  console.log(`check ${tool}${quien}: ${r.decision} (riesgo=${r.riesgo}) — ${r.motivo}${r.id ? ` id=${r.id}` : ""}`);
  if (r.decision === "deny") process.exit(2);
}

// axiom memory [estado|compact [--keep N] [--dry-run]] — ADR-0005.
// Estado = qué crece y qué ya tiene retención; compact = poda EXPLÍCITA de lo
// que no tiene cota (nunca la auditoría). Dry-run calcula sin escribir.
export function cmdMemory(root: string, sub?: string, keepTxt?: string, dryRun = false): void {
  if (sub === undefined || sub === "estado") {
    console.log(estadoMemoria(root));
    return;
  }
  if (sub !== "compact") {
    console.error("uso: axiom memory [estado|compact [--keep N] [--dry-run]]");
    process.exit(2);
  }
  let keep: number | undefined;
  if (keepTxt !== undefined) {
    keep = parseInt(keepTxt, 10);
    if (!Number.isInteger(keep) || keep < 1) { console.error("--keep debe ser entero >=1"); process.exit(2); }
  }
  const r = compactarMemoria(root, { keepLecciones: keep, dryRun });
  const modo = r.dryRun ? " (dry-run, nada escrito)" : "";
  console.log(
    `memory compact${modo}: EXPERIENCE.md ${r.lecciones.antes} → ${r.lecciones.despues} lecciones (podadas ${r.lecciones.podadas}) · mensajes de sesiones archivadas podados ${r.mensajes.podados} en ${r.mensajes.sesiones} sesión(es) · vacuum ${r.vacuum}`,
  );
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

function masNuevoSrc(dir: string, stampMtime: number): string | null {
  // Recorrido iterativo: primer .ts con mtime posterior al sello, o null.
  try {
    const pila = [dir];
    while (pila.length > 0) {
      const actual = pila.pop() as string;
      let entradas: { name: string; isDirectory(): boolean; isFile(): boolean }[];
      try {
        entradas = readdirSync(actual, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entradas) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const full = join(actual, e.name);
        if (e.isDirectory()) {
          pila.push(full);
        } else if (e.isFile() && e.name.endsWith(".ts")) {
          try {
            if (statSync(full).mtimeMs > stampMtime) return relative(dir, full);
          } catch {
            continue;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function distDesactualizado(): { stale: boolean; motivo: string } {
  // Compara la huella de compilación (dist/.build.json) con src/: si algún
  // .ts es más nuevo que el build, el dist que sirve este proceso va por
  // detrás y el síntoma típico es el críptico
  // `... does not provide an export named ...`. Devuelve el motivo para que
  // cmdServe pueda auto-repararse (reconstruir y reiniciar solo).
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const stampPath = join(here, ".build.json");
    if (!existsSync(stampPath)) {
      return { stale: true, motivo: "dist sin huella de compilación" };
    }
    let stampMtime = 0;
    try {
      stampMtime = statSync(stampPath).mtimeMs;
    } catch {
      return { stale: false, motivo: "" };
    }
    // dist/*.js -> ../src/*.ts respecto al repo.
    const repoSrc = join(here, "..", "src");
    const masNuevo = masNuevoSrc(repoSrc, stampMtime);
    if (masNuevo) {
      return { stale: true, motivo: `dist desactualizado (${masNuevo} es más nuevo que el build)` };
    }
    return { stale: false, motivo: "" };
  } catch {
    return { stale: false, motivo: "" };
  }
}

export function cmdServe(root: string, portArg?: string): void {
  const port = portArg ? parseInt(portArg, 10) : 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("puerto inválido"); process.exit(1); }
  // Auto-reparación para usuarios no técnicos: si el dist va por detrás de
  // src/, se reconstruye solo y se reinicia sobre el código fresco. El
  // usuario solo ve una línea de "reconstruyendo" y el servidor levanta.
  // AXIOM_SERVE_REBUILT evita un bucle si el rebuild no deja huella.
  if (!process.env.AXIOM_SERVE_REBUILT) {
    const { stale, motivo } = distDesactualizado();
    if (stale) {
      console.error(`axiom serve: ${motivo} — reconstruyendo solo, un momento...`);
      try {
        const here = dirname(fileURLToPath(import.meta.url));
        const repoRoot = join(here, "..");
        const r = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit", timeout: 240000 });
        if (r.status === 0) {
          console.error("axiom serve: reconstruido — reiniciando sobre el código fresco...");
          const cliPath = join(here, "cli.js");
          const hijo = spawn(process.execPath, [cliPath, "--root", root, "serve", String(port)], {
            stdio: "inherit",
            env: { ...process.env, AXIOM_SERVE_REBUILT: "1" },
          });
          hijo.on("exit", (code) => process.exit(code ?? 0));
          return;
        }
        console.error("axiom serve: la reconstrucción automática falló — arranco igual, pero si ves `does not provide an export named`, avísame.");
      } catch {
        console.error("axiom serve: no pude reconstruir solo — arranco igual con lo que hay.");
      }
    }
  }
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

// Fachadas de las sesiones de navegador (ADR-0006): la CLI y la web (y cualquier
// caller) pasan por aquí para que validación, broker.check y límites sean únicos.
export function browserSesiones(): { sesiones: ReturnType<typeof listarSesiones> } {
  return { sesiones: listarSesiones() };
}

// Valida la acción que manda la web sin que web.ts importe el módulo: la lista
// vive en sesion.ts (claves de los contratos) y aquí solo se expone el guard.
export function esAccionBrowser(x: unknown): x is TipoAccion {
  return esAccion(x);
}

export async function browserAccion(
  root: string,
  accion: TipoAccion,
  args: Record<string, unknown>,
  origen = "cli",
): Promise<RespuestaAccion> {
  const sesion = typeof args.sesion === "string" && args.sesion.trim() ? args.sesion.trim() : undefined;
  return ejecutar(root, accion, args, {
    origen,
    entrada: { accion, ...(sesion ? { sesion } : {}) },
    contexto: sesion ? `sesion ${sesion}` : `browser ${accion}`,
  });
}

export function cmdCycle(root: string, key?: string): void {
  const r = cicloImproductivo(key ?? "default", root);
  console.log(`cycle ${key ?? "default"}: veces=${r.veces} ciclo=${r.esCiclo ? "SI-escalar" : "no"}`);
  if (r.esCiclo) process.exit(3);
}
