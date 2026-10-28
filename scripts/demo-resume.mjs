// Demo etapa 3: build que se pausa a mitad (3 fallos) y reanuda con
// reanudarBuild hasta `complete` sin repetir lo ya escrito.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-resume-"));
try {
  const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
  const { AgentOrchestrator } = await import("../dist/orchestrator/orchestrator.js");
  const { anexarEvento } = await import("../dist/server/run-log.js");
  const { reanudarBuild } = await import("../dist/orchestrator/resume.js");
  const { runIdParaSpec } = await import("../dist/server/run-log.js");

  const specRel = escribirSpecPlan(root, "demo", ["demo/uno.txt", "demo/dos.txt"], "plan");
  const runId = runIdParaSpec(specRel);
  // Primera pasada: uno.txt siempre falla → pausa tras 3 intentos.
  const mal = new AgentOrchestrator(root, specRel, {
    generarCodigo: () => "x",
    emitir: () => {},
    maxFallos: 3,
  });
  const p1 = await mal.ejecutar();
  // Reanuda con coder bueno: debe escribir los 2 (el resume sincroniza el log).
  anexarEvento(root, `${runId}-2`, { type: "status", mensaje: "noop" });
  const r = await reanudarBuild(root, specRel, {
    generarCodigo: (ruta) => `// ${ruta}\nexport const ok = 1;\n`,
    emitir: (e) => console.log(`  evento: ${e.type}${e.ruta ? ` ${e.ruta}` : ""}`),
  }, { runId });
  const ok = existsSync(join(root, "demo", "uno.txt")) && existsSync(join(root, "demo", "dos.txt"));
  console.log(`demo resume: primera=${p1.estado} final=${r.estado} archivos=${ok ? "2/2" : "FALTAN"}`);
  if (r.estado !== "completo" || !ok) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
