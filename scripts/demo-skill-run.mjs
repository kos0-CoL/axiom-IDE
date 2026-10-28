// Demo etapa 1: instala una skill de ejemplo, corre su script con timeout
// y lista presencia de keys sin valores (nunca el valor).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-skill-"));
try {
  const { serializarSkillEstandar } = await import("../dist/modules/skills/frontmatter.js");
  const { ejecutarScriptSkill } = await import("../dist/modules/skills/runner.js");
  mkdirSync(join(root, "skills", "demo"), { recursive: true });
  writeFileSync(join(root, "skills", "demo", "SKILL.md"), serializarSkillEstandar({ name: "demo", descripcion: "skill de ejemplo", cuerpo: "Saluda." }));
  writeFileSync(join(root, "skills", "demo", "saluda.sh"), `#!/bin/sh\necho saludo-desde-skill\n`);
  const r = ejecutarScriptSkill(root, "demo", "saluda.sh", { timeoutMs: 5000 });
  const presencia = `OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ? "presente" : "ausente"}`;
  console.log(`demo skill-run: ok=${r.ok} salida=${JSON.stringify(r.salida.trim())} sha=${r.sha256.slice(0, 8)} ${presencia}`);
  if (!r.ok || !r.salida.includes("saludo-desde-skill")) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
