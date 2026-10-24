// Módulo agents — orquestador, nodos, especializados y skills.
// Sin ejecución real aún: declara el grafo de orquestación y su estado.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Herramienta declarada por un agente: capacidad con requisito de permiso.
// La autorización efectiva la decide el broker (global>proyecto); esto solo declara la intención.
export const HerramientaAgente = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "tool: a-z, 0-9, - (1-64)"),
  acceso: z.enum(["allow", "ask", "deny"]).default("ask"),
});
export type HerramientaAgente = z.infer<typeof HerramientaAgente>;

export const PresupuestoAgente = z.object({
  tokens: z.number().int().min(1).max(10000000),
  calls: z.number().int().min(1).max(100000),
});
export type PresupuestoAgente = z.infer<typeof PresupuestoAgente>;

export const Agente = z.object({
  id: z.string().min(1).max(64),
  rol: z.enum(["orquestador", "nodo", "especializado", "subagente"]),
  modelo: z.string().min(1).max(128).default("hereda-proveedor"),
  estado: z.enum(["activo", "pausado", "archivado"]).default("activo"),
  skills: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "skill: a-z, 0-9, - (1-64)")).max(16).default([]),
  instrucciones: z.string().max(2000).default(""),
  herramientas: z.array(HerramientaAgente).max(16).default([]),
  presupuesto: PresupuestoAgente.optional(),
});
export type Agente = z.infer<typeof Agente>;

export const Arista = z.object({
  de: z.string().min(1),
  a: z.string().min(1),
  tipo: z.enum(["delega", "comunica", "escala"]).default("delega"),
});
export type Arista = z.infer<typeof Arista>;

export const AgentsConfig = z.object({
  agentes: z.array(Agente).default([]),
  aristas: z.array(Arista).default([]),
});
export type AgentsConfig = z.infer<typeof AgentsConfig>;

export const CONFIG_FILE = "agents.config.json";

function defecto(): AgentsConfig {
  return {
    agentes: [
    { id: "orquestador", rol: "orquestador", modelo: "hereda-proveedor", estado: "activo", skills: ["plan", "broker"], instrucciones: "", herramientas: [] },
    { id: "nodo-code", rol: "nodo", modelo: "hereda-proveedor", estado: "activo", skills: ["implementar", "verify"], instrucciones: "", herramientas: [] },
    { id: "nodo-review", rol: "nodo", modelo: "hereda-proveedor", estado: "activo", skills: ["review", "evidence"], instrucciones: "", herramientas: [] },
    { id: "esp-seguridad", rol: "especializado", modelo: "hereda-proveedor", estado: "activo", skills: ["policy", "sandbox"], instrucciones: "", herramientas: [] },
    ],
    aristas: [
      { de: "orquestador", a: "nodo-code", tipo: "delega" },
      { de: "orquestador", a: "nodo-review", tipo: "delega" },
      { de: "nodo-code", a: "esp-seguridad", tipo: "escala" },
      { de: "nodo-review", a: "orquestador", tipo: "comunica" },
    ],
  };
}

export function loadAgents(root: string): { ok: true; config: AgentsConfig; defecto: boolean } | { ok: false; error: string } {
  const p = join(root, CONFIG_FILE);
  if (!existsSync(p)) return { ok: true, config: defecto(), defecto: true };
  try {
    const r = AgentsConfig.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (!r.success) return { ok: false, error: `agents.config.json inválido: ${r.error.issues.map((i) => i.message).join("; ")}` };
    // Valida que las aristas apunten a agentes existentes.
    const ids = new Set(r.data.agentes.map((a) => a.id));
    const rota = r.data.aristas.find((a) => !ids.has(a.de) || !ids.has(a.a));
    if (rota) return { ok: false, error: `arista rota: ${rota.de} → ${rota.a}` };
    return { ok: true, config: r.data, defecto: false };
  } catch (e) {
    return { ok: false, error: `agents.config.json ilegible: ${e instanceof Error ? e.message : e}` };
  }
}

export function saveAgents(root: string, cfg: AgentsConfig): void {
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n");
}

export function grafoTexto(c: AgentsConfig): string {
  const porId = new Map(c.agentes.map((a) => [a.id, a]));
  const lines = ["orquestación: orquestador → nodos → especializados"];
  for (const a of c.agentes) {
    const det: string[] = [`skills: ${(a.skills ?? []).join(", ") || "—"}`];
    if ((a.herramientas ?? []).length) det.push(`herramientas: ${(a.herramientas ?? []).map((h) => `${h.tool}(${h.acceso})`).join(", ")}`);
    if (a.presupuesto) det.push(`presupuesto: ${a.presupuesto.tokens}tok/${a.presupuesto.calls}calls`);
    if (a.instrucciones) det.push(`instrucciones: ${a.instrucciones.slice(0, 80)}${a.instrucciones.length > 80 ? "…" : ""}`);
    lines.push(`- [${a.rol}] ${a.id} (${a.estado}) ${det.join(" · ")}`);
  }
  for (const e of c.aristas) {
    const flecha = e.tipo === "delega" ? "──delega──▶" : e.tipo === "escala" ? "──escala──▶" : "──comunica──▶";
    void porId;
    lines.push(`  ${e.de} ${flecha} ${e.a}`);
  }
  return lines.join("\n");
}
