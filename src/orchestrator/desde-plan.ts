// Puente plan→tasks — convierte una spec aprobada del chat
// (specs/active/<id>/{spec,plan}.md, texto libre) en el checklist
// `- [ ] ruta` que exige el AgentOrchestrator, y resuelve el argumento de
// build (id de spec o ruta cruda) a la spec efectiva. Sin dependencias
// nuevas: la derivación usa UNA llamada al proveedor vía `preguntar`
// inyectada (producción: `spawn` de adapters); sin respuesta válida falla
// cerrado sin escribir basura. Nunca toca la red por sí mismo.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { leerChecklist } from "../spec/checklist.js";

export type Preguntar = (prompt: string) => Promise<string>;

export interface ResultadoTasks {
  ok: boolean;
  tasksRel?: string;
  archivos?: string[];
  creadas?: boolean;
  error?: string;
}

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Rutas relativas sanas: sin espacios (mata frases como checklist), sin `..`.
const RUTA_OK = /^[A-Za-z0-9_@.+-][A-Za-z0-9_@.+\-/]*$/;
const MAX_TASKS = 20;
const MAX_RUTA = 120;

/**
 * Resuelve el argumento de build a la spec efectiva. Un id de spec activa
 * (sin `/`, sin `.md`) apunta a su `tasks.md`; una ruta cruda pasa tal cual.
 * `..` y rutas absolutas se rechazan (fail closed).
 */
export function resolverSpecBuild(specArg?: string): string {
  const s = (specArg ?? ".speckit/build.md").trim() || ".speckit/build.md";
  if (!s || s.includes("..") || s.startsWith("/")) {
    throw new Error(`build: spec fuera del proyecto: ${specArg ?? ""}`);
  }
  if (s.includes("/") || s.endsWith(".md")) return s;
  if (!ID_OK.test(s)) throw new Error(`build: id de spec inválido: ${s}`);
  return `specs/active/${s}/tasks.md`;
}

function esRutaValida(r: string): boolean {
  if (!r || r.length > MAX_RUTA) return false;
  if (!RUTA_OK.test(r)) return false;
  if (r.split("/").includes("..")) return false;
  return true;
}

/** Líneas `- [ ] ruta` válidas dentro de un markdown (existentes o derivadas). */
export function rutasValidas(markdown: string): string[] {
  const vistas = new Set<string>();
  const rutas: string[] = [];
  for (const t of leerChecklist(markdown)) {
    const r = t.ruta.trim();
    if (!esRutaValida(r) || vistas.has(r)) continue;
    vistas.add(r);
    rutas.push(r);
  }
  return rutas;
}

function recortar(texto: string, tope: number): string {
  return texto.length > tope ? texto.slice(0, tope) + "\n…(recortado)" : texto;
}

const PROMPT_DERIVACION = (spec: string, plan: string): string =>
  `Dado este spec y plan aprobados, lista los archivos a crear o modificar para implementarlos.\n` +
  `Devuelve SOLO líneas con formato \`- [ ] ruta/relativa.ext\`, una por archivo, máximo ${MAX_TASKS}.\n` +
  `Rutas relativas al proyecto, sin espacios, sin \`..\`, sin absolutas. Sin fences ni explicaciones.\n\n` +
  `## Spec\n\n${recortar(spec, 3000)}\n\n## Plan\n\n${recortar(plan, 3000)}\n`;

/**
 * Asegura `specs/active/<specId>/tasks.md` con al menos una ruta válida.
 * Reutiliza las existentes si las hay; si no, deriva con UNA llamada a
 * `preguntar` y persiste el resultado validado. Fail closed: sin spec/plan,
 * sin respuesta válida o si `preguntar` falla, devuelve error sin escribir.
 */
export async function asegurarTasksDesdePlan(
  root: string,
  specId: string,
  preguntar: Preguntar,
): Promise<ResultadoTasks> {
  if (!ID_OK.test(specId)) return { ok: false, error: `id de spec inválido: ${specId}` };
  const dir = `${root}/specs/active/${specId}`;
  let spec: string;
  let plan: string;
  try {
    spec = readFileSync(`${dir}/spec.md`, "utf8");
    plan = readFileSync(`${dir}/plan.md`, "utf8");
  } catch {
    return { ok: false, error: `spec ${specId} sin spec.md o plan.md (aprueba el plan primero)` };
  }
  const tasksRel = `specs/active/${specId}/tasks.md`;
  if (existsSync(`${root}/${tasksRel}`)) {
    const existentes = rutasValidas(readFileSync(`${root}/${tasksRel}`, "utf8"));
    if (existentes.length > 0) return { ok: true, tasksRel, archivos: existentes, creadas: false };
  }
  let respuesta: string;
  try {
    respuesta = await preguntar(PROMPT_DERIVACION(spec, plan));
  } catch (e) {
    return { ok: false, error: `no se pudo derivar tasks: ${e instanceof Error ? e.message : e}` };
  }
  const archivos = rutasValidas(respuesta).slice(0, MAX_TASKS);
  if (archivos.length === 0) {
    return { ok: false, error: "el proveedor no devolvió rutas válidas (sin escribir tasks.md)" };
  }
  const doc = `# Tasks ${specId}\n\n**origen:** derivadas del plan aprobado (ver plan.md)\n\n` +
    archivos.map((r) => `- [ ] ${r}`).join("\n") + "\n";
  try {
    writeFileSync(`${root}/${tasksRel}`, doc, "utf8");
  } catch (e) {
    return { ok: false, error: `no se pudo escribir tasks.md: ${e instanceof Error ? e.message : e}` };
  }
  return { ok: true, tasksRel, archivos, creadas: true };
}
