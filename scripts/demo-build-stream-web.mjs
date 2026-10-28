// Demo etapa 13: el servidor principal expone /api/build/stream con SSE
// y run-log, sin duplicar el handler del servidor dedicado.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-streamweb-"));
const { startWeb } = await import("../dist/web.js");
const { escribirSpecPlan } = await import("../dist/nodes/architect.js");
const srv = startWeb(root, 0);
try {
  const specRel = escribirSpecPlan(root, "demo", ["demo/a.txt"], "plan");
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/build/stream?spec=${specRel}`);
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
      if (linea) tipos.push(JSON.parse(linea).type);
    }
  }
  console.log(`demo stream-web: puerto=${srv.port} eventos=${tipos.join(" ")}`);
  // Sin clave: status → 3 intentos con error → pausa (sin red tocada).
  if (tipos[0] !== "status" || tipos[tipos.length - 1] !== "error") {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  srv.close();
  rmSync(root, { recursive: true, force: true });
}
