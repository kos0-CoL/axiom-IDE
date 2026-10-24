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
  "secrets.ts": [],
  "components.ts": ["./store.js"],
  "sandbox.ts": [],
  "sessions.ts": ["./store.js"],
  "proyectos.ts": ["./store.js"],
  "modulos.ts": ["./modules/module-builder.js"],
  "runmark.ts": ["./store.js"],
  "experience.ts": ["./store.js"],
  "web.ts": ["./ui.js", "./broker.js", "./sessions.js", "./proyectos.js", "./modulos.js", "./adapters.js", "./agents.js", "./secrets.js", "./modules/telegram/bot.js", "./modules/telegram/transport.js", "./modules/telegram/adapter.js", "./modules/telegram/config.js", "node:url", "./modules/agents/config.js", "./modules/agents/handoff.js", "./modules/adapters/index.js", "./modules/adapters/config.js", "./modules/module-builder.js", "./commands.js", "./staging.js", "./experience.js", "./web.js"],
  "policy.ts": ["./contracts.js"],
  "preset.ts": [],
  "store.ts": [],
  "contracts.ts": [],
  "cli.ts": ["./commands.js", "./telegram.js", "./adapters.js", "./agents.js", "./secrets.js", "./sandbox.js", "./modulos.js"],
  "commands.ts": ["./store.js", "./contracts.js", "./preset.js", "./broker.js", "./policy.js", "./ui.js", "./components.js", "./sandbox.js", "./web.js", "./runmark.js", "./staging.js", "./adapters.js", "./experience.js", "./modulos.js", "./modules/agents/index.js"],
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
