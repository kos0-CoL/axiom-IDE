// Sesiones de navegador conducibles (ADR-0006): el agente abre, navega, hace
// clic, escribe y lee texto dentro de una sesión con límites duros. Toda acción
// pasa por `broker.check` (decisión única, traza por tool call, aprobaciones de
// un solo uso). Transporte CDP por pipe (`--remote-debugging-pipe` sobre fd 3/4,
// JSON delimitado por \0): sin dependencias npm nuevas; si no hay motor, fail
// closed con el mismo texto que ya usa la captura.
//
// Fuentes de verdad: las sesiones VIVAS viven en memoria (procesos efímeros);
// el dispositivo de captura/la raíz del proyecto conserva sus artefactos.
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { check, consumirAprobacionManual, type LlamadaTrazable } from "../../broker.js";
import { ToolContract } from "../../contracts.js";
import { MotorBrowser, detectarMotor, leerConfig } from "./index.js";

export type TipoAccion = "abrir" | "nav" | "click" | "type" | "wait" | "text" | "shot" | "cerrar";

const CONTRATOS: Record<TipoAccion, ToolContract> = {
  abrir: { name: "browser.abrir", description: "Abre una sesión de navegador dirigida por el agente.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  nav: { name: "navegar", description: "Navega la sesión a una URL http(s).", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  click: { name: "clic", description: "Hace clic en el primer elemento que casa con el selector.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  type: { name: "escribir", description: "Escribe un texto en el campo que casa con el selector.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  wait: { name: "esperar", description: "Espera a que aparezca un selector, llegue una URL o pase un tiempo.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  text: { name: "leerTexto", description: "Devuelve el texto visible (acotado) de la página o de un selector.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  shot: { name: "capturar", description: "Guarda un screenshot de la sesión como evidencia.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  // `cerrar` es riesgo BAJO (ADR-0006): solo libera el proceso efímero de la
  // sesión, no toca la página ni el disco del proyecto. Si exigiera permiso, una
  // política que apagara la herramienta dejaría un navegador huérfano corriendo
  // sin forma de cerrarlo; el interruptor real es el módulo.
  cerrar: { name: "browser.cerrar", description: "Cierra la sesión y su proceso de navegador.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
};

// Acciones válidas de una sesión (fuente única: las claves de los contratos).
// La web las usa para validar el cuerpo del POST sin importar este módulo.
export const ACCIONES: TipoAccion[] = Object.keys(CONTRATOS) as TipoAccion[];

export function esAccion(x: unknown): x is TipoAccion {
  return typeof x === "string" && (ACCIONES as string[]).includes(x);
}

export interface LimitesSesion { maxAcciones: number; maxMs: number; timeoutMs: number; dominios: string[]; noSandbox?: boolean }

function limitesDe(root: string): LimitesSesion {
  const cfg = leerConfig(root);
  let s: Record<string, unknown> = {};
  try { s = (JSON.parse(readFileSync(join(root, "browser.config.json"), "utf8")) as Record<string, unknown>).sesiones as Record<string, unknown> ?? {}; } catch { /* defectos */ }
  const num = (v: unknown, lo: number, hi: number, defecto: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), lo), hi) : defecto;
  const dominios = Array.isArray(s.dominios) ? (s.dominios as unknown[]).filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim().toLowerCase()).slice(0, 32) : [];
  return { maxAcciones: num(s.maxAcciones, 1, 500, 30), maxMs: num(s.maxMs, 60_000, 3_600_000, 600_000), timeoutMs: num(s.timeoutMs, 1_000, 60_000, 20_000), dominios, noSandbox: cfg.noSandbox };
}

function hostOk(url: string, l: LimitesSesion): string | undefined {
  if (!l.dominios.length) return undefined;
  let h: string;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return `URL ilegible: ${url.slice(0, 120)}`; }
  const ok = l.dominios.some((d) => h === d || h.endsWith(`.${d}`));
  return ok ? undefined : `dominio «${h}» fuera de la allowlist (permitidos: ${l.dominios.join(", ")})`;
}

// --- CDP por pipe: JSON delimitado por \0 en fd entrada(escritura del hijo)/salida ---
type Pendiente = { resolver: (r: { ok: boolean; error?: string; result?: unknown }) => void; timer: NodeJS.Timeout };

interface Conductor {
  id: string;
  proceso: ChildProcess;
  entrada: NodeJS.WritableStream;
  sesion: string | undefined; // sessionId CDP (flat) de la pestaña objetivo
  limiteAcciones: number;
  acciones: number;
  creado: number;
  url: string;
  motor: MotorBrowser;
  limites: LimitesSesion;
}

const sesiones = new Map<string, Conductor>();
const LIMITE_ABIERTAS = 4;
const LIMITE_ACCIONES = 30;
const LIMITE_MS = 15 * 60_000;
const LIMITE_TEXTO = 4_000;
const dirCapturasSesiones = join(tmpdir(), "axiom-browser-sesiones");

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function nuevoConductor(motor: MotorBrowser, args: string[], limites: LimitesSesion, url: string): Conductor {
  const proc = spawn(motor.ruta, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const entrada = (proc.stdio[3] as NodeJS.WritableStream)!;
  const salida = proc.stdio[4] as NodeJS.ReadableStream;
  const id = Math.random().toString(36).slice(2, 10);
  const pendientes = new Map<number, Pendiente>();
  let buffer = "";
  let terminado = false;

  // Un motor que muere (p. ej. sin sandbox disponible) reinicia sus pipes: sin
  // estos oyentes el ECONNRESET no manejado tiraría la llamada entera.
  const terminar = (): void => {
    if (terminado) return;
    terminado = true;
    for (const [, p] of pendientes) { clearTimeout(p.timer); p.resolver({ ok: false, error: "proceso de navegador terminado" }); }
    pendientes.clear();
    sesiones.delete(id);
  };
  entrada.on("error", () => { /* pipe roto: lo cubre terminar() */ });
  salida.on("error", () => { /* idem */ });
  proc.on("error", terminar);

  salida.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf("\0")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!raw.trim()) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try { msg = JSON.parse(raw); } catch { continue; }
      if (typeof msg.id === "number" && pendientes.has(msg.id)) {
        const p = pendientes.get(msg.id)!;
        clearTimeout(p.timer);
        pendientes.delete(msg.id);
        if (msg.error) p.resolver({ ok: false, error: msg.error.message ?? "error CDP" });
        else p.resolver({ ok: true, result: msg.result });
      }
    }
  });

  proc.on("exit", terminar);

  let correlativo = 1;
  const enviar = (metodo: string, params: object, sesion?: string): Promise<{ ok: boolean; error?: string; result?: unknown }> =>
    new Promise((resolver) => {
      if (terminado) { resolver({ ok: false, error: "proceso de navegador terminado" }); return; }
      const idMsg = correlativo++;
      const timer = setTimeout(() => { pendientes.delete(idMsg); resolver({ ok: false, error: `timeout CDP ${metodo}` }); }, limites.timeoutMs);
      pendientes.set(idMsg, { resolver, timer });
      // El proceso pudo morir entre la comprobación y el registro: si ya no
      // vive, nadie va a responder y no tiene sentido esperar el timeout.
      if (terminado) { clearTimeout(timer); pendientes.delete(idMsg); resolver({ ok: false, error: "proceso de navegador terminado" }); return; }
      const payload: Record<string, unknown> = { id: idMsg, method: metodo, params };
      if ((sesion && metodo.startsWith("Page.")) || (sesion && metodo.startsWith("Runtime.")) || (sesion && metodo.startsWith("Input."))) payload.sessionId = sesion;
      try { entrada.write(JSON.stringify(payload) + "\0"); } catch { clearTimeout(timer); pendientes.delete(idMsg); resolver({ ok: false, error: "pipe CDP cerrado" }); }
    });

  const conductor: Conductor = {
    id, proceso: proc, entrada, sesion: undefined, limiteAcciones: limites.maxAcciones, acciones: 0, creado: Date.now(), url, motor, limites,
  } as Conductor;
  (conductor as Conductor & { enviar: typeof enviar }).enviar = enviar;
  return conductor;
}

type ConductorConEnviar = Conductor & { enviar: (m: string, p: object, s?: string) => Promise<{ ok: boolean; error?: string; result?: unknown }> };

function conEnviar(c: Conductor): ConductorConEnviar { return c as ConductorConEnviar; }

async function attachTarget(c: ConductorConEnviar): Promise<string | undefined> {
  const t = await c.enviar("Target.getTargets", {});
  if (!t.ok || !t.result) return undefined;
  const infos = ((t.result as { targetInfos?: { targetId: string; type: string; sessionId?: string }[] }).targetInfos) ?? [];
  const page = infos.find((x) => x.type === "page");
  if (!page) return undefined;
  const a = await c.enviar("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  if (!a.ok || !a.result) return undefined;
  const sid = (a.result as { sessionId?: string }).sessionId;
  if (sid) return sid;
  const l = await c.enviar("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  if (!l.ok) return undefined;
  return undefined;
}

async function urlActual(c: ConductorConEnviar): Promise<string> {
  if (!c.sesion) return "";
  const r = await c.enviar("Runtime.evaluate", { expression: "location.href", returnByValue: true }, c.sesion);
  if (!r.ok || !r.result) return "";
  return String((r.result as { result?: { value?: unknown } }).result?.value ?? "");
}

async function navegar(c: ConductorConEnviar, url: string): Promise<{ ok: boolean; error?: string; url?: string }> {
  if (!c.sesion) return { ok: false, error: "sin pestaña activa" };
  const r = await c.enviar("Page.navigate", { url }, c.sesion);
  if (!r.ok) return { ok: false, error: r.error };
  // Espera a que el documento termine de cargar: leer antes puede devolver la
  // página vacía y presentarla como si fuera la evidencia (fail closed).
  const limite = Date.now() + Math.max(1_000, Math.min(c.limites.timeoutMs, 20_000));
  while (Date.now() < limite) {
    const e = await c.enviar("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, c.sesion);
    if (!e.ok) return { ok: false, error: e.error };
    if ((e.result as { result?: { value?: unknown } })?.result?.value === "complete") break;
    await sleep(150);
  }
  const final = await urlActual(c);
  return { ok: true, url: final || url };
}

async function evaluar(c: ConductorConEnviar, expr: string): Promise<{ ok: boolean; error?: string; valor?: string }> {
  if (!c.sesion) return { ok: false, error: "sin pestaña activa" };
  const r = await c.enviar("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, c.sesion);
  if (!r.ok) return { ok: false, error: r.error };
  const v = (r.result as { result?: { value?: unknown } }).result?.value;
  return { ok: true, valor: typeof v === "string" ? v : JSON.stringify(v ?? "") };
}

function textoAcotado(t: string): string {
  const l = (t || "").replace(/\s+/g, " ").trim();
  return l.length > LIMITE_TEXTO ? `${l.slice(0, LIMITE_TEXTO)}…` : l;
}

// --- Presupuesto de sesión (dureza: nada de política lo levanta) ---
function techoSesion(c: Conductor): string | undefined {
  const edad = Date.now() - c.creado;
  if (c.acciones >= c.limiteAcciones) return `sesión ${c.id} agotada (${c.acciones}/${c.limiteAcciones} acciones): ciérrala con \`axiom browser cerrar\` y ábrela otra (action limit reached: no more actions allowed)`;
  if (edad > c.limites.maxMs) return `sesión ${c.id} vencida (${Math.round(edad / 1000)}s > ${c.limites.maxMs / 1000}s): ciérrala y ábrela otra (time limit reached)`;
  if (!c.sesion) return `sesión ${c.id} sin pestaña activa (el motor no respondió) (page not active)`;
  return undefined;
}

export interface RespuestaAccion { ok: boolean; code: number; msg: string; datos?: Record<string, unknown> }
function err(code: number, msg: string): RespuestaAccion { return { ok: false, code, msg }; }
interface Normalizada { url?: string; selector?: string; texto?: string; ms?: number }

// Lista las sesiones VIVAS de ESTE proceso (fuente de verdad, no espejo en disco);
// limpia las que murieron.
export function listarSesiones(): { id: string; url: string; motor: string; acciones: number; creada: string; viva: boolean }[] {
  for (const [id, c] of [...sesiones]) if (c.proceso.killed) sesiones.delete(id);
  return [...sesiones.values()].map((c) => ({ id: c.id, url: c.url, motor: c.motor.nombre, acciones: c.acciones, creada: new Date(c.creado).toISOString(), viva: true }));
}

function porId(id?: string): Conductor | { error: string } {
  if (id && sesiones.has(id)) return sesiones.get(id)!;
  const ultima = [...sesiones.values()].sort((a, b) => b.creado - a.creado)[0];
  if (ultima) return ultima;
  return { error: "sin sesión de navegador: ábrela con `axiom browser abrir <url>`" };
}

// --- Acciones sobre la pestaña viva (todas acotadas y sin lanza) ---
async function accionPagina(c: Conductor, a: TipoAccion, n: Normalizada): Promise<RespuestaAccion> {
  const cc = conEnviar(c);
  if (!c.sesion) return err(2, "la sesión no tiene pestaña activa");
  switch (a) {
    case "nav": {
      const r = await navegar(cc, n.url!);
      if (!r.ok) return err(1, `navegación fallida: ${r.error ?? "sin detalle"}`);
      const final = r.url ?? n.url!;
      const fuera = hostOk(final, c.limites);
      if (fuera) return err(2, `la redirección salió de la allowlist: ${fuera}`);
      return { ok: true, code: 0, msg: `navegado a ${final}`, datos: { url: final } };
    }
    case "click": case "type": {
      const sel = JSON.stringify(n.selector ?? "");
      const cuerpo = a === "type"
        ? `e.value=${JSON.stringify(n.texto ?? "")};e.dispatchEvent(new Event("input",{bubbles:true}));`
        : "e.click();";
      const expr = `(()=>{const e=document.querySelector(${sel});if(!e)return "SIN ELEMENTO";${cuerpo}return "OK";})()`;
      const r = await evaluar(cc, expr);
      if (!r.ok) return err(1, r.error ?? "falló la acción en la página");
      if (r.valor !== "OK") return err(2, `selector no encontrado: ${n.selector}`);
      return { ok: true, code: 0, msg: `${a === "type" ? "escrito" : "clic"} sobre ${n.selector}` };
    }
    case "wait": {
      if (n.ms !== undefined) {
        await sleep(Math.min(Math.max(n.ms, 0), 60_000));
        return { ok: true, code: 0, msg: `esperados ${n.ms} ms` };
      }
      if (n.url) {
        const r = await navegar(cc, n.url);
        if (r.ok) return { ok: true, code: 0, msg: `url alcanzada: ${r.url ?? n.url}` };
        const fuera = hostOk(r.url ?? n.url, c.limites);
        if (fuera) return err(2, `la redirección salió de la allowlist: ${fuera}`);
        return err(1, "la url no cargó");
      }
      const expr = `document.querySelector(${JSON.stringify(n.selector)})?"SI":"NO"`;
      const limite = Date.now() + 15_000;
      let r = await evaluar(cc, expr);
      while (r.ok && r.valor !== "SI" && Date.now() < limite) {
        await sleep(250);
        r = await evaluar(cc, expr);
      }
      return r.ok && r.valor === "SI"
        ? { ok: true, code: 0, msg: `selector presente: ${n.selector}` }
        : err(1, `selector no apareció en 15 s: ${n.selector}`);
    }
    case "text": {
      const expr = n.selector
        ? `(document.querySelector(${JSON.stringify(n.selector)})||{}).innerText||""`
        : `document.body.innerText||""`;
      const r = await evaluar(cc, expr);
      if (!r.ok) return err(1, r.error ?? "no se pudo leer la página");
      const t = textoAcotado(r.valor ?? "");
      return { ok: true, code: 0, msg: t, datos: { texto: t } };
    }
    case "shot": {
      const r = await cc.enviar("Page.captureScreenshot", { format: "png" }, c.sesion);
      if (!r.ok || !r.result) return err(1, r.error ?? "sin captura del navegador");
      const b64 = String((r.result as { data?: string }).data ?? "");
      if (!b64) return err(1, "el navegador devolvió una captura vacía");
      const png = Buffer.from(b64, "base64");
      const dir = join(dirCapturasSesiones, c.id);
      mkdirSync(dir, { recursive: true });
      const archivo = join(dir, `${Date.now()}.png`);
      writeFileSync(archivo, png);
      return { ok: true, code: 0, msg: `captura ${png.length} B → ${archivo}`, datos: { ruta: archivo, bytes: png.length } };
    }
    case "abrir": case "cerrar":
      return err(2, `${a} no corre como acción de sesión`);
  }
}

// --- Validación previa (antes del broker: malformada no es tool call) ---
function normalizar(a: TipoAccion, args: Record<string, unknown>): Normalizada & { error?: string } {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const url = str(args.url);
  const selector = str(args.selector) || str(args.css);
  const texto = typeof args.texto === "string" ? args.texto : "";
  const ms = typeof args.ms === "number" && Number.isFinite(args.ms) ? Math.round(args.ms) : undefined;
  if ((a === "abrir" || a === "nav") && !/^https?:\/\/[^\s]+$/i.test(url)) return { error: `URL inválida (se espera http/https): ${url || "(vacía)"}` };
  if ((a === "click" || a === "type") && !selector) return { error: `selector requerido (p. ej. "#guardar")` };
  if (a === "type" && !texto) return { error: "texto requerido para escribir" };
  if (a === "wait" && !selector && !url && ms === undefined) return { error: "espera sin objeto: pasa selector, url o ms" };
  if (ms !== undefined && (ms < 0 || ms > 60_000)) return { error: "ms fuera de rango (0-60000)" };
  return { url, selector, texto, ms };
}

function hostPermitido(url: string, c: Conductor): string | undefined {
  return hostOk(url, c.limites);
}

// --- Punto de entrada único (CLI, web y agente pasan por aquí) ---
// Patrón consumir→check de autorizarUso, sin agente: la concesión vigente de
// (herramienta, fila sin agente) autoriza un solo uso.
export async function ejecutar(
  root: string,
  a: TipoAccion,
  args: Record<string, unknown>,
  llamada: LlamadaTrazable = {},
): Promise<RespuestaAccion> {
  const limites = limitesDe(root);
  const n = normalizar(a, args);
  if (n.error) return err(2, n.error);
  const cc = (x?: Conductor): ConductorConEnviar | undefined => x ? conEnviar(x) : undefined;

  let c: Conductor | undefined;
  if (a !== "abrir") {
    const id = typeof args.sesion === "string" && args.sesion.trim() ? args.sesion.trim() : undefined;
    const buscado = porId(id);
    if ("error" in buscado) return err(2, buscado.error);
    c = buscado;
    if (a !== "cerrar") {
      const t = techoSesion(c);
      if (t) return err(2, t);
    }
    if (a === "nav") {
      const fuera = hostOk(n.url!, limites);
      if (fuera) return err(2, fuera);
    }
  } else {
    if (sesiones.size >= LIMITE_ABIERTAS) return err(2, `demasiadas sesiones abiertas (${sesiones.size}/${LIMITE_ABIERTAS}): cierra alguna con \`axiom browser cerrar\``);
    const fuera = hostOk(n.url!, limites);
    if (fuera) return err(2, fuera);
    if (!detectarMotor(root)) return err(2, "sin motor de navegador: instala la caché de Playwright (`npx playwright install chromium`), un Chromium del sistema o declara executablePath en browser.config.json");
  }

  const contrato = CONTRATOS[a];
  const contexto = llamada.contexto ?? (c ? `sesion ${c.id}` : "browser (sin sesión)");
  const entrada = { ...(typeof llamada.entrada === "object" && llamada.entrada ? llamada.entrada as Record<string, unknown> : {}), accion: a, sesion: c?.id ?? "", url: n.url ?? "", selector: n.selector ?? "" };
  const previa = consumirAprobacionManual(root, contrato.name, contexto, llamada.origen ?? "cli");
  const decision = previa
    ? { decision: "allow" as const, motivo: `aprobación ${previa.id} consumida en ${contexto}`, id: previa.id }
    : check(root, contrato.name, contrato, undefined, { origen: llamada.origen ?? "cli", entrada, contexto });
  if (decision.decision === "ask") return err(1, `${contrato.name} necesita aprobación (${decision.id ?? "?"}): ${decision.motivo} — aprueba con \`axiom approve ${decision.id}\` (cada aprobación autoriza un uso)`);
  if (decision.decision === "deny") return err(2, `${contrato.name} denegado (fail closed): ${decision.motivo}`);

  if (a === "abrir") {
    const motor = detectarMotor(root);
    if (!motor) return err(2, "sin motor de navegador: instala la caché de Playwright (`npx playwright install chromium`), un Chromium del sistema o declara executablePath en browser.config.json");
    const argsMotor = [
      "--remote-debugging-pipe",
      "--headless=new",
      "--no-first-run",
      "--disable-gpu",
      `--user-data-dir=${join(tmpdir(), "axiom-browser-profile-" + Math.random().toString(36).slice(2))}`,
      "about:blank",
    ];
    if (limites.noSandbox) argsMotor.push("--no-sandbox");
    const nuevo = nuevoConductor(motor, argsMotor, limites, n.url!);
    const ce = conEnviar(nuevo);
    for (let i = 0; i < 50 && !nuevo.sesion; i++) {
      const sid = await attachTarget(ce);
      if (sid) { nuevo.sesion = sid; break; }
      // Motor muerto (p. ej. sin sandbox): no hay nada que esperar de sus pipes.
      if (nuevo.proceso.exitCode !== null || nuevo.proceso.signalCode !== null) break;
      await sleep(100);
    }
    if (!nuevo.sesion) {
      nuevo.proceso.kill("SIGKILL");
      return err(1, "el navegador no devolvió una pestaña en 5 s");
    }
    // Navegación fallida = sesión inútil: se abre en about:blank y todo lo
    // posterior «lee» una página que no es la pedida. Falla cerrado aquí.
    const nav = await navegar(ce, n.url!);
    if (!nav.ok) {
      nuevo.proceso.kill("SIGKILL");
      return err(1, `no se pudo cargar ${n.url}: ${nav.error ?? "sin detalle"}`);
    }
    // La URL final (tras redirecciones) también cae bajo la allowlist (ADR-0006).
    const fueraFinal = hostOk(nav.url ?? n.url!, limites);
    if (fueraFinal) {
      nuevo.proceso.kill("SIGKILL");
      return err(2, `la redirección salió de la allowlist: ${fueraFinal}`);
    }
    sesiones.set(nuevo.id, nuevo);
    return { ok: true, code: 0, msg: `sesión ${nuevo.id} abierta en ${n.url} (${motor.nombre})`, datos: { sesion: nuevo.id, motor: motor.nombre } };
  }

  if (a === "cerrar") {
    c!.proceso.kill("SIGTERM");
    sesiones.delete(c!.id);
    try { rmSync(join(dirCapturasSesiones, c!.id), { recursive: true, force: true }); } catch { /* best effort */ }
    return { ok: true, code: 0, msg: `sesión ${c!.id} cerrada (${c!.acciones} acciones, proceso terminado)`, datos: { sesion: c!.id } };
  }

  c!.acciones += 1;
  return accionPagina(c!, a, n as Normalizada);
}