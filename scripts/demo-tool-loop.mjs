// Demo tool-loop (etapa 17): sin red ni proveedor. Un especialista pide
// leer un archivo (turno 1, ejecución real en sandbox), recibe el contenido
// como dato y responde el trabajo final (turno 2).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { correrLoop, leerArchivoSandbox } = await import("../dist/modules/agents/tool-loop.js");

const root = mkdtempSync(join(tmpdir(), "axiom-demo-loop-"));
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "suma.ts"), "export function suma(a: number, b: number): number { return a + b; }\n");

const turnos = [
  'Reviso la implementación antes de informar.\n```tool\n{"tool":"leer","ruta":"src/suma.ts"}\n```',
  'Confirmo la convención de nombres.\n```tool\n{"tool":"buscar","consulta":"typescript sum function convention"}\n```',
  "La función suma(a, b) devuelve a + b. Trabajo verificado contra el archivo.",
];
let i = 0;
const r = await correrLoop("revisor", "Informa qué hace src/suma.ts.", ["leer", "buscar"], {
  spawn: async () => ({ ok: true, text: turnos[Math.min(i++, turnos.length - 1)] }),
  autorizar: async () => ({ decision: "allow", motivo: "demo" }),
  leer: (ruta) => leerArchivoSandbox(root, ruta),
  delegar: async () => { throw new Error("demo sin delega"); },
  buscar: async (q) => `[1] Convención\nhttps://ejemplo\nRef sobre ${q}`,
});
console.log(`demo tool-loop: turnos=${r.turnos} herramientas=${r.herramientas}`);
console.log(`final: ${r.texto}`);
if (r.turnos !== 3 || r.herramientas !== 2 || !r.texto.includes("a + b")) {
  console.error("DEMO FALLIDA");
  process.exit(1);
}
console.log("DEMO OK");
rmSync(root, { recursive: true, force: true });
