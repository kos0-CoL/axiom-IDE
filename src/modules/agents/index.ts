// Módulo agents — gestión del grafo y ejecución.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ZodError } from "zod";
import {
  loadAgents,
  saveAgents,
  grafoTexto,
  AgentsConfig,
  Agente,
  HerramientaAgente,
  PresupuestoAgente,
  cuerpoSkill,
} from "./config.js";
export { loadAgents, grafoTexto };
export { declaracionDeHerramienta, declaracionesDeHerramienta, declaracionDeAprobacion, normalizarHerramienta } from "./declaracion.js";
export type { Declaracion, PedidoHerramienta } from "./declaracion.js";
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

// Datos del panel: el grafo realmente configurado (agents.config.json o el seed
// por defecto), sin inventar agentes ni relaciones. Si el archivo está roto, se
// devuelve la causa en `fuente` y listas vacías en vez de una vista falsa.
export interface DatosAgents {
  fuente: string;
  resumen: { agentes: number; activos: number; pausados: number; aristas: number };
  agentes: { id: string; rol: string; estado: string; modelo: string; skills: string; herramientas: string }[];
  aristas: { de: string; tipo: string; a: string }[];
}

export function datosModulo(root: string): DatosAgents {
  const vacio: DatosAgents = { fuente: "", resumen: { agentes: 0, activos: 0, pausados: 0, aristas: 0 }, agentes: [], aristas: [] };
  const r = loadAgents(root);
  if (!r.ok) return { ...vacio, fuente: r.error };
  const agentes = r.config.agentes.map((a) => ({
    id: a.id,
    rol: a.rol,
    estado: a.estado,
    modelo: a.modelo,
    skills: a.skills.join(", ") || "—",
    herramientas: a.herramientas.map((h) => `${h.tool} (${h.acceso})`).join(", ") || "— (sin declarar)",
  }));
  return {
    fuente: r.defecto ? "agents.config.json (sin guardar: se muestra el seed por defecto)" : "agents.config.json",
    resumen: {
      agentes: agentes.length,
      activos: agentes.filter((a) => a.estado === "activo").length,
      pausados: agentes.filter((a) => a.estado !== "activo").length,
      aristas: r.config.aristas.length,
    },
    agentes,
    aristas: r.config.aristas.map((a) => ({ de: a.de, tipo: a.tipo, a: a.a })),
  };
}

// --- Detalle editable de un agente -------------------------------------------
// La web pide el agente concreto y lo pinta como formulario; el modo avanzado
// muestra el objeto exacto que vive en agents.config.json. Nada se escribe sin
// validar: si algo no cuadra se devuelve el motivo y el archivo queda intacto.

const ROLES = ["orquestador", "nodo", "especializado", "subagente"] as const;
const ESTADOS = ["activo", "pausado", "archivado"] as const;

export type CampoTipo = "texto" | "area" | "opciones";

export interface CampoDetalle {
  k: string;
  etiqueta: string;
  tipo: CampoTipo;
  opciones?: string[];
  ayuda: string;
  valor: string;
}

export interface DatosDetalleAgente {
  id: string;
  bruto: string;
  campos: CampoDetalle[];
  aristas: { de: string; tipo: string; a: string }[];
  nota: string;
}

export type ResultadoDetalle =
  | { ok: true; detalle: DatosDetalleAgente }
  | { ok: false; error: string };

function herramientasTexto(a: Agente): string {
  return a.herramientas.map((h) => `${h.tool}=${h.acceso}`).join(", ");
}

function mensajeIssues(error: ZodError): string {
  const visibles = error.issues.slice(0, 6).map((i) => {
    const donde = i.path.length ? `${i.path.join(".")}: ` : "";
    return `${donde}${i.message}`;
  });
  const extra = error.issues.length > visibles.length ? ` … (+${error.issues.length - visibles.length} más)` : "";
  return visibles.join("; ") + extra;
}

function skillExiste(root: string, id: string): boolean {
  if (cuerpoSkill(id)) return true;
  try {
    return existsSync(join(root, "skills", id, "SKILL.md"));
  } catch {
    return false;
  }
}

export function detalleModulo(root: string, id?: string): ResultadoDetalle {
  const n = (id ?? "").trim();
  if (!n) return { ok: false, error: "id de agente requerido" };
  const r = loadAgents(root);
  if (!r.ok) return { ok: false, error: r.error };
  const a = r.config.agentes.find((x) => x.id === n);
  if (!a) return { ok: false, error: `agente inexistente: ${n}` };
  const campos: CampoDetalle[] = [
    {
      k: "rol",
      etiqueta: "Rol",
      tipo: "opciones",
      opciones: [...ROLES],
      ayuda: "orquestador coordina y reparte; nodo ejecuta; especializado aporta su skill; subagente es ayuda temporal.",
      valor: a.rol,
    },
    {
      k: "estado",
      etiqueta: "Estado",
      tipo: "opciones",
      opciones: [...ESTADOS],
      ayuda: "activo participa del grafo; pausado queda declarado pero no se usa; archivado solo queda como historial.",
      valor: a.estado,
    },
    {
      k: "modelo",
      etiqueta: "Modelo",
      tipo: "texto",
      ayuda: "Id del modelo para este agente, o «hereda-proveedor» para usar el del proveedor configurado.",
      valor: a.modelo,
    },
    {
      k: "skills",
      etiqueta: "Skills",
      tipo: "texto",
      ayuda: "Ids separados por coma. Deben existir en el catálogo o en skills/<id>/SKILL.md del proyecto: son instrucciones, no permisos.",
      valor: a.skills.join(", "),
    },
    {
      k: "herramientas",
      etiqueta: "Herramientas",
      tipo: "texto",
      ayuda: "Formato tool=allow|ask|deny, separadas por coma (ej. leer=allow, editar=ask). El broker las cruza con la política: lo no declarado se deniega y la política sigue siendo el techo.",
      valor: herramientasTexto(a),
    },
    {
      k: "presupuesto",
      etiqueta: "Presupuesto",
      tipo: "texto",
      ayuda: "tokens:llamadas para este agente (ej. 12000:40). Vacío = sin límite propio.",
      valor: a.presupuesto ? `${a.presupuesto.tokens}:${a.presupuesto.calls}` : "",
    },
    {
      k: "instrucciones",
      etiqueta: "Instrucciones",
      tipo: "area",
      ayuda: "Texto fijo que este agente recibe siempre. Máximo 2000 caracteres.",
      valor: a.instrucciones,
    },
  ];
  return {
    ok: true,
    detalle: {
      id: a.id,
      bruto: JSON.stringify(a, null, 2),
      campos,
      aristas: r.config.aristas
        .filter((e) => e.de === n || e.a === n)
        .map((e) => ({ de: e.de, tipo: e.tipo, a: e.a })),
      nota: r.defecto
        ? "Ahora mismo no hay agents.config.json: esta vista muestra el seed por defecto. Al guardar se crea el archivo con este grafo y tus cambios."
        : "Se guarda en agents.config.json. Se valida antes de escribir: si algo no cuadra, el archivo queda intacto.",
    },
  };
}

type Parse<T> = { ok: true; valor: T } | { ok: false; error: string };

function parseSkills(v: unknown): Parse<string[]> {
  if (typeof v !== "string" && !Array.isArray(v)) return { ok: false, error: "skills debe ser texto separado por comas" };
  const crudos: unknown[] = typeof v === "string" ? v.split(",") : v;
  const out: string[] = [];
  for (const c of crudos) {
    if (typeof c !== "string") return { ok: false, error: "skills debe contener textos" };
    const s = c.trim();
    if (!s || out.includes(s)) continue;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(s)) return { ok: false, error: `skill inválida: ${s} (a-z, 0-9, -)` };
    out.push(s);
  }
  if (out.length > 16) return { ok: false, error: "máximo 16 skills por agente" };
  return { ok: true, valor: out };
}

function parseHerramientas(v: unknown): Parse<HerramientaAgente[]> {
  if (typeof v !== "string" && !Array.isArray(v)) return { ok: false, error: "herramientas debe ser texto tool=acceso o una lista" };
  const items: unknown[] = typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v;
  const out: HerramientaAgente[] = [];
  for (const it of items) {
    if (typeof it === "string") {
      const m = /^([a-z][a-z0-9-]{0,63})\s*=\s*(allow|ask|deny)$/.exec(it.trim());
      if (!m) return { ok: false, error: `herramienta inválida: ${it} (formato tool=allow|ask|deny)` };
      if (!out.some((h) => h.tool === m[1])) out.push({ tool: m[1], acceso: m[2] as HerramientaAgente["acceso"] });
      continue;
    }
    const p = HerramientaAgente.safeParse(it);
    if (!p.success) return { ok: false, error: `herramienta inválida: ${JSON.stringify(it)}` };
    if (!out.some((h) => h.tool === p.data.tool)) out.push(p.data);
  }
  if (out.length > 16) return { ok: false, error: "máximo 16 herramientas por agente" };
  return { ok: true, valor: out };
}

function parsePresupuesto(v: unknown): Parse<PresupuestoAgente | undefined> {
  if (v === undefined || v === null) return { ok: true, valor: undefined };
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return { ok: true, valor: undefined };
    const m = /^(\d+)\s*:\s*(\d+)$/.exec(s);
    if (!m) return { ok: false, error: "presupuesto: usa tokens:llamadas (ej. 12000:40) o déjalo vacío" };
    const tokens = parseInt(m[1], 10);
    const calls = parseInt(m[2], 10);
    if (tokens < 1 || tokens > 10000000 || calls < 1 || calls > 100000) {
      return { ok: false, error: "presupuesto fuera de rango (1-10000000 tokens, 1-100000 llamadas)" };
    }
    return { ok: true, valor: { tokens, calls } };
  }
  const p = PresupuestoAgente.safeParse(v);
  if (!p.success) return { ok: false, error: "presupuesto inválido" };
  return { ok: true, valor: p.data };
}

export type ResultadoGuardado = { ok: true; msg: string } | { ok: false; error: string };

export function guardarDetalleModulo(
  root: string,
  entrada: { id?: unknown; cambios?: unknown; bruto?: unknown },
): ResultadoGuardado {
  const id = typeof entrada.id === "string" ? entrada.id.trim() : "";
  if (!id) return { ok: false, error: "id de agente requerido" };
  const r = loadAgents(root);
  if (!r.ok) return { ok: false, error: r.error };
  const i = r.config.agentes.findIndex((a) => a.id === id);
  if (i < 0) return { ok: false, error: `agente inexistente: ${id}` };

  let candidato: Agente;
  if (entrada.bruto !== undefined) {
    if (typeof entrada.bruto !== "string") return { ok: false, error: "bruto debe ser texto JSON" };
    let j: unknown;
    try {
      j = JSON.parse(entrada.bruto);
    } catch (e) {
      return { ok: false, error: `JSON inválido: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, error: "el JSON debe ser un objeto con un agente" };
    const o = j as Record<string, unknown>;
    if (o.id !== id) return { ok: false, error: `el id no se cambia desde aquí (${String(o.id ?? "sin id")} ≠ ${id})` };
    const p = Agente.safeParse(o);
    if (!p.success) return { ok: false, error: `JSON del agente inválido: ${mensajeIssues(p.error)}` };
    candidato = p.data;
  } else {
    const c = entrada.cambios;
    if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "cambios (objeto) o bruto (JSON) requerido" };
    const cambios = c as Record<string, unknown>;
    for (const k of Object.keys(cambios)) {
      if (!["rol", "estado", "modelo", "skills", "herramientas", "presupuesto", "instrucciones"].includes(k)) {
        return { ok: false, error: `campo no editable: ${k}` };
      }
    }
    candidato = { ...r.config.agentes[i] };
    if ("rol" in cambios) {
      const v = String(cambios.rol ?? "").trim();
      if (!(ROLES as readonly string[]).includes(v)) return { ok: false, error: `rol inválido: ${v} (${ROLES.join(" | ")})` };
      candidato.rol = v as Agente["rol"];
    }
    if ("estado" in cambios) {
      const v = String(cambios.estado ?? "").trim();
      if (!(ESTADOS as readonly string[]).includes(v)) return { ok: false, error: `estado inválido: ${v} (${ESTADOS.join(" | ")})` };
      candidato.estado = v as Agente["estado"];
    }
    if ("modelo" in cambios) {
      const v = String(cambios.modelo ?? "").trim() || "hereda-proveedor";
      if (v.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,127}$/.test(v)) {
        return { ok: false, error: "modelo inválido (1-128: letras, números y . _ : @ / -)" };
      }
      candidato.modelo = v;
    }
    if ("skills" in cambios) {
      const p = parseSkills(cambios.skills);
      if (!p.ok) return p;
      candidato.skills = p.valor;
    }
    if ("herramientas" in cambios) {
      const p = parseHerramientas(cambios.herramientas);
      if (!p.ok) return p;
      candidato.herramientas = p.valor;
    }
    if ("presupuesto" in cambios) {
      const p = parsePresupuesto(cambios.presupuesto);
      if (!p.ok) return p;
      if (p.valor) candidato.presupuesto = p.valor;
      else delete candidato.presupuesto;
    }
    if ("instrucciones" in cambios) {
      const v = String(cambios.instrucciones ?? "");
      if (v.length > 2000) return { ok: false, error: `instrucciones demasiado largas (${v.length}/2000)` };
      candidato.instrucciones = v;
    }
  }

  const faltan = candidato.skills.filter((s) => !skillExiste(root, s));
  if (faltan.length) {
    return { ok: false, error: `skill(s) sin cuerpo ni archivo: ${faltan.join(", ")} (usa uno del catálogo o crea skills/<id>/SKILL.md)` };
  }
  const ag = Agente.safeParse(candidato);
  if (!ag.success) return { ok: false, error: `agente inválido: ${mensajeIssues(ag.error)}` };
  const cfg = AgentsConfig.safeParse({ ...r.config, agentes: r.config.agentes.map((a, j) => (j === i ? ag.data : a)) });
  if (!cfg.success) return { ok: false, error: `agents.config.json inválido: ${mensajeIssues(cfg.error)}` };
  try {
    saveAgents(root, cfg.data);
  } catch (e) {
    return { ok: false, error: `no se pudo escribir agents.config.json: ${e instanceof Error ? e.message : String(e)}` };
  }
  const creado = r.defecto ? " (se creó el archivo desde el seed)" : "";
  return { ok: true, msg: `${id}: guardado en agents.config.json${creado}` };
}
