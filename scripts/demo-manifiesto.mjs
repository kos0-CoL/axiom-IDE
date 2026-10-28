// Demo etapa 5: un build genera un script, queda registrado con hash y su
// promoción a skill se bloquea sin revisión.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "axiom-demo-man-"));
import { join } from "node:path";
try {
  const { registrarArtefacto, escribirManifiesto, promoverASkill } = await import("../dist/server/manifiesto.js");
  const script = "#!/bin/sh\necho hola-desde-build\n";
  const ent = registrarArtefacto(root, "demo-run", "gen/saluda.sh", script, "coder-llm demo");
  const man = escribirManifiesto(root, "demo-run", { version: "demo", tests: { pasados: 1, fallados: 0 } });
  let bloqueada = false;
  try {
    promoverASkill(root, "demo-run", "gen/saluda.sh", "demo");
  } catch (e) {
    bloqueada = /revisión/.test(e.message);
  }
  console.log(`demo manifiesto: sha=${ent.sha256.slice(0, 8)} archivos=${man.archivos.length} bloqueo-sin-revision=${bloqueada}`);
  if (man.archivos.length !== 1 || !bloqueada) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
