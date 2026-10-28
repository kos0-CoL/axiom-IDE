// Demo etapa 8: el orquestador registra artefactos por defecto y al
// completar escribe el manifiesto del run.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-artdef-"));
try {
  const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
  const { AgentOrchestrator } = await import("../dist/orchestrator/orchestrator.js");
  const specRel = escribirSpecPlan(root, "demo", ["demo/a.txt", "demo/b.txt"], "plan");
  const orq = new AgentOrchestrator(root, specRel, {
    generarCodigo: (ruta) => `// ${ruta}\nexport const ok = 1;\n`,
    emitir: () => {},
  });
  const r = await orq.ejecutar();
  const { runIdParaSpec } = await import("../dist/server/run-log.js");
  const dir = join(root, ".runs", runIdParaSpec(specRel), "artefactos");
  const man = JSON.parse(readFileSync(join(dir, "manifiesto.json"), "utf8"));
  console.log(`demo artefactos: estado=${r.estado} archivos=${man.archivos.length} pasados=${man.tests.pasados} version=${man.version}`);
  if (r.estado !== "completo" || man.archivos.length !== 2) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
