// Demo etapa 7: el coder siempre devuelve cháchara + código; el orquestador
// compone la variante saneada sin contar fallo y registra la lección.
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-varorq-"));
try {
  const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
  const { AgentOrchestrator } = await import("../dist/orchestrator/orchestrator.js");
  const specRel = escribirSpecPlan(root, "demo", ["demo/a.txt"], "plan");
  const orq = new AgentOrchestrator(root, specRel, {
    generarCodigo: () => "Aquí tienes el código:\nexport const a = 1;\n",
    emitir: (e) => console.log(`  evento: ${e.type}${e.ruta ? ` ${e.ruta}` : ""}${e.mensaje ? ` — ${e.mensaje.slice(0, 80)}` : ""}`),
  });
  const r = await orq.ejecutar();
  const exp = readFileSync(join(root, "EXPERIENCE.md"), "utf8");
  console.log(`demo variantes-orq: estado=${r.estado} fallos=${JSON.stringify(r.fallos)} escrito=${existsSync(join(root, "demo", "a.txt"))}`);
  if (r.estado !== "completo" || !exp.includes("v2-saneado-local")) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
