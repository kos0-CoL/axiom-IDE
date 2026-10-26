import { homedir } from "node:os";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDb } from "./store.js";
// Catálogo único de skills (datos puros: id + descripción + cuerpo). El esqueleto
// escribe skills/<id>/SKILL.md desde aquí; no hay segunda lista que se desincronice.
import { SKILLS, skillMarkdown } from "./modules/agents/skills.js";

// Proyectos = carpetas en el servidor, cada una con su propio store.SQLite.
// La web crea la carpeta (specs, políticas, SQLite) y cambia a ella sin reiniciar.

const RECIENTES_FILE = ".axiom-recientes.json";



function readmeDefecto(nom: string): string {
  return `# ${nom}

Proyecto Axiom (harness SDD). Este esqueleto se crea listo para trabajar:

 fracking- \`specs/active/\` — specs, planes y tareas por_iteración (spec.md / plan.md / tasks.md).
- \`skills/\` — 8 skills con descriptors (plan, implementar, verify, review…).
- \`agents.config.json\` — grafo de orquestación (orquestador → nodos → especializados).
- \`PRODUCT.md\` / \`TECH.md\` — visión de producto y decisiones técnicas.
- \`docs/decisions/\` — ADRs.

Edítilos a mano cuando cambie el rumbo; el chat los usa como contexto.`;
}

function productDefecto(nom: string): string {
  return `# PRODUCT — ${nom}

## Problema
<quién sufre qué, hoy, sin este producto>

## Usuario objetivo
<segmento concreto>

## Propuesta de valor
<qué cambia para el usuario>

## Alcance actual (MVP)
1. <capacidad esencial 1>
2. <capacidad esencial 2>

## Fuera de alcance (ahora)
- <cosas que explícitamente no toca esta fase>

## Métricas
- <cómo se mide que funciona>`;
}

function techDefecto(nom: string): string {
  return `# TECH — ${nom}

## Stack
- <lenguaje, framework, base de datos>

## Estructura
- <carpetas clave y qué vive en cada una>

## Convenciones
- <naming, estilo de commits, manejo de errores>

## Entorno
- <cómo correr local: install, dev, test>

## Riesgos técnicos
- <deudas o límites conocidos>`;
}

function agentsConfigDefecto(nom: string): Record<string, unknown> {
  return {
    nombre: nom,
    agentes: [
      { id: "orquestador", rol: "orquestador", skills: ["policy", "broker"], instrucciones: "Divide el trabajo por skill, delega y consolida. No ejecuta tareas especializadas por sí mismo." },
      { id: "planificador", rol: "nodo", skills: ["plan"], instrucciones: "Recibe el objetivo y produce el plan numerado." },
      { id: "implementador", rol: "nodo", skills: ["implementar"], instrucciones: "Ejecuta el plan en archivos del workspace; anuncia cada archivo tocado." },
      { id: "verificador", rol: "nodo", skills: ["verify", "evidence"], instrucciones: "Prueba con comandos reales y registra evidencias." },
      { id: "revisor", rol: "nodo", skills: ["review"], instrucciones: "Doble eje: Standards y Spec. No aprueba sin evidencia." },
      { id: "cazador-fallos", rol: "especializado", skills: ["silent-failures", "error-propagation"], instrucciones: "Caza fallos silenciosos: catches vacíos, fallbacks peligrosos, errores no propagados. Reporta ubicación + fallo concreto." },
      { id: "reparador-build", rol: "especializado", skills: ["build-fix", "minimal-diff"], instrucciones: "Arregla errores de build/tipos con cambios mínimos; sin refactors ni cambios arquitectónicos." },
    ],
    aristas: [
      { de: "orquestador", a: "planificador", tipo: "delega" },
      { de: "orquestador", a: "implementador", tipo: "delega" },
      { de: "orquestador", a: "verificador", tipo: "delega" },
      { de: "implementador", a: "verificador", tipo: "delega" },
      { de: "verificador", a: "revisor", tipo: "comunica" },
      { de: "orquestador", a: "cazador-fallos", tipo: "escala" },
      { de: "orquestador", a: "reparador-build", tipo: "delega" },
    ],
  };
}
const MAX_RECIENTES = 10;

export function baseProyectos(): string {
  return homedir();
}

function recientesPath(): string {
  return join(homedir(), RECIENTES_FILE);
}

export function leerRecientes(): string[] {
  try {
    const j = JSON.parse(readFileSync(recientesPath(), "utf8")) as unknown;
    if (!Array.isArray(j)) return [];
    // Las rutas que ya no existen se descartan: no deben ocupar cupo del tope ni
    // ensuciar el árbol (quedan de pruebas viejas o de carpetas borradas a mano).
    return j.filter((x): x is string => typeof x === "string" && x.length > 0 && existsSync(x)).slice(0, MAX_RECIENTES);
  } catch {
    return [];
  }
}

export function recordar(path: string): string[] {
  const lista = [path, ...leerRecientes().filter((x) => x !== path)].slice(0, MAX_RECIENTES);
  try {
    writeFileSync(recientesPath(), JSON.stringify(lista, null, 2) + "\n", { mode: 0o600 });
  } catch {
    /* mejor esfuerzo */
  }
  return lista;
}

// Quitar de la lista (no toca el disco): el proyecto deja de aparecer en el árbol
// pero se puede volver a abrir escribiendo su ruta.
export function olvidarProyecto(path: string): { ok: true; recientes: string[] } | { ok: false; error: string } {
  const abs = resolve(String(path ?? "").trim());
  const lista = leerRecientes();
  if (!lista.includes(abs)) return { ok: false, error: `no está en la lista de proyectos: ${abs}` };
  const nueva = lista.filter((x) => x !== abs);
  try {
    writeFileSync(recientesPath(), JSON.stringify(nueva, null, 2) + "\n", { mode: 0o600 });
  } catch (e) {
    return { ok: false, error: `no se pudo actualizar la lista: ${e instanceof Error ? e.message : e}` };
  }
  return { ok: true, recientes: nueva };
}

// Borrar del disco. Solo proyectos de la lista de recientes, nunca el activo, el
// directorio personal, la raíz ni el directorio desde el que corre el servidor.
export function borrarProyecto(path: string, activo: string): { ok: true; path: string } | { ok: false; error: string } {
  const abs = resolve(String(path ?? "").trim());
  const protegidas = new Set(["/", resolve(homedir()), resolve(process.cwd())]);
  if (protegidas.has(abs)) return { ok: false, error: `ruta protegida, no se borra: ${abs}` };
  if (abs === resolve(String(activo ?? "").trim())) return { ok: false, error: "es el proyecto activo; activa otro antes de borrarlo" };
  if (!leerRecientes().includes(abs)) return { ok: false, error: `solo se borran proyectos de la lista: ${abs}` };
  if (!existsSync(join(abs, "axiom.json"))) return { ok: false, error: `no parece un proyecto axiom (falta axiom.json): ${abs}` };
  try {
    rmSync(abs, { recursive: true, force: true });
  } catch (e) {
    return { ok: false, error: `no se pudo borrar: ${e instanceof Error ? e.message : e}` };
  }
  olvidarProyecto(abs);
  return { ok: true, path: abs };
}

export function validarRutaProyecto(p: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof p !== "string" || !p.trim()) return { ok: false, error: "ruta requerida" };
  const abs = resolve(p.trim());
  if (!existsSync(abs)) return { ok: false, error: `la carpeta no existe en el servidor: ${abs}` };
  try {
    if (!lstatSync(abs).isDirectory()) return { ok: false, error: `no es una carpeta: ${abs}` };
  } catch {
    return { ok: false, error: `ruta ilegible: ${abs}` };
  }
  return { ok: true, path: abs };
}

// Crea el esqueleto mínimo sin pisar nada existente (idempotente).
// Lo usan crear (carpeta nueva) y usar (carpeta existente sin inicializar).
export function asegurarProyecto(path: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(join(path, "specs", "active"), { recursive: true });
    mkdirSync(join(path, "docs", "decisions"), { recursive: true });
    const ponDefecto = (rel: string, contenido: string): void => {
      const f = join(path, rel);
      const dir = f.slice(0, f.lastIndexOf("/"));
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(f)) writeFileSync(f, contenido);
    };
    const nom = path.split("/").filter(Boolean).pop() ?? "proyecto";
    ponDefecto("axiom.json", JSON.stringify({ name: nom, harness: "0.9.21", preset: "axiom" }, null, 2) + "\n");
    ponDefecto(
      "policies.global.json",
      JSON.stringify({ tools: { terminal: false }, techo: { rondas: 3, tokens: 100000, calls: 500 } }, null, 2) + "\n",
    );
    ponDefecto(
      "project.json",
      JSON.stringify({ tools: {}, presupuesto: { tokens: 50000, calls: 200 } }, null, 2) + "\n",
    );
    // Esqueleto legible y completo desde el día 1: README, docs de producto,
    // grafo de agentes con skills reales y sus descriptors. Idempotente: nunca
    // pisa lo que ya existe.
    ponDefecto("README.md", readmeDefecto(nom) + "\n");
    ponDefecto("PRODUCT.md", productDefecto(nom) + "\n");
    ponDefecto("TECH.md", techDefecto(nom) + "\n");
    ponDefecto(
      "AGENTS.md",
      `# AGENTS.md

Reglas del harness en este proyecto:
- Global > proyecto; sin evidencia no hay verificado ni aceptado.
- Specs en specs/active/<id>/{spec,plan,tasks}.md; decisiones en docs/decisions/.
- Skills en skills/<nombre>/SKILL.md: el chat usa [enfoque skill] para dirigir la respuesta.
- El grafo de agentes vive en agents.config.json (orquestador → nodos → especializados).
- No commitear axiom.db ni secretos. Sin respuesta del proveedor no hay aprobación.

Comandos útiles (axiom CLI):
- axiom spec|plan|tasks|verify|run — ciclo SDD del preset.
- axiom serve <puerto> — servidor web (chat, ajustes, módulos).
` + "\n",
    );
    ponDefecto("agents.config.json", JSON.stringify(agentsConfigDefecto(nom), null, 2) + "\n");
    for (const s of SKILLS) {
      ponDefecto(join("skills", s.id, "SKILL.md"), skillMarkdown(s));
    }
    ponDefecto("docs/decisions/ADR-0001-inicio.md", `# ADR-0001 — Inicio del proyecto

Fecha: ${new Date().toISOString().slice(0, 10)}

## Contexto
Proyecto creado por Axiom con el esqueleto SDD por defecto.

## Decisión
Se adopta specs/active + docs/decisions + skills como estructura de trabajo.

## Consecuencias
Los planes aprobados y sus evidencias quedan versionables junto al código.
` + "\n");
    const db = openDb(path);
    db.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `no se pudo inicializar: ${e instanceof Error ? e.message : e}` };
  }
}

export function crearProyecto(
  base: unknown,
  nombre: unknown,
): { ok: true; path: string } | { ok: false; error: string } {
  const nom = typeof nombre === "string" ? nombre.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(nom)) {
    return { ok: false, error: "nombre inválido: letras, números, - y _ (1-64, empieza con letra o número)" };
  }
  const b = typeof base === "string" && base.trim() ? base.trim() : homedir();
  const baseAbs = resolve(b);
  if (!existsSync(baseAbs)) return { ok: false, error: `la carpeta base no existe en el servidor: ${baseAbs}` };
  try {
    if (!lstatSync(baseAbs).isDirectory()) return { ok: false, error: `la base no es una carpeta: ${baseAbs}` };
  } catch {
    return { ok: false, error: `base ilegible: ${baseAbs}` };
  }
  const path = join(baseAbs, nom);
  if (existsSync(path)) return { ok: false, error: `ya existe: ${path}` };
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    return { ok: false, error: `no se pudo crear: ${e instanceof Error ? e.message : e}` };
  }
  const ini = asegurarProyecto(path);
  if (!ini.ok) return ini;
  recordar(path);
  return { ok: true, path };
}
