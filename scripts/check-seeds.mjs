// Check de seeds: cada seed por defecto (agents/adapters/telegram) debe pasar
// SIEMPRE por su schema zod. Si alguien edita un seed a mano y el schema según
// queda atrás, esto rompe el build en vez de que el runtime cargue basura.
// Caminos reales que vigila (no duplicados estáticos):
//  - agents: defecto() del loader (proyecto sin archivo) y el esqueleto que
//    escribe asegurarProyecto (agents.config.json del proyecto nuevo).
//  - adapters: literal de loadConfig cuando no hay archivo (adapters.config.json ausente).
//  - telegram: literal de loadConfig cuando no hay archivo (ni legacy).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const dist = join(aqui, "..", "dist");

const { loadAgents, AgentsConfig, SKILLS, Skill } = await import(join(dist, "modules", "agents", "config.js"));
const { asegurarProyecto } = await import(join(dist, "proyectos.js"));
const { loadConfig: loadAdapters, AdaptersConfig } = await import(join(dist, "modules", "adapters", "config.js"));
const { loadConfig: loadTelegram, TelegramConfig } = await import(join(dist, "modules", "telegram", "config.js"));

const fallos = [];
const chequear = (nombre, ok, detalle) => { if (!ok) fallos.push(`${nombre}: ${detalle}`); };
const temp = () => mkdtempSync(join(tmpdir(), "axiom-seed-check-"));

// SEED 1 — agents: defecto() del loader (raíz sin agents.config.json).
{
  const r = temp();
  try {
    const carga = loadAgents(r);
    const parse = AgentsConfig.safeParse(carga.ok ? carga.config : carga.error);
    chequear("agents/default", carga.ok && carga.defecto === true && parse.success,
      carga.ok ? JSON.stringify(parse.success ? [] : parse.error.issues.map((i) => [i.path.join("."), i.message])).slice(0, 300) : (carga.error ?? ""));
  } finally { rmSync(r, { recursive: true, force: true }); }
}

// SEED 2 — agents: esqueleto que escribe el proyecto nuevo (agents.config.json sembrado).
{
  const r = temp();
  try {
    const creado = asegurarProyecto(r);
    const carga = loadAgents(r);
    const parse = AgentsConfig.safeParse(carga.ok ? carga.config : carga.error);
    chequear("agents/esqueleto", creado.ok === true && carga.ok && carga.defecto === false && parse.success,
      parse.success ? "" : JSON.stringify(parse.error?.issues.map((i) => [i.path.join("."), i.message])).slice(0, 300));
  } finally { rmSync(r, { recursive: true, force: true }); }
}

// SEED 3 — adapters: literal para raíz sin adapters.config.json (fail closed: proveedor off).
{
  const r = temp();
  try {
    const carga = loadAdapters(r);
    const parse = AdaptersConfig.safeParse(carga.ok ? carga.config : carga.error);
    const proxima = parse.success ? carga.config : null;
    chequear("adapters/default", carga.ok && parse.success && proxima?.proveedor === "off",
      parse.success ? `seed sin proveedor off: ${JSON.stringify(carga.config)}` : JSON.stringify(parse.error?.issues.map((i) => [i.path.join("."), i.message])).slice(0, 300));
  } finally { rmSync(r, { recursive: true, force: true }); }
}

// SEED 4 — telegram: literal para raíz sin telegram.config.json ni telegram.allowlist.json.
{
  const r = temp();
  try {
    const carga = loadTelegram(r);
    const parse = TelegramConfig.safeParse(carga.ok ? carga.config : carga.error);
    const cfg = parse.success ? carga.config : null;
    chequear("telegram/default", carga.ok && !carga.migrated && parse.success && cfg?.enabled === false && cfg?.expiracionMin === 30,
      parse.success ? `seed con estado legacy on: ${JSON.stringify(carga.config)}` : JSON.stringify(parse.error?.issues.map((i) => [i.path.join("."), i.message])).slice(0, 300));
  } finally { rmSync(r, { recursive: true, force: true }); }
}

// SEED 5 — agents: skills registrados (cuerpos de prompt) pasan su schema y cubren
// todos los skills que referencia el seed por defecto (sin drift silencioso).
{
  const parseSkills = SKILLS.map((s) => Skill.safeParse(s));
  const todosOk = parseSkills.every((r) => r.success);
  chequear("agents/skills", todosOk,
    todosOk ? "" : JSON.stringify(parseSkills.filter((r) => !r.success).map((r) => r.error.issues.map((i) => [i.path.join("."), i.message]))).slice(0, 300));
  // Cobertura: todo skill id referenciado por defecto() debe tener cuerpo.
  const rtmp = temp();
  const carga = loadAgents(rtmp);
  if (carga.ok) {
    const ids = new Set(SKILLS.map((s) => s.id));
    const faltantes = [...new Set(carga.config.agentes.flatMap((a) => a.skills))].filter((s) => !ids.has(s));
    chequear("agents/skills-cobertura", faltantes.length === 0,
      faltantes.length ? `skills sin cuerpo: ${faltantes.join(", ")}` : "");
  }
  rmSync(rtmp, { recursive: true, force: true });
}

if (fallos.length > 0) {
  console.error(`seeds: ${fallos.length} drift(es)`);
  for (const f of fallos) console.error(`SEED ${f}`);
  process.exit(1);
}
console.log("seeds OK (agents default+esqueleto, adapters, telegram)");
