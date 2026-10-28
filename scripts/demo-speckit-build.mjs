// Demo del cimiento Speckit: architect (plan) → orchestrator (coder stub +
// validator + filesystem real). Prueba: escribe un archivo y marca su checkbox.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-build-"));
try {
  const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
  const { AgentOrchestrator } = await import("../dist/orchestrator/orchestrator.js");

  const specRel = escribirSpecPlan(root, "demo", ["demo/saludo.txt"], "plan");
  const eventos = [];
  const orq = new AgentOrchestrator(root, specRel, {
    generarCodigo: () => "export const saludo = \"hola\";\n",
    emitir: (e) => eventos.push(e),
  });
  const r = await orq.ejecutar();
  const archivo = join(root, "demo", "saludo.txt");
  const spec = readFileSync(join(root, specRel), "utf8");
  const okArchivo = existsSync(archivo);
  const okMarca = /- \[X\] demo\/saludo\.txt/.test(spec);
  console.log(`demo build: estado=${r.estado} archivo=${okArchivo ? "escrito" : "FALTA"} marca=${okMarca ? "[X]" : "FALTA"}`);
  console.log(`eventos: ${eventos.map((e) => e.type).join(" → ")}`);
  if (r.estado !== "completo" || !okArchivo || !okMarca) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
