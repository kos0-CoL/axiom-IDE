// Demo etapa 6: el servidor SSE persiste el run-log y `?resume=1` retoma un
// build pausado sin reescribir lo ya hecho.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-resumehttp-"));
async function leerTipos(puerto, qs) {
  const r = await fetch(`http://127.0.0.1:${puerto}/api/build/stream?${qs}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  const tipos = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const partes = buf.split("\n\n");
    buf = partes.pop() ?? "";
    for (const p of partes) {
      const linea = p.replace(/^data: /, "").trim();
      if (linea) tipos.push(JSON.parse(linea));
    }
  }
  return tipos;
}

try {
  const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
  const { crearServidorBuild } = await import("../dist/server/build-events.js");
  const { leerEventos } = await import("../dist/server/run-log.js");
  const specRel = escribirSpecPlan(root, "demo", ["demo/uno.txt", "demo/dos.txt"], "plan");
  let modo = "malo";
  const server = crearServidorBuild({
    root,
    puerto: 36243,
    generarCodigo: (ruta) => (modo === "malo" ? "x" : `// ${ruta}\nexport const ok = 1;\n`),
  });
  try {
    const primera = await leerTipos(36243, `spec=${specRel}`);
    modo = "bueno";
    const segunda = await leerTipos(36243, `spec=${specRel}&resume=1`);
    const runId = specRel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const evs = leerEventos(root, runId);
    const ok = existsSync(join(root, "demo", "uno.txt")) && existsSync(join(root, "demo", "dos.txt"));
    console.log(`demo resume-http: primera=${primera.at(-1).type} segunda=${segunda.at(-1).type} archivos=${ok ? "2/2" : "FALTAN"} log=${evs.length} eventos`);
    if (primera.at(-1).type !== "complete" && segunda.at(-1).type !== "complete") {
      console.error("DEMO FALLIDA");
      process.exit(1);
    }
    // La primera pasada pausa (3 fallos del mismo archivo); la segunda completa.
    if (!primera.some((e) => e.estado === "pausado") || segunda.at(-1).type !== "complete" || !ok) {
      console.error("DEMO FALLIDA");
      process.exit(1);
    }
    console.log("DEMO OK");
  } finally {
    server.close();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
