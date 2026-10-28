// Demo etapa 12: clarify no interactivo — dos marcas, una respuesta y un salto.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-clarify-"));
import { join } from "node:path";
try {
  const { construirClarify } = await import("../dist/commands.js");
  const spec = `# Spec: demo\n\n## Alcance\n\nRetención [NEEDS CLARIFICATION: ¿cuántos días?] y aviso [NEEDS CLARIFICATION: ¿modal o banner?].\n`;
  const r = construirClarify(spec, ["90 días", "saltar"]);
  console.log(`demo clarify: ${r.msg}`);
  const ok = r.markdown.includes("90 días") && !r.markdown.includes("NEEDS CLARIFICATION") && /omitida/.test(r.markdown);
  if (!ok) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  // Etapa 16: sin marcas, el proveedor propone (stub local, sin red).
  const { proponerPreguntas, responderLista } = await import("../dist/modules/clarify/index.js");
  const ambiguo = `# Spec: login\n\n## Alcance\n\nLos usuarios entran y ven sus cosas.\n`;
  const propuestas = await proponerPreguntas(ambiguo, async () => JSON.stringify([
    { pregunta: "¿qué roles existen?", motivo: "Afecta a permisos." },
    { pregunta: "¿qué datos se muestran?", motivo: "Afecta al modelo." },
  ]));
  const auto = responderLista(ambiguo, propuestas, ["admin y lector", "saltar"]);
  const okAuto = propuestas.length === 2 && /admin y lector/.test(auto.markdown) && /omitida/.test(auto.markdown);
  console.log(`demo proponer: ${propuestas.length} propuesta(s), hechas=${auto.hechas} omitidas=${auto.omitidas} → ${okAuto ? "OK" : "MAL"}`);
  if (!okAuto) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
