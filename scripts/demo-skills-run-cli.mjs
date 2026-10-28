// Demo etapa 10: skill en formato estándar + `skills run` vía construirSkillsRun.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-skillsrun-"));
try {
  const { guardarSkill, leerSkill } = await import("../dist/modules/skills/index.js");
  const { construirSkillsRun } = await import("../dist/commands.js");
  guardarSkill(root, "demo", { descripcion: "skill de ejemplo", cuerpo: "Saluda." });
  mkdirSync(join(root, "skills", "demo", "scripts"), { recursive: true });
  writeFileSync(join(root, "skills", "demo", "scripts", "saluda.sh"), "#!/bin/sh\necho saludo-cli\n");
  const leida = leerSkill(root, "demo");
  const r = construirSkillsRun(root, "demo", "scripts/saluda.sh");
  const ultima = r.msg.split("\n").filter(Boolean).pop();
  console.log(`demo skills-run: descripcion=${leida.ok ? leida.skill.descripcion : "?"} code=${r.code} salida=${JSON.stringify(ultima)}`);
  if (!r.msg.includes("saludo-cli") || r.code !== 0) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
