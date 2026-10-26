// Módulo agents — gestión del grafo y ejecución.
import { loadAgents, saveAgents, grafoTexto, AgentsConfig } from "./config.js";
export { loadAgents, grafoTexto };
export { handoff, listarHandoffs, textoHandoffs } from "./handoff.js";
export { ejecutarTareaGrafo, rondaAgenteGrafo } from "./ejecucion.js";

export function agentsText(root: string): string {
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  return grafoTexto(r.config) + (r.defecto ? "\n(defecto sin guardar; usa `agents add` para persistir)" : "");
}

export function addAgente(root: string, id?: string, rol?: string): string {
  if (!id || !rol) return "uso: axiom agents add <id> <orquestador|nodo|especializado|subagente>";
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  if (!["orquestador", "nodo", "especializado", "subagente"].includes(rol)) return `rol inválido: ${rol}`;
  if (r.config.agentes.some((a) => a.id === id)) return `${id} ya existe`;
  const cfg: AgentsConfig = { ...r.config, agentes: [...r.config.agentes, { id, rol: rol as never, modelo: "hereda-proveedor", estado: "activo", skills: [], instrucciones: "", herramientas: [] }] };
  saveAgents(root, cfg);
  return `${id} añadido como ${rol}`;
}

export function pausarAgente(root: string, id?: string, estado?: string): string {
  if (!id) return "uso: axiom agents pause <id> [activo|pausado]";
  const est = estado ?? "pausado";
  if (est !== "activo" && est !== "pausado") return `estado inválido: ${est}`;
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  if (!r.config.agentes.some((a) => a.id === id)) return `${id} no existe`;
  saveAgents(root, { ...r.config, agentes: r.config.agentes.map((a) => (a.id === id ? { ...a, estado: est as never } : a)) });
  return `${id}: ${est}`;
}

export function skill(root: string, id?: string, s?: string): string {
  if (!id || !s) return "uso: axiom agents skill <id> <skill>";
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  if (!r.config.agentes.some((a) => a.id === id)) return `${id} no existe`;
  saveAgents(root, { ...r.config, agentes: r.config.agentes.map((a) => (a.id === id && !a.skills.includes(s) ? { ...a, skills: [...a.skills, s] } : a)) });
  return `${id} +skill ${s}`;
}

// Define detalles de un AgentDefinition (F8): instrucciones, herramientas, presupuesto.
// Las skills siguen siendo instrucciones reutilizables, nunca autorización (decide el broker).
export function definirAgente(root: string, id?: string, campo?: string, valor?: string): string {
  if (!id || !campo) return "uso: axiom agents define <id> <instrucciones|herramienta|noherramienta|presupuesto|nopresupuesto|modelo> [valor]";
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  const i = r.config.agentes.findIndex((a) => a.id === id);
  if (i < 0) return `${id} no existe`;
  const a = r.config.agentes[i];
  const v = (valor ?? "").trim();
  if (campo === "instrucciones") {
    if (!v || v.length > 2000) return "uso: axiom agents define <id> instrucciones <texto 1-2000, - para vaciar>";
    a.instrucciones = v === "-" ? "" : v;
  } else if (campo === "herramienta") {
    const m = /^([a-z][a-z0-9-]{0,63})=(allow|ask|deny)$/.exec(v);
    if (!m) return "uso: axiom agents define <id> herramienta <tool=allow|ask|deny>";
    const resto = a.herramientas.filter((h) => h.tool !== m[1]);
    if (resto.length >= 16 && !a.herramientas.some((h) => h.tool === m[1])) return "máximo 16 herramientas por agente";
    a.herramientas = [...resto, { tool: m[1], acceso: m[2] as "allow" | "ask" | "deny" }];
  } else if (campo === "noherramienta") {
    if (!v) return "uso: axiom agents define <id> noherramienta <tool>";
    if (!a.herramientas.some((h) => h.tool === v)) return `${v} no estaba en ${id}`;
    a.herramientas = a.herramientas.filter((h) => h.tool !== v);
  } else if (campo === "presupuesto") {
    const m = /^(\d+):(\d+)$/.exec(v);
    const t = m ? parseInt(m[1], 10) : 0;
    const c = m ? parseInt(m[2], 10) : 0;
    if (!m || t < 1 || t > 10000000 || c < 1 || c > 100000) return "uso: axiom agents define <id> presupuesto <tokens:calls>";
    a.presupuesto = { tokens: t, calls: c };
  } else if (campo === "nopresupuesto") {
    delete (a as { presupuesto?: unknown }).presupuesto;
  } else if (campo === "modelo") {
    // Modelo propio del agente: se usa en el spawn; "hereda-proveedor" vuelve al global.
    if (!v || v.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,127}$/.test(v)) return "uso: axiom agents define <id> modelo <id-del-modelo|hereda-proveedor>";
    a.modelo = v;
  } else {
    return `campo inválido: ${campo} (instrucciones|herramienta|noherramienta|presupuesto|nopresupuesto|modelo)`;
  }
  const chk = AgentsConfig.safeParse(r.config);
  if (!chk.success) return `agents.config.json inválido: ${chk.error.issues.map((x) => x.message).join("; ")}`;
  saveAgents(root, chk.data);
  return `${id}: ${campo} actualizado`;
}

export function enlazar(root: string, de?: string, a?: string, tipo?: string): string {
  if (!de || !a) return "uso: axiom agents link <de> <a> [delega|comunica|escala]";
  const t = tipo ?? "delega";
  if (!["delega", "comunica", "escala"].includes(t)) return `tipo inválido: ${t}`;
  const r = loadAgents(root);
  if (!r.ok) return r.error;
  const ids = new Set(r.config.agentes.map((x) => x.id));
  if (!ids.has(de) || !ids.has(a)) return `agente inexistente: ${!ids.has(de) ? de : a}`;
  saveAgents(root, { ...r.config, aristas: [...r.config.aristas, { de, a, tipo: t as never }] });
  return `${de} ──${t}──▶ ${a}`;
}
