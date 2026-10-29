// check-vocabulario — guardia de ADR-0007: la orquestación de Axiom es un
// supervisor jerárquico con handoffs auditados, no un swarm. Falla si un doc
// del repo (raíz y docs/) afirma lo contrario.
//
// No persigue la palabra: citar AutoGen, OpenAI Swarm o la definición académica
// de enjambre es legítimo. Lo que falla es afirmarlo de Axiom sin contraste
// («Axiom es un swarm»), porque de ahí salen expectativas falsas sobre el grafo
// (emergencia, agentes que se eligen solos) que el código no cumple.
import { join, relative } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const aqui = dirname(fileURLToPath(import.meta.url));
const root = join(aqui, "..");
const { documentosDelRepo, revisarDocumento } = await import(join(root, "dist", "vocabulario.js"));

const archivos = documentosDelRepo(root).filter((p) => {
  try { return statSync(p).isFile(); } catch { return false; }
});

let fallos = 0;
for (const ruta of archivos) {
  for (const { linea, oracion } of revisarDocumento(ruta)) {
    fallos++;
    console.error(`VOCABULARIO ${relative(root, ruta)}:${linea} — ${oracion}`);
  }
}
if (fallos > 0) {
  console.error(`check-vocabulario: ${fallos} afirmación(es) que describen Axiom como swarm (ver ADR-0007)`);
  process.exit(1);
}
console.log(`check-vocabulario OK (${archivos.length} docs: raíz + docs/, sin descripciones de Axiom como swarm)`);
