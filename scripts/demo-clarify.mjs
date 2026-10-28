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
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
