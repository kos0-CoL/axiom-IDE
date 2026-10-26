// Módulo agents — orquestador, nodos, especializados y skills.
// Sin ejecución real aún: declara el grafo de orquestación y su estado.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z, ZodIssue } from "zod";
import { rosterSemilla } from "./seed.js";

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
  // Versión del formato. <2 = config de antes de que el broker cruzara la
  // declaración del agente: se migra una sola vez y se sella en 2 (ver loadAgents).
  config_version: z.number().int().min(1).max(99).optional(),
  // Qué migraciones se aplicaron y cuándo (<clave>: ISO-8601). Se conserva al
  // guardar para que la web pueda decirlo en vez de cambiar el archivo en silencio.
  migracion: z.record(z.string().max(64)).optional(),
  agentes: z.array(Agente).default([]),
  aristas: z.array(Arista).default([]),
});
export type AgentsConfig = z.infer<typeof AgentsConfig>;

export const CONFIG_FILE = "agents.config.json";

// Re-exporta el registro de skills (cuerpos de prompt) para que check-seeds y
// el resto del módulo accedan por un único punto.
export * from "./skills.js";

// Traducción de un issue de zod a algo legible en la tarjeta de agentes:
// la ruta del campo (agentes[2].rol, aristas[0].tipo) y qué se esperaba.
const TIPOS_ES: Record<string, string> = {
  string: "texto", number: "número", integer: "entero", boolean: "booleano",
  array: "lista", object: "objeto", undefined: "campo ausente", null: "nulo",
};
const rutaLegible = (p: (string | number)[]): string =>
  p.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("").replace(/^\./, "");

function textoIssue(i: ZodIssue): string {
  const donde = i.path.length ? `${rutaLegible(i.path)}: ` : "";
  const iss = i as unknown as { received?: unknown; expected?: string; options?: unknown[]; keys?: string[] };
  if (i.code === "invalid_type") {
    const rec = iss.received === undefined || iss.received === null ? "campo ausente" : `llegó ${TIPOS_ES[String(iss.received)] ?? String(iss.received)}`;
    return `${donde}esperaba ${TIPOS_ES[iss.expected ?? ""] ?? iss.expected} (${rec})`;
  }
  if (i.code === "invalid_enum_value") {
    return `${donde}valor fuera de las opciones válidas (válido: ${(iss.options ?? []).join(" | ")})`;
  }
  if (i.code === "unrecognized_keys") {
    return `${donde}campo no reconocido: ${(iss.keys ?? []).join(", ")}`;
  }
  if (i.code === "too_small") {
    const min = (i as unknown as { minimum?: number }).minimum;
    return `${donde}demasiado corto (mínimo ${min ?? "?"})`;
  }
  if (i.code === "too_big") {
    const max = (i as unknown as { maximum?: number }).maximum;
    return `${donde}demasiado largo (máximo ${max ?? "?"})`;
  }
  return `${donde}${i.message}`;
}

function mensajeZod(error: z.ZodError): string {
  const visibles = error.issues.slice(0, 6).map(textoIssue);
  const extra = error.issues.length > visibles.length ? ` … (+${error.issues.length - visibles.length} más)` : "";
  return visibles.join("; ") + extra;
}

// El grafo por defecto sale de la semilla única (seed.ts), la misma que usa el
// esqueleto de proyecto: antes eran dos listas distintas y divergían.
function defecto(): AgentsConfig {
  return { ...rosterSemilla(), config_version: 2 };
}

// Tipos de arista que sembró un esqueleto viejo con valores inválidos.
// El loader los corrige en memoria en vez de rechazar el config entero:
// projectos creados antes del arreglo cargan sin NO SE PUDO CARGAR.
const TIPO_LEGADO: Record<string, "delega" | "comunica" | "escala"> = { "sin asa": "delega", "revista": "comunica" };

function repararTiposLegado(cfg: unknown): boolean {
  const j = cfg as { aristas?: unknown } | null;
  if (!j || typeof j !== "object" || !Array.isArray(j.aristas)) return false;
  let tocada = false;
  for (const a of j.aristas) {
    const e = a as { tipo?: unknown } | null;
    if (e && typeof e === "object" && typeof e.tipo === "string" && TIPO_LEGADO[e.tipo] !== undefined) {
      e.tipo = TIPO_LEGADO[e.tipo];
      tocada = true;
    }
  }
  return tocada;
}

// Migración: antes de que el broker cruzara la declaración del agente, delegar no
// se declaraba (el esqueleto escribía `herramientas: []`). Ahora el handoff exige
// `delega` declarada en quien delega, así que un config anterior denegaría todos
// los handoffs. Al cargarlo (una sola vez: el config queda sellado en
// `config_version: 2`) se añade `delega=allow` a quien tiene aristas de delegación
// o escala y no la declara; un `deny` explícito no se toca.
function migrarDeclaracionDelega(cfg: unknown): boolean {
  const j = cfg as { agentes?: unknown; aristas?: unknown } | null;
  if (!j || typeof j !== "object" || !Array.isArray(j.agentes) || !Array.isArray(j.aristas)) return false;
  const delegan = new Set<string>();
  for (const a of j.aristas) {
    const e = a as { de?: unknown; tipo?: unknown } | null;
    if (!e || typeof e !== "object" || typeof e.de !== "string") continue;
    if (e.tipo === "delega" || e.tipo === "escala") delegan.add(e.de);
  }
  if (!delegan.size) return false;
  let tocada = false;
  for (const a of j.agentes) {
    const ag = a as { id?: unknown; herramientas?: unknown } | null;
    if (!ag || typeof ag !== "object" || typeof ag.id !== "string" || !delegan.has(ag.id)) continue;
    // Si `herramientas` existe pero no es una lista, el config está roto por otra
    // razón: no se reemplaza (se dejaría al loader validarlo y decirlo).
    if (ag.herramientas !== undefined && !Array.isArray(ag.herramientas)) continue;
    const propias = Array.isArray(ag.herramientas) ? ag.herramientas : [];
    const declara = propias.some((h) => {
      const t = h as { tool?: unknown } | null;
      return !!t && typeof t === "object" && typeof t.tool === "string" && t.tool.trim().toLowerCase() === "delega";
    });
    if (declara) continue;
    ag.herramientas = [...propias, { tool: "delega", acceso: "allow" }];
    tocada = true;
  }
  return tocada;
}

// Escritura atómica: evita que un lector concurrente vea un JSON a medio escribir
// (importante cuando dos procesos reparan el config legado a la vez).
function escribirAtomico(p: string, contenido: string): void {
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, contenido);
  renameSync(tmp, p);
}

export function loadAgents(root: string): { ok: true; config: AgentsConfig; defecto: boolean; reparado?: boolean } | { ok: false; error: string } {
  const p = join(root, CONFIG_FILE);
  if (!existsSync(p)) return { ok: true, config: defecto(), defecto: true };
  try {
    const original = readFileSync(p, "utf8");
    const piolin = JSON.parse(original) as unknown;
    let reparado = false;
    let parsed = AgentsConfig.safeParse(piolin);
    if (!parsed.success && piolin && typeof piolin === "object" && !Array.isArray(piolin)) {
      reparado = repararTiposLegado(piolin);
      if (reparado) parsed = AgentsConfig.safeParse(piolin);
    }
    if (!parsed.success) return { ok: false, error: `agents.config.json inválido: ${mensajeZod(parsed.error)}` };
    // Valida que las aristas apunten a agentes existentes.
    const ids = new Set(parsed.data.agentes.map((a) => a.id));
    const rota = parsed.data.aristas.findIndex((a) => !ids.has(a.de) || !ids.has(a.a));
    if (rota >= 0) {
      const e = parsed.data.aristas[rota];
      const causa = !ids.has(e.de) ? "origen inexistente" : "destino inexistente";
      return { ok: false, error: `aristas[${rota}] rota (${causa}): ${e.de} → ${e.a}` };
    }
    // Migración de una sola vez: un config sin `config_version` (o <2) es anterior
    // a la cota del agente y se sella en 2. Después, la ausencia de `delega` vuelve
    // a significar lo que dice el modelo: no declarado = denegado. Se aplica sobre
    // el JSON crudo y se relee, porque zod descarta las claves que no conoce
    // (p. ej. `nombre`) y persistir parsed.data borraría lo escrito por el usuario.
    const version = typeof (piolin as { config_version?: unknown } | null)?.config_version === "number"
      ? (piolin as { config_version: number }).config_version
      : 1;
    const legado = version < 2;
    const migrado = legado ? migrarDeclaracionDelega(piolin) : false;
    if (migrado && piolin && typeof piolin === "object") {
      // Deja rastro: la web lo muestra en Ajustes → Agentes, así la migración no
      // cambia el archivo sin que el usuario sepa por qué sus agentes declaran más.
      const j = piolin as { migracion?: unknown };
      const previa = j.migracion && typeof j.migracion === "object" && !Array.isArray(j.migracion) ? j.migracion : {};
      j.migracion = { ...previa, delega: new Date().toISOString() };
    }
    if (legado) (piolin as { config_version?: number }).config_version = 2;
    let config = parsed.data;
    if (legado) {
      const relectura = AgentsConfig.safeParse(piolin);
      if (!relectura.success) return { ok: false, error: `migración de delega inválida: ${mensajeZod(relectura.error)}` };
      config = relectura.data;
    }
    if (reparado || legado) {
      // Persiste el config corregido la primera vez. CAS: si otro proceso cambió
      // el archivo mientras reparábamos, no pisamos su versión (evita clobber y
      // escrituras entrelazadas). Escritura atómica (tmp + rename) para que nadie
      // lea JSON a medio escribir. Mejor esfuerzo: si el disco falla, en memoria
      // sigue cargando bien.
      try {
        const actual = readFileSync(p, "utf8");
        if (actual === original) {
          escribirAtomico(p, JSON.stringify(piolin, null, 2) + "\n");
        }
      } catch { /* la carga en memoria ya quedó reparada */ }
      return { ok: true, config, defecto: false, reparado: reparado || migrado ? true : undefined };
    }
    return { ok: true, config, defecto: false };
  } catch (e) {
    return { ok: false, error: `agents.config.json ilegible: ${e instanceof Error ? e.message : e}` };
  }
}

export function saveAgents(root: string, cfg: AgentsConfig): void {
  escribirAtomico(join(root, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n");
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
