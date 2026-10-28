// stamp-build: deja huella de la compilación en dist/.build.json para que
// `serve` pueda detectar un dist desactualizado y avisarlo en claro.
// Falla en silencio (nunca rompe el build): sin git o sin dist, no escribe.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const aqui = dirname(fileURLToPath(import.meta.url));
const dist = join(aqui, "..", "dist");

let rev = null;
try {
  rev = execSync("git rev-parse --short HEAD", { encoding: "utf8", timeout: 5000 }).trim() || null;
} catch {
  rev = null;
}

try {
  writeFileSync(
    join(dist, ".build.json"),
    JSON.stringify({ rev, time: new Date().toISOString() }) + "\n",
    "utf8",
  );
} catch {
  // dist ausente o no escribible: el build ya pasó, no bloquear por el sello.
}
