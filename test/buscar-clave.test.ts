// La clave de EXA se lee en un solo lugar: src/modules/buscar/clave.ts.
// Este test vigila el modo de fallar silencioso de la duplicación: una segunda
// lectura en otro archivo compila, pasa `tsc` y funciona hasta que alguien
// arregla el `trim()` en una sola copia, o hasta que una de las dos consulta el
// archivo de secretos que nunca la contiene. Ninguna de esas cosas rompe un test
// por sí sola, así que el guardia es sobre el código fuente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EXA_ENV, claveExa, hayClaveExa } from "../dist/modules/buscar/clave.js";

// El test corre desde dist-test/, así que la raíz queda un nivel arriba sin
// depender del cwd con el que se invoque `node --test`.
const root = fileURLToPath(new URL("..", import.meta.url));
const fuente = join(root, "src");
const permitido = join(fuente, "modules", "buscar", "clave.ts");

// Las tres formas en que hoy se puede leer la variable: propiedad, índice con
// literal e índice con la constante. Cualquier otra variante (`env[key]` con
// una variable intermedia) no se detecta, pero tampoco es la forma que el
// repositorio usa.
const LECTURA = /process\.env(?:\.EXA_API_KEY\b|\[\s*(?:["'`]EXA_API_KEY["'`]|EXA_ENV)\s*\])/;

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosTs(ruta));
    else if (entrada.name.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

test("la clave de EXA se lee solo en el helper central", () => {
  const hallazgos: string[] = [];
  for (const archivo of archivosTs(fuente)) {
    if (archivo === permitido) continue;
    readFileSync(archivo, "utf8")
      .split("\n")
      .forEach((linea, i) => {
        if (LECTURA.test(linea)) hallazgos.push(`${relative(root, archivo)}:${i + 1} — ${linea.trim()}`);
      });
  }
  assert.deepEqual(hallazgos, [], "lecturas de la clave de EXA fuera de src/modules/buscar/clave.ts");
});

test("el helper central delega la lectura en env.ts", () => {
  const texto = readFileSync(permitido, "utf8");
  assert.match(texto, /valorEnv\(EXA_ENV\)/, "clave.ts debe leer a través de valorEnv");
  assert.doesNotMatch(texto, /process\.env/, "clave.ts no toca process.env: eso queda en src/env.ts");
});

test("claveExa recorta y hayClaveExa refleja la ausencia", () => {
  const previo = process.env[EXA_ENV];
  try {
    delete process.env[EXA_ENV];
    assert.equal(claveExa(), "");
    assert.equal(hayClaveExa(), false);
    process.env[EXA_ENV] = "  k  ";
    assert.equal(claveExa(), "k", "la clave se devuelve recortada");
    assert.equal(hayClaveExa(), true);
  } finally {
    if (previo === undefined) delete process.env[EXA_ENV];
    else process.env[EXA_ENV] = previo;
  }
});
