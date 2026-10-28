// Demo end-to-end cableada: servidor SSE → AgentOrchestrator →
// generarCodigoLLM (fetch stubbed, cero tokens) → filesystem real.
// Prueba: 2 archivos escritos, sus 2 checkboxes marcados y la secuencia
// status → file_start → file_success (×2) → complete.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url, init) => {
  if (String(url).includes("/v1/chat/completions")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const m = /Archivo objetivo: (\S+)/.exec(body?.messages?.[0]?.content ?? "");
    const ruta = m ? m[1] : "demo/salida.txt";
    const content = `// ${ruta}\nexport const ok = "${ruta}";\n`;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }
  return fetchReal(url, init);
});

const root = mkdtempSync(join(tmpdir(), "axiom-demo-e2e-"));
try {
  const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
  const { generarCodigoLLM } = await import("../dist/nodes/coder-llm.js");
  const { crearServidorBuild } = await import("../dist/server/build-events.js");

  const archivos = ["demo/uno.txt", "demo/dos.txt"];
  const specRel = escribirSpecPlan(root, "demo", archivos, "plan");
  const server = crearServidorBuild({
    root,
    puerto: 36232,
    generarCodigo: (ruta, spec) =>
      generarCodigoLLM(root, ruta, spec, { key: `sk-or-v1-${"a".repeat(48)}`, model: "demo" }),
  });
  const tipos = [];
  try {
    const r = await fetch(`http://127.0.0.1:36232/api/build/stream?spec=${specRel}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const partes = buf.split("\n\n");
      buf = partes.pop() ?? "";
      for (const p of partes) {
        const linea = p.replace(/^data: /, "").trim();
        if (linea) tipos.push(JSON.parse(linea).type);
      }
    }
  } finally {
    server.close();
  }
  const spec = readFileSync(join(root, specRel), "utf8");
  const archivosOk = archivos.every((a) => existsSync(join(root, a)));
  const marcasOk = archivos.every((a) => new RegExp(`- \\[X\\] ${a}`).test(spec));
  const secuencia = tipos.join(" ");
  console.log(`demo e2e: archivos=${archivosOk ? "2/2" : "FALTAN"} marcas=${marcasOk ? "2/2" : "FALTAN"}`);
  console.log(`eventos: ${secuencia}`);
  const esperada = "status file_start file_success file_start file_success complete";
  if (!archivosOk || !marcasOk || secuencia !== esperada) {
    console.error(`DEMO FALLIDA (esperaba: ${esperada})`);
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  globalThis.fetch = fetchReal;
  rmSync(root, { recursive: true, force: true });
}
