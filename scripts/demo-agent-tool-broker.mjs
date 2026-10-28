// Simulación con broker real: roster temporal que declara la tool,
// autorización vía autorizarPorBroker (política + declaración + traza).
// Caso 1 (declarada) → allow y el padre sintetiza; caso 2 (no declarada)
// → deny fail closed sin ejecutar nada.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-agenttool-"));
try {
  const { autorizarPorBroker, invocarAgenteComoTool } = await import("../dist/orchestrator/agent-tool.js");
  writeFileSync(
    join(root, "agents.config.json"),
    JSON.stringify({
      config_version: 2,
      agentes: [{ id: "revisor", rol: "nodo", herramientas: [{ tool: "revisor-como-tool", acceso: "allow" }] }],
      aristas: [],
    }),
  );
  const autorizar = autorizarPorBroker(root, "demo-broker");
  const ok = await invocarAgenteComoTool(
    { agenteId: "revisor", tool: "revisor-como-tool", descripcion: "revisa el archivo" },
    { tarea: "revisa demo/a.txt: busca validación faltante", parentCallId: "demo-run" },
    {
      autorizar,
      ejecutar: () => "hallazgo: demo/a.txt escribe sin validar el path (línea 1)",
      sintetizar: (hijo) => `padre: recibido del hijo → ${hijo}`,
    },
  );
  const no = await invocarAgenteComoTool(
    { agenteId: "revisor", tool: "tool-no-declarada", descripcion: "otra" },
    { tarea: "haz algo", parentCallId: "demo-run" },
    { autorizar, ejecutar: () => "esto nunca debe correr" },
  );
  console.log(`demo broker: declarada ok=${ok.ok} salida=${JSON.stringify(ok.salida)}`);
  console.log(`trace: ${ok.traza.map((t) => `${t.padre}→${t.hijo} [${t.decision}]`).join(", ")}`);
  console.log(`demo broker: no-declarada ok=${no.ok} error=${JSON.stringify(no.error)}`);
  if (!ok.ok || !ok.salida.includes("padre:") || no.ok) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
