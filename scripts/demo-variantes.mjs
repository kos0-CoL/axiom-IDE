// Demo etapa 4: una tarea que falla con el prompt base pasa con una
// variante; la lección queda en EXPERIENCE.md con evidencia.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-var-"));
try {
  const { componerAnteFallo } = await import("../dist/orchestrator/variantes.js");
  const base = "Aquí tienes el código:\nconst a = 1;\n"; // falla: cháchara
  const { validarCodigo } = await import("../dist/nodes/validator.js");
  console.log(`base: ok=${validarCodigo(base).ok}`);
  const r = componerAnteFallo(root, "demo-variantes", "cháchara del prompt base", [
    { id: "v1-prompt", descripcion: "repite base", producir: () => base },
    { id: "v2-raw", descripcion: "solo código", producir: () => "export const a = 1;\n" },
  ]);
  const exp = readFileSync(join(root, "EXPERIENCE.md"), "utf8");
  console.log(`demo variantes: ganadora=${r.ganadora} leccion=${exp.includes("v2-raw") ? "registrada" : "FALTA"}`);
  if (r.ganadora !== "v2-raw" || !exp.includes("v2-raw")) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
