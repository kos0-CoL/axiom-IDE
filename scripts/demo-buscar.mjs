// Demo etapa 11: enrich gateado — ask → aprobación humana → allow con
// EXA stubbed (sin red); sin key, fail closed tras aprobar.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-buscar-"));
process.env.EXA_API_KEY = "demo-key";
try {
  const { enriquecerConBusqueda } = await import("../dist/modules/buscar/index.js");
  const { decide } = await import("../dist/broker.js");
  const { declaracionDeHerramienta } = await import("../dist/modules/agents/declaracion.js");
  writeFileSync(
    join(root, "agents.config.json"),
    JSON.stringify({
      config_version: 2,
      agentes: [{ id: "explorador", rol: "nodo", herramientas: [{ tool: "buscar", acceso: "allow" }] }],
      aristas: [],
    }),
  );
  writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools: { buscar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }));
  const stub = () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ title: "Harness ref", url: "https://ejemplo.test/h", text: "los harnesses componen evidencia" }] }),
    });
  const p1 = await enriquecerConBusqueda(root, "explorador", "harness agentico", { fetchFn: stub });
  let ok = { estado: "?" };
  if (p1.estado === "pendiente") {
    decide(root, p1.approvalId, true, "demo", 30, declaracionDeHerramienta(root, "explorador", "buscar"));
    ok = await enriquecerConBusqueda(root, "explorador", "harness agentico", { fetchFn: stub });
  }
  delete process.env.EXA_API_KEY;
  const sinKey = await buscarSinKey();
  async function buscarSinKey() {
    const r = await import("../dist/modules/buscar/index.js").then((m) => m.buscarExterno(root, "x", { fetchFn: stub }).then(
      () => ({ estado: "inesperado" }),
      (e) => ({ estado: /EXA_API_KEY/.test(e.message) ? "denegado" : "otro" }),
    ));
    return r;
  }
  console.log(`demo buscar: loop=${ok.estado} refs=${ok.estado === "ok" ? ok.resultados.length : 0} sin-key=${sinKey.estado}`);
  if (ok.estado !== "ok" || sinKey.estado !== "denegado") {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  delete process.env.EXA_API_KEY;
  rmSync(root, { recursive: true, force: true });
}
