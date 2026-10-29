// B2 — boundaries por CI, no por prompt.
// Reglas: ui -> store,policy (no sandbox,broker); telegram canal -> broker vía adapter/bot (no store directo desde transporte); web (webhook) -> bot/transport del canal, decide el broker;
// broker -> policy,store,contracts; sandbox -> ninguno interno; preset -> ninguno.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const rules = {
  "ui.ts": ["./store.js", "./policy.js", "./staging.js"],
  "staging.ts": ["./store.js"],
  "broker.ts": ["./store.js", "./policy.js", "./contracts.js"],
  "telegram.ts": ["./modules/telegram/adapter.js", "./modules/telegram/transport.js", "./modules/telegram/bot.js"],
  "adapters.ts": ["./modules/adapters/index.js", "./modules/adapters/openai_compat.js", "./modules/adapters/route.js"],
  "agents.ts": ["./modules/agents/index.js"],
  // skills: fachada delgada; el módulo lee/escribe skills/<id>/SKILL.md y el núcleo no conoce su lógica.
  // El runner de scripts (axiom skills run) es parte del módulo: se expone por
  // acá para que commands.ts no entre directo al módulo.
  "skills.ts": ["./modules/skills/index.js", "./modules/skills/runner.js"],
  // constitution: principios versionados del proyecto; solo fs + fechas, sin
  // acoplamiento interno (lo leen la CLI y la web para el prompt).
  "constitution.ts": [],
  // env: la única lectura de process.env del servidor (hoja, sin imports internos).
  "env.ts": [],
  "secrets.ts": ["./env.js"],
  "components.ts": ["./store.js"],
  "sandbox.ts": [],
  // pricing: precios declarados por el proyecto y fórmula de costo. Hoja: solo fs;
  // el contrato del uso se describe por estructura, sin importar el módulo de adapters.
  "pricing.ts": [],
  // sessions importa solo el texto del baseline anti-inyección (sin lógica de agents).
  "sessions.ts": ["./store.js", "./modules/agents/defensa.js"],
  // proyectos importa el catálogo de skills (datos puros: schema zod + textos) para
  // escribir skills/<id>/SKILL.md desde una sola fuente, y la semilla de agentes
  // (datos puros) para que el esqueleto y el loader compartan el mismo grafo.
  "proyectos.ts": ["./store.js", "./modules/agents/skills.js", "./modules/agents/seed.js"],
  "modulos.ts": ["./modules/module-builder.js"],
  "runmark.ts": ["./store.js"],
  "experience.ts": ["./store.js"],
  "web.ts": ["./ui.js", "./broker.js", "./sessions.js", "./proyectos.js", "./modulos.js", "./adapters.js", "./agents.js", "./secrets.js", "./modules/telegram/bot.js", "./modules/telegram/transport.js", "./modules/telegram/adapter.js", "./modules/telegram/config.js", "node:url", "./modules/agents/config.js", "./modules/agents/handoff.js", "./modules/adapters/index.js", "./modules/adapters/config.js", "./modules/module-builder.js", "./commands.js", "./staging.js", "./chat-build.js", "./experience.js", "./web.js", "./skills.js", "./modules/skills/index.js", "./modules/buscar/clave.js", "./spec/investigar.js", "./constitution.js"],
  "policy.ts": ["./contracts.js"],
  "preset.ts": [],
  "store.ts": [],
  "chat-build.ts": ["./store.js", "./sessions.js"],
  "contracts.ts": [],
  // vocabulario: guardia de docs (ADR-0007), lógica pura + fs, sin imports internos.
  "vocabulario.ts": [],
  "cli.ts": ["./commands.js", "./telegram.js", "./adapters.js", "./agents.js", "./secrets.js", "./sandbox.js", "./modulos.js", "./skills.js", "./modules/browser/sesion.js", "./constitution.js"],
  // commands es el despachador de la CLI: implementa `clarify` y `skills run`
  // en el núcleo, así que ve la lógica pura de clarify y las fachadas, nunca
  // los módulos de transporte ni el broker de otro canal.
  "commands.ts": ["./store.js", "./env.js", "./contracts.js", "./preset.js", "./broker.js", "./policy.js", "./ui.js", "./components.js", "./sandbox.js", "./web.js", "./runmark.js", "./staging.js", "./adapters.js", "./experience.js", "./modulos.js", "./modules/agents/index.js", "./modules/browser/index.js", "./modules/browser/sesion.js", "./modules/clarify/index.js", "./skills.js"],
};
let errors = 0;
for (const f of readdirSync(root).filter((x) => x.endsWith(".ts"))) {
  const src = readFileSync(join(root, f), "utf8");
  const imports = [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((m) => m[1]);
  const allowed = rules[f];
  if (allowed === null) continue;
  if (!(f in rules)) { console.error(`BOUNDARY ${f}: archivo no declarado`); errors++; continue; }
  for (const imp of imports) {
    if (!allowed.includes(imp) && imp.startsWith(".")) {
      console.error(`BOUNDARY ${f} importa ${imp} — permitido: ${allowed.join(", ") || "(nada)"}`);
      errors++;
    }
  }
}
if (errors > 0) { console.error(`boundaries: ${errors} violaciones`); process.exit(1); }
console.log("boundaries OK");
