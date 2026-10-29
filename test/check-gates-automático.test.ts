// check-gates se ejercita acá en las dos direcciones: un repo en sync tiene que
// pasar, y cada forma de desincronización —lista vieja, eslabón nuevo sin
// documentar, copia sin lista y cifra que dejó de ser cierta— tiene que fallar
// nombrando el paso o la línea. Sin esto, «los cinco gates» solo se detecta
// cuando alguien se acuerda de mirar.
//
// Cada caso arma su repo en un tmpdir y le pasa al script sus cuatro rutas
// (package.json, workflow, README y la raíz de docs), así que no lee nada del
// repo real: el test no depende de que la documentación de verdad esté al día.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// El test compilado vive en dist-test/, un nivel debajo de la raíz del paquete.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "check-gates.mjs");

// Ocho eslabones: build, tsc de tests, node --test y cinco gates.
const CADENA = [
  "npm run build",
  "tsc -p tsconfig.test.json",
  "node --test dist-test/*.test.js",
  "npm run check:webjs",
  "npm run check:seeds",
  "npm run check:vocabulario",
  "npm run check:boundaries",
  "npm run lint:spectral",
].join(" && ");

const LISTA_README = [
  "`npm run build`",
  "`tsc -p tsconfig.test.json`",
  "`node --test dist-test/*.test.js`",
  "`check:webjs`",
  "`check:seeds`",
  "`check:vocabulario`",
  "`check:boundaries`",
  "`lint:spectral`",
].join(" → ");

const LISTA_WORKFLOW =
  "build -> tsc de tests -> node --test -> check:webjs -> check:seeds -> check:vocabulario -> check:boundaries -> lint:spectral";

const ci = (lista = LISTA_WORKFLOW) =>
  `name: axiom-ci\n\n# cadena completa (${lista})\n\non: [push, pull_request]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;

const readme = ({ lista = LISTA_README, extra = "" } = {}) =>
  `# axiom fixture\n\n**Qué corre \`npm test\`**, en orden: ${lista}. Listo.\n${extra}`;

function escribir(ruta: string, contenido: string | object) {
  writeFileSync(ruta, typeof contenido === "string" ? contenido : JSON.stringify(contenido, null, 2), "utf8");
}

/** Arma un repo mínimo; solo existe para que el check lo lea. */
function repo(opciones: { cadena?: string; readme?: string; ci?: string; docs?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "axiom-check-gates-"));
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  escribir(join(dir, "package.json"), {
    name: "fixture-check-gates",
    version: "0.0.0",
    scripts: { test: opciones.cadena ?? CADENA },
  });
  escribir(join(dir, "README.md"), opciones.readme ?? readme());
  escribir(join(dir, ".github", "workflows", "axiom-ci.yml"), opciones.ci ?? ci());
  for (const [nombre, contenido] of Object.entries(opciones.docs ?? {})) {
    const destino = join(dir, "docs", nombre);
    mkdirSync(dirname(destino), { recursive: true });
    escribir(destino, contenido);
  }
  return dir;
}

/** Corre el script sobre el fixture y devuelve su código y su salida de error. */
function correr(dir: string) {
  try {
    const salida = execFileSync(
      process.execPath,
      [SCRIPT, join(dir, "package.json"), join(dir, ".github", "workflows", "axiom-ci.yml"), join(dir, "README.md"), dir],
      { encoding: "utf8", stdio: "pipe" },
    );
    return { estado: 0, salida };
  } catch (e) {
    const error = e as { status?: number; stdout?: string; stderr?: string };
    return { estado: error.status ?? 1, salida: `${error.stderr ?? ""}${error.stdout ?? ""}` };
  }
}

// ─── Positivo ────────────────────────────────────────────────────────────────

test("check-gates pasa cuando package.json, workflow y README coinciden", () => {
  const { estado, salida } = correr(repo());
  assert.equal(estado, 0, salida);
  assert.match(salida, /check-gates OK/);
  assert.match(salida, /8 eslabones, 7 controles, 5 gates/);
});

test("check-gates pasa con los conteos correctos, en cifras y en palabras", () => {
  const dir = repo({
    readme: readme({
      extra: "\n La cadena tiene 5 gates, los 8 eslabones y las siete verificaciones de los 7 controles.\n",
    }),
    docs: { "nota.md": "Son cinco gates y ocho eslabones: los siete controles sin el build.\n" },
  });
  const { estado, salida } = correr(dir);
  assert.equal(estado, 0, salida);
});

// ─── Negativo: las listas ────────────────────────────────────────────────────

test("check-gates falla cuando un eslabón nuevo no está documentado", () => {
  const cadena = `${CADENA} && npm run check:nuevo`;
  const { estado, salida } = correr(repo({ cadena }));
  assert.equal(estado, 1, salida);
  assert.match(salida, /no coincide con el comentario del workflow/);
  assert.match(salida, /no coincide con el README/);
  assert.match(salida, /paso 9: la cadena corre «check:nuevo», que el doc no nombra/);
});

test("check-gates falla cuando el doc promete un paso que la cadena ya no corre", () => {
  const cadena = CADENA.replace(" && npm run lint:spectral", "");
  const { estado, salida } = correr(repo({ cadena }));
  assert.equal(estado, 1, salida);
  assert.match(salida, /paso 8: el doc promete «lint:spectral», que la cadena no corre/);
});

test("check-gates falla cuando las copias traen los pasos en otro orden", () => {
  const lista = LISTA_README.replace("`check:webjs`", "`check:boundaries`").replace("`check:boundaries` → `lint:spectral`", "`check:espectro`");
  const { estado, salida } = correr(repo({ readme: readme({ lista }) }));
  assert.equal(estado, 1, salida);
  assert.match(salida, /README\.md/);
  assert.match(salida, /paso 4: la cadena corre «check:webjs», el doc dice «check:boundaries»/);
});

test("check-gates falla cuando una copia no tiene la lista", () => {
  const { estado, salida } = correr(repo({ ci: "name: axiom-ci\n\non: [push]\n\njobs:\n  test:\n    steps:\n      - run: npm test\n" }));
  assert.equal(estado, 1, salida);
  assert.match(salida, /comentario del workflow .* no tiene la lista de la cadena/);
});

test("check-gates falla cuando package.json no define scripts.test", () => {
  const dir = repo();
  escribir(join(dir, "package.json"), { name: "fixture-check-gates", version: "0.0.0", scripts: {} });
  const { estado, salida } = correr(dir);
  assert.equal(estado, 1, salida);
  assert.match(salida, /no define scripts\.test/);
});

// ─── Negativo: los conteos ────────────────────────────────────────────────────

test("check-gates falla cuando un doc dice «los seis gates» y la cadena tiene cinco", () => {
  const dir = repo({ readme: readme({ extra: "\n La cadena tiene los seis gates.\n" }) });
  const { estado, salida } = correr(dir);
  assert.equal(estado, 1, salida);
  assert.match(salida, /README\.md:\d+ dice «los seis gates» pero la cadena tiene 5 gates/);
});

test("check-gates falla cuando la cifra quedó vieja tras agregar un gate", () => {
  const cadena = `${CADENA} && npm run check:nuevo`;
  const dir = repo({
    cadena,
    docs: { "guia.md": "Corre los cinco gates y después el build.\n" },
  });
  // La lista del fixture también tiene que reflejar el gate nuevo, si no el
  // primer fallo sería el de las listas y el conteo nunca se revisaría.
  escribir(join(dir, "README.md"), readme({ lista: `${LISTA_README} → \`check:nuevo\``, extra: "\n Son los 6 gates.\n" }));
  escribir(join(dir, ".github", "workflows", "axiom-ci.yml"), ci(`${LISTA_WORKFLOW} -> check:nuevo`));
  const { estado, salida } = correr(dir);
  assert.equal(estado, 1, salida);
  assert.match(salida, /guia\.md:1 dice «los cinco gates» pero la cadena tiene 6 gates/);
  assert.doesNotMatch(salida, /README\.md:.* gates/); // «los 6 gates» sigue siendo cierto
});

test("check-gates falla cuando un doc cuenta eslabones o controles de más", () => {
  const dir = repo({
    readme: readme({ extra: "\n Acá hay nueve eslabones y 8 controles.\n" }),
  });
  const { estado, salida } = correr(dir);
  assert.equal(estado, 1, salida);
  assert.match(salida, /dice «nueve eslabones» pero la cadena tiene 8 eslabones/);
  assert.match(salida, /dice «8 controles» pero la cadena tiene 7 controles/);
});
