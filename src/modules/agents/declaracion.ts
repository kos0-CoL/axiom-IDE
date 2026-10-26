// Declaración de herramientas de un agente, resuelta para el broker.
// El broker no conoce el grafo: recibe esta declaración ya resuelta y la trata
// como una cota más (política global ∧ proyecto ∧ agente). Herramienta no
// declarada = no autorizada (fail closed); no se deduce de las skills.
import { loadAgents, AgentsConfig } from "./config.js";
import { datosAprobacion } from "../../broker.js";

// Nombres equivalentes: el núcleo histórico usa los ingleses (read, terminal)
// y el roster declara los españoles (leer, ejecutar). Se comparan normalizados
// para que declarar «leer» cubra un check de «read», y no al revés.
const ALIAS: Record<string, string> = {
  read: "leer",
  search: "buscar",
  write: "editar",
  edit: "editar",
  terminal: "ejecutar",
  run: "ejecutar",
  exec: "ejecutar",
};

export function normalizarHerramienta(tool: string): string {
  const t = (tool ?? "").trim().toLowerCase();
  return ALIAS[t] ?? t;
}

// `acceso` presente = el agente declara la herramienta.
// `error` = no se pudo verificar (agente inexistente, config rota, sin
// declaración): el broker lo convierte en deny.
export type Declaracion =
  | { id: string; tool: string; acceso: "allow" | "ask" | "deny" }
  | { id: string; error: string };

export interface PedidoHerramienta {
  agente: string;
  tool: string;
}

function resolver(config: AgentsConfig, agenteId: string, tool: string): Declaracion {
  const id = (agenteId ?? "").trim();
  if (!id) return { id: "", error: "agente requerido" };
  const t = normalizarHerramienta(tool);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(t)) return { id, error: `herramienta inválida: ${tool}` };
  const agente = config.agentes.find((a) => a.id === id);
  if (!agente) return { id, error: "agente inexistente" };
  const h = agente.herramientas.find((x) => normalizarHerramienta(x.tool) === t);
  if (!h) {
    return {
      id,
      error: `no declara la herramienta ${t} (añádela con \`axiom agents define ${id} herramienta ${t}=allow|ask|deny\`)`,
    };
  }
  return { id, tool: t, acceso: h.acceso };
}

export function declaracionDeHerramienta(root: string, agenteId: string, tool: string): Declaracion {
  const id = (agenteId ?? "").trim();
  if (!id) return { id: "", error: "agente requerido" };
  const r = loadAgents(root);
  if (!r.ok) return { id, error: r.error };
  return resolver(r.config, id, tool);
}

// Varias resoluciones con una sola lectura de agents.config.json: la vista de
// Aprobaciones pinta hasta 20 filas y no debe leer el archivo 20 veces.
export function declaracionesDeHerramienta(root: string, pedidos: PedidoHerramienta[]): Declaracion[] {
  const r = loadAgents(root);
  return pedidos.map((p) => (r.ok ? resolver(r.config, p.agente, p.tool) : { id: (p.agente ?? "").trim(), error: r.error }));
}

// Declaración vigente para decidir una aprobación ya pedida: se recuerda qué
// agente la solicitó y se vuelve a leer su config, no la del momento del check.
export function declaracionDeAprobacion(root: string, aprobacionId: string): Declaracion | undefined {
  const d = datosAprobacion(root, aprobacionId);
  if (!d?.agente) return undefined;
  return declaracionDeHerramienta(root, d.agente, d.tool);
}
