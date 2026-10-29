// El servidor lee el entorno en un solo lugar: src/env.ts.
// El modo de fallar de la duplicación es silencioso: dos lectores de la misma
// clave pueden diferir en el `trim()` (uno acepta "  sk-…", el otro no) o en
// consultar el archivo de secretos, y ningún test lo nota hasta producción.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV, copiaEnv, hayEnv, valorEnv } from "../dist/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fuente = join(root, "src");
const unicoLector = join(fuente, "env.ts");

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosTs(ruta));
    else if (entrada.name.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

test("solo src/env.ts toca process.env", () => {
  const hallazgos: string[] = [];
  for (const archivo of archivosTs(fuente)) {
    if (archivo === unicoLector) continue;
    readFileSync(archivo, "utf8")
      .split("\n")
      .forEach((linea, i) => {
        // Los comentarios mencionan `process.env` para explicar la regla.
        if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;
        if (/process\.env\b/.test(linea)) hallazgos.push(`${relative(root, archivo)}:${i + 1} — ${linea.trim()}`);
      });
  }
  assert.deepEqual(hallazgos, [], "lecturas de process.env fuera de src/env.ts");
});

test("el lector único expone el valor recortado y trata vacío como ausente", () => {
  const env = { A: "  valor  ", B: "", C: "   " } as NodeJS.ProcessEnv;
  assert.equal(valorEnv("A", env), "valor");
  assert.equal(valorEnv("B", env), undefined);
  assert.equal(valorEnv("C", env), undefined);
  assert.equal(valorEnv("NO_EXISTE", env), undefined);
  assert.equal(hayEnv("A", env), true);
  assert.equal(hayEnv("B", env), false);
});

test("las claves conocidas están declaradas en ENV", () => {
  // Si aparece una clave nueva, se declara acá: así el nombre no se escribe a
  // mano en cada mensaje de error y el guardia de arriba puede exigir el resto.
  for (const clave of [
    "AXIOM_TELEGRAM_BOT_TOKEN",
    "AXIOM_TELEGRAM_WEBHOOK_SECRET",
    "AXIOM_LITELLM_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "EXA_API_KEY",
    "PLAYWRIGHT_BROWSERS_PATH",
    "PATH",
    "HOME",
    "AXIOM_SERVE_REBUILT",
  ] as const) {
    assert.equal(ENV[clave], clave, `ENV.${clave} debe ser el nombre real de la variable`);
  }
});

test("copiaEnv hereda el entorno y agrega lo pedido sin tocar process.env", () => {
  const original = process.env.AXIOM_TEST_COPIA;
  process.env.AXIOM_TEST_COPIA = "heredado";
  try {
    const copia = copiaEnv({ AXIOM_TEST_EXTRA: "1" });
    assert.equal(copia.AXIOM_TEST_COPIA, "heredado");
    assert.equal(copia.AXIOM_TEST_EXTRA, "1");
  } finally {
    if (original === undefined) delete process.env.AXIOM_TEST_COPIA;
    else process.env.AXIOM_TEST_COPIA = original;
  }
});
