// Demo plan→tasks (etapa 14): sin red. Crea una spec de chat mínima,
// deriva tasks.md con un preguntar local (una llamada) y muestra el
// resolver de `axiom build <id|ruta>`.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const { asegurarTasksDesdePlan, resolverSpecBuild } = await import(join(raiz, "dist", "orchestrator", "desde-plan.js"));

const base = mkdtempSync(join(tmpdir(), "axiom-demo-plan-tasks-"));
mkdirSync(join(base, "specs", "active", "hola"), { recursive: true });
writeFileSync(join(base, "specs", "active", "hola", "spec.md"), "# Spec hola\n\n## Criterios\n\n- [ ] Responder hola.\n");
writeFileSync(join(base, "specs", "active", "hola", "plan.md"), "# Plan hola\n\n1. Crear src/hola.ts que exporte saludar().\n2. Probar con un test.\n");

let llamadas = 0;
const r = await asegurarTasksDesdePlan(base, "hola", async (prompt) => {
  llamadas++;
  return `- [ ] src/hola.ts\n- [ ] test/hola.test.ts\n`;
});
console.log(`puente: ok=${r.ok} creadas=${r.creadas} llamadas=${llamadas} archivos=${(r.archivos ?? []).join(", ")}`);
console.log("--- tasks.md ---");
console.log(readFileSync(join(base, "specs", "active", "hola", "tasks.md"), "utf8").trim());
const otra = await asegurarTasksDesdePlan(base, "hola", async () => { throw new Error("no debería llamarse"); });
console.log(`reutiliza: ok=${otra.ok} creadas=${otra.creadas}`);
console.log(`resolver id   -> ${resolverSpecBuild("hola")}`);
console.log(`resolver ruta  -> ${resolverSpecBuild(".speckit/build.md")}`);
rmSync(base, { recursive: true, force: true });
