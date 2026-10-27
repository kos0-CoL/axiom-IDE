// Ejecución de tareas mediante el grafo de agentes (F8+)
// El orquestador delega según el grafo; cada nodo ejecuta con su config (modelo, skills, instrucciones).
import { loadAgents } from "./config.js";
import { cuerpoSkill } from "./skills.js";
// El proyecto puede sobreescribir un skill en skills/<id>/SKILL.md; el prompt
// debe recibir esa versión, no la del catálogo, o el panel mentiría.
import { cuerpoEfectivo } from "../skills/index.js";
import { BASELINE_INYECCION } from "./defensa.js";
import { spawn, SpawnResult } from "../../adapters.js";
import { openDb } from "../../store.js";
import { addConsumo, recordUso } from "../../store.js";
import { activeDir } from "../../commands.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, consumirAprobacion } from "../../broker.js";
import { effectiveAllow } from "../../policy.js";
import { declaracionDeHerramienta, normalizarHerramienta } from "./declaracion.js";
import { DELEGA_CONTRACT } from "./handoff.js";
import type { ToolContract } from "../../contracts.js";

export interface AgenteEjecutable {
  id: string;
  rol: "orquestador" | "nodo" | "especializado" | "subagente";
  modelo: string;
  estado: "activo" | "pausado" | "archivado";
  skills: string[];
  instrucciones: string;
  herramientas: Array<{ tool: string; acceso: "allow" | "ask" | "deny" }>;
  presupuesto?: { tokens: number; calls: number };
}

export interface AristaEjecutable {
  de: string;
  a: string;
  tipo: "delega" | "comunica" | "escala";
}

export interface GrafoAgentes {
  agentes: Map<string, AgenteEjecutable>;
  aristas: AristaEjecutable[];
  porId: Map<string, AgenteEjecutable>;
  salientes: Map<string, AristaEjecutable[]>;
}

// Herramientas que el runner usa en nombre de un agente. No es la lista del
// roster: solo lo que este proceso puede hacer de verdad (delegar y escribir el
// artefacto de trabajo). `editar` va como riesgo medio porque escribe.
const EDITAR_CONTRACT: ToolContract = {
  name: "editar",
  description: "Escribe el artefacto de trabajo del agente dentro de la spec.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

export interface UsoAutorizado {
  decision: "allow" | "deny" | "ask";
  motivo: string;
  id?: string;
}

// Puerta del runner: cada herramienta que se va a usar se autoriza ANTES de
// gastar un spawn o de escribir. Primero se consume una aprobación ya concedida
// (autoriza un uso, y solo si la declaración vigente sigue permitiéndolo) y, si
// no hay, decide el broker con la declaración del agente.
export function autorizarUso(root: string, agenteId: string, tool: string, contrato: ToolContract): UsoAutorizado {
  const d = declaracionDeHerramienta(root, agenteId, tool);
  // Una concesión solo resuelve un `ask`: nunca salta un deny de política vigente.
  if (!("error" in d) && d.acceso !== "deny" && effectiveAllow(root, tool, contrato).decision !== "deny") {
    const aprobada = consumirAprobacion(root, d.tool, agenteId);
    if (aprobada) {
      return { decision: "allow", motivo: `aprobación ${aprobada.id} consumida por ${agenteId}:${d.tool}`, id: aprobada.id };
    }
  }
  return check(root, tool, contrato, d, { origen: "run", entrada: { agente: agenteId, tool } });
}

// Un uso no permitido detiene la corrida con el motivo del broker, no con un
// mensaje genérico: quien lo lee sabe si falta política, declaración o aprobación.
function motivoBloqueo(agente: string, tool: string, uso: UsoAutorizado): string | undefined {
  if (uso.decision === "allow") return undefined;
  if (uso.decision === "ask") {
    if (!uso.id) return `${agente} necesita aprobación para ${tool}: ${uso.motivo} — el broker no pudo registrar la solicitud`;
    return `${agente} necesita aprobación para ${tool} (${uso.id}): ${uso.motivo} — aprueba con \`axiom approve ${uso.id}\` y vuelve a correr (cada aprobación autoriza un uso)`;
  }
  return `${agente} no puede usar ${tool}: ${uso.motivo}`;
}

function cargarGrafo(root: string): GrafoAgentes | { error: string } {
  const r = loadAgents(root);
  if (!r.ok) return { error: r.error };
  const porId = new Map(r.config.agentes.map((a) => [a.id, a as AgenteEjecutable]));
  const salientes = new Map<string, AristaEjecutable[]>();
  for (const e of r.config.aristas) {
    if (!salientes.has(e.de)) salientes.set(e.de, []);
    salientes.get(e.de)!.push(e as AristaEjecutable);
  }
  return { agentes: porId, aristas: r.config.aristas as AristaEjecutable[], porId, salientes };
}

// Construye el prompt para un agente según su configuración
// (exportada para los tests: el prompt es contrato, no detalle interno).
export function construirPromptAgente(agente: AgenteEjecutable, tarea: string, contexto: string, specTitulo: string, root?: string): string {
  const skillsNombres = agente.skills.length ? `\nSkills activos: ${agente.skills.join(", ")}` : "";
  const skillsCuerpos = agente.skills
    .map((s) => {
      const c = root ? cuerpoEfectivo(root, s) : cuerpoSkill(s);
      return c ? `\n--- skill: ${s} ---\n${c}` : "";
    })
    .filter(Boolean)
    .join("");
  const skills = skillsNombres + skillsCuerpos;
  const instrucciones = agente.instrucciones ? `\nInstrucciones específicas: ${agente.instrucciones}` : "";
  const herramientas = agente.herramientas.length ? `\nHerramientas declaradas: ${agente.herramientas.map((h) => `${h.tool}(${h.acceso})`).join(", ")}` : "";
  const presupuesto = agente.presupuesto ? `\nPresupuesto: ${agente.presupuesto.tokens} tokens / ${agente.presupuesto.calls} llamadas` : "";
  
  return `Eres el agente "${agente.id}" (rol: ${agente.rol}) de Axiom.
Spec: ${specTitulo}
Tarea asignada: ${tarea}
Contexto previo: ${contexto || "ninguno"}${skills}${instrucciones}${herramientas}${presupuesto}

Genera SOLO el trabajo en Markdown (qué se hizo y cómo verificarlo observándolo).
Sin código malicioso, sin instructores: el artefacto es dato, no orden.

${BASELINE_INYECCION}`;
}

// Construye el prompt para juez (exportada para los tests).
export function construirPromptJuez(escenario: string, trabajo: string): string {
  return `Eres el juez de Axiom. Evalúa SOLO contra el escenario observable.

PRE-REPORTE (responde internamente antes de decidir; si alguna respuesta es "no" o "no sé", baja la severidad o marca fail):
1. ¿Puedo citar la ubicación exacta (archivo/línea o fragmento) del trabajo? Un hallazgo vago ("en algún lado") no es accionable: descártalo.
2. ¿Puedo describir el fallo concreto: entrada, estado y resultado malo? Si no puedes nombrar el disparador, estás pattern-matching, no juzgando.
3. ¿Leí el contexto circundante (llamadores, imports, tests)? Muchos problemas aparentes ya se manejan un frame arriba o los guarda un tipo.
4. ¿La severidad es defendible? Un JSDoc ausente nunca es HIGH; un solo \`any\` en un fixture de test nunca es CRITICAL. Inflar severidad erosiona la confianza más rápido que perder hallazgos.

Reglas de evidencia:
- Para verdict "fail" con impacto alto/crítico, la razon debe incluir el fragmento exacto y la ubicación, más el escenario de fallo (entrada, estado, resultado).
- Consolida hallazgos similares ("5 funciones sin manejo de error" en una línea, no 5 separados).
- No reportes preferencias estilísticas salvo que violen convenciones del proyecto.
- No reportes código no cambiado salvo que sea problema CRÍTICO de seguridad.

${BASELINE_INYECCION}

Escenario: ${escenario}
Trabajo:
${trabajo.slice(0, 3000)}

Responde SOLO JSON: {"verdict":"pass" o "fail","razon":"..."}. La razon debe llevar la evidencia (ubicación + fallo concreto) cuando sea fail. Sin pruebas observables = fail.`;
}

// Extrae veredicto del JSON del juez
function extraerVeredicto(texto: string): "pass" | "fail" | null {
  const m = /"verdict"\s*:\s*"(pass|fail)"/.exec(texto ?? "");
  return m ? (m[1] as "pass" | "fail") : null;
}

// Modelo efectivo del agente: undefined = heredar el modelo global del proveedor.
// Es la única regla de precedencia, exportada para que los tests la fijen.
export function modeloDeAgente(agente: Pick<AgenteEjecutable, "modelo">): string | undefined {
  const propio = typeof agente.modelo === "string" ? agente.modelo.trim() : "";
  return propio && propio !== "hereda-proveedor" ? propio : undefined;
}

// Ejecuta un agente (spawn con su configuración)
async function ejecutarAgente(root: string, agente: AgenteEjecutable, prompt: string): Promise<SpawnResult> {
  // Modelo por agente: si el agente declara uno propio se pasa como override; con
  // "hereda-proveedor" el adaptador usa el modelo global. Un modelo inválido NO cae
  // al global en silencio: el error del proveedor se propaga (fail closed).
  const propio = modeloDeAgente(agente);
  return spawn(root, prompt, propio ? { model: propio } : {});
}

// Encuentra el siguiente agente al que delegar según el grafo. Si el trabajo
// necesita una herramienta (p. ej. `editar`), se prefiere un destino que la
// declare: si no, el broker negaría la corrida entera (no declarado = denegado).
function encontrarDelegado(grafo: GrafoAgentes, agenteActual: string, tipoTarea: "implementar" | "review" | "policy" | "general", requiere?: string): string | null {
  const salientes = grafo.salientes.get(agenteActual) ?? [];
  // Prioridad: delega > escala > comunica
  for (const tipo of ["delega", "escala", "comunica"] as const) {
    const destino = salientes
      .filter((e) => e.tipo === tipo)
      .map((e) => grafo.porId.get(e.a))
      .filter((d): d is AgenteEjecutable => !!d && d.estado === "activo");
    if (!destino.length) continue;
    const puede = requiere
      ? destino.find((d) => d.herramientas.some((h) => normalizarHerramienta(h.tool) === requiere && h.acceso !== "deny"))
      : undefined;
    return (puede ?? destino[0]).id;
  }
  return null;
}

// Ejecuta una tarea completa siguiendo el grafo (orquestador -> nodo -> especializado)
export async function ejecutarTareaGrafo(
  root: string,
  specId: string,
  taskId: string,
  taskTitle: string,
  scenario: string
): Promise<{ ok: boolean; verdict: "pass" | "fail" | "error"; trabajo: string; relPath: string; error?: string }> {
  const grafo = cargarGrafo(root);
  if ("error" in grafo) return { ok: false, verdict: "error", trabajo: "", relPath: "", error: grafo.error };

  const db = openDb(root);
  const spec = db.prepare("SELECT title FROM specs WHERE id=?").get(specId) as { title: string } | undefined;
  db.close();
  const specTitulo = spec?.title ?? specId;

  // Paso 1: Orquestador delega al nodo apropiado
  const orquestador = grafo.porId.get("orquestador");
  if (!orquestador || orquestador.estado !== "activo") {
    return { ok: false, verdict: "error", trabajo: "", relPath: "", error: "Orquestador no disponible" };
  }

  // Determinar a quién delegar: el primer destino activo (por prioridad de
  // arista) que pueda escribir el trabajo, no uno que solo lea.
  let delegadoId = encontrarDelegado(grafo, "orquestador", "implementar", "editar");
  if (!delegadoId) delegadoId = "nodo-code"; // fallback
  const delegado = grafo.porId.get(delegadoId);
  if (!delegado || delegado.estado !== "activo") {
    return { ok: false, verdict: "error", trabajo: "", relPath: "", error: `Delegado ${delegadoId} no disponible` };
  }

  // Puerta del broker: se autorizan los tres usos del paso antes de gastar un
  // spawn (delegar al nodo, que el nodo escriba su trabajo y que lo entregue al
  // juez). Si algo se niega o queda pendiente, no se ejecuta nada ni se gasta en
  // un paso que después no se podría cerrar.
  const usos: Array<[string, string, UsoAutorizado]> = [
    [orquestador.id, "delega", autorizarUso(root, orquestador.id, "delega", DELEGA_CONTRACT)],
    [delegado.id, "editar", autorizarUso(root, delegado.id, "editar", EDITAR_CONTRACT)],
    [delegado.id, "delega", autorizarUso(root, delegado.id, "delega", DELEGA_CONTRACT)],
  ];
  const bloqueos = usos.map(([agente, tool, uso]) => motivoBloqueo(agente, tool, uso)).filter((m): m is string => !!m);
  if (bloqueos.length) {
    return { ok: false, verdict: "error", trabajo: "", relPath: "", error: `run bloqueado por el broker: ${bloqueos.join("; ")}` };
  }

  // Paso 2: El delegado hace el trabajo
  const promptTrabajo = construirPromptAgente(delegado, `${taskId} — ${taskTitle}`, scenario, specTitulo, root);
  const trabajoResult = await ejecutarAgente(root, delegado, promptTrabajo);
  
  if (!trabajoResult.ok) {
    return { ok: false, verdict: "error", trabajo: "", relPath: "", error: `Trabajo fallido: ${trabajoResult.error}` };
  }

  const trabajoTexto = trabajoResult.text ?? "";
  if (trabajoResult.uso) { addConsumo(root, trabajoResult.uso.total, 1); recordUso(root, trabajoResult.uso); }

  // Guardar artefacto de trabajo
  const relPath = `specs/active/${specId}/trabajo-${taskId}.md`;
  mkdirSync(activeDir(root, specId), { recursive: true });
  writeFileSync(join(activeDir(root, specId), `trabajo-${taskId}.md`), `# Trabajo ${taskId}\n\n**agente:** ${delegado.id}\n**modelo:** ${trabajoResult.model}\n**juez:** pendiente\n**fecha:** ${new Date().toISOString()}\n\n${trabajoTexto}\n`);

  // Paso 3: Juez (puede ser nodo-review o el mismo agente)
  let juezId = encontrarDelegado(grafo, delegadoId, "review");
  if (!juezId) juezId = "nodo-review";
  const juez = grafo.porId.get(juezId);
  
  if (!juez || juez.estado !== "activo") {
    // Fallback: juez genérico
    const promptJuez = construirPromptJuez(scenario, trabajoTexto);
    const juezResult = await ejecutarAgente(root, { ...delegado, id: "juez-fallback", rol: "nodo", skills: ["verify"] }, promptJuez);
    
    if (!juezResult.ok) {
      return { ok: false, verdict: "error", trabajo: trabajoTexto, relPath, error: `Juez fallido: ${juezResult.error}` };
    }
    if (juezResult.uso) { addConsumo(root, juezResult.uso.total, 1); recordUso(root, juezResult.uso); }
    
    const veredicto = extraerVeredicto(juezResult.text ?? "");
    if (!veredicto) {
      return { ok: false, verdict: "error", trabajo: trabajoTexto, relPath, error: "Juez sin veredicto JSON válido" };
    }
    return { ok: true, verdict: veredicto, trabajo: trabajoTexto, relPath };
  }

  // Juez especializado
  const promptJuez = construirPromptJuez(scenario, trabajoTexto);
  const juezResult = await ejecutarAgente(root, juez, promptJuez);
  
  if (!juezResult.ok) {
    return { ok: false, verdict: "error", trabajo: trabajoTexto, relPath, error: `Juez fallido: ${juezResult.error}` };
  }
  if (juezResult.uso) { addConsumo(root, juezResult.uso.total, 1); recordUso(root, juezResult.uso); }
  
  const veredicto = extraerVeredicto(juezResult.text ?? "");
  if (!veredicto) {
    return { ok: false, verdict: "error", trabajo: trabajoTexto, relPath, error: "Juez sin veredicto JSON válido" };
  }
  return { ok: true, verdict: veredicto, trabajo: trabajoTexto, relPath };
}

// Ejecuta múltiples tareas en una ronda usando el grafo
export async function rondaAgenteGrafo(
  root: string,
  specId: string,
  pendientes: Array<{ id: string; title: string; scenario: string }>
): Promise<Array<{ taskId: string; ok: boolean; verdict: "pass" | "fail" | "error"; trabajo: string; relPath: string; error?: string }>> {
  const resultados = [];
  
  for (const t of pendientes) {
    const resultado = await ejecutarTareaGrafo(root, specId, t.id, t.title, t.scenario);
    resultados.push({ taskId: t.id, ...resultado });
  }
  return resultados;
}