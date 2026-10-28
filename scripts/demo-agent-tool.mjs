// Demo etapa 2: el orquestador delega una subtarea al especialista-tool,
// el padre sintetiza y el trace muestra padre→hijo enlazados.
const { invocarAgenteComoTool } = await import("../dist/orchestrator/agent-tool.js");

const r = await invocarAgenteComoTool(
  { agenteId: "review", tool: "review-as-tool", descripcion: "revisa el archivo" },
  { tarea: "revisa demo/a.txt: busca validación faltante", parentCallId: "demo-run" },
  {
    autorizar: () => ({ decision: "allow" }),
    ejecutar: () => "hallazgo: demo/a.txt escribe sin validar el path (línea 1)",
    sintetizar: (hijo) => `padre: recibido del hijo → ${hijo}`,
  },
);
console.log(`demo agent-tool: ok=${r.ok} salida=${JSON.stringify(r.salida)}`);
console.log(`trace: ${r.traza.map((t) => `${t.padre}→${t.hijo} [${t.decision}]`).join(", ")}`);
if (!r.ok || !r.salida.includes("padre:")) {
  console.error("DEMO FALLIDA");
  process.exit(1);
}
console.log("DEMO OK");
