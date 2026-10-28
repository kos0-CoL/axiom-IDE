// Demo etapa 9: el especialista sale del roster (prompt con sus skills) y
// el spawn está stubbed para no gastar tokens; el broker autoriza de verdad.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-agentroster-"));
try {
  const { autorizarPorBroker, ejecutarConRoster, invocarAgenteComoTool } = await import("../dist/orchestrator/agent-tool.js");
  writeFileSync(
    join(root, "agents.config.json"),
    JSON.stringify({
      config_version: 2,
      agentes: [{ id: "revisor", rol: "nodo", herramientas: [{ tool: "revisor-como-tool", acceso: "allow" }] }],
      aristas: [],
    }),
  );
  const r = await invocarAgenteComoTool(
    { agenteId: "revisor", tool: "revisor-como-tool", descripcion: "revisa" },
    { tarea: "revisa demo/a.txt", parentCallId: "demo-run" },
    {
      autorizar: autorizarPorBroker(root, "demo-roster"),
      ejecutar: (t, o) =>
        ejecutarConRoster(root, "revisor", t, {
          ...o,
          spawnFn: () => ({ ok: true, text: "hallazgo: falta validación (línea 3)", ms: 1, proveedor: "demo", model: "demo" }),
        }),
      sintetizar: (hijo) => `padre: ${hijo}`,
    },
  );
  console.log(`demo roster: ok=${r.ok} salida=${JSON.stringify(r.salida)} trace=${r.traza[0].padre}→${r.traza[0].hijo} [${r.traza[0].decision}]`);
  if (!r.ok || !r.salida.startsWith("padre: hallazgo")) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
