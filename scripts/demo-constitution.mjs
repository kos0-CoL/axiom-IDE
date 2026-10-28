// Demo constitution (etapa 15): sin red. Ratifica dos principios, enmienda
// uno, quita otro y muestra versionado + bloque para prompts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const C = await import(join(raiz, "dist", "constitution.js"));
const S = await import(join(raiz, "dist", "sessions.js"));

const root = mkdtempSync(join(tmpdir(), "axiom-demo-constitution-"));
console.log(C.fijarPrincipio(root, "Fail closed", "Ante duda, denegar. MUST anteponer seguridad.").msg);
console.log(C.fijarPrincipio(root, "Trazar todo", "Toda decisión deja traza.", "Sin traza no hay confianza.").msg);
console.log(C.enmendarPrincipio(root, "II", "Toda decisión deja traza con ID y motivo.").msg);
console.log(C.quitarPrincipio(root, "I").msg);
console.log("--- constitution ---");
console.log(C.textoConstitucion(root));
console.log("--- bloque en plan ---");
const plan = S.promptPara("plan", "", "implementa el login", { constitucion: C.textoConstitucionPrompt(root) });
console.log(plan.includes("constitución del proyecto v") ? "plan con constitución: OK" : "plan SIN constitución: MAL");
rmSync(root, { recursive: true, force: true });
