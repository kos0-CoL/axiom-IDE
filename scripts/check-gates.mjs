// check-gates — la cadena de `npm test` está documentada dos veces —comentario
// del workflow y README— y las dos copias viven lejos de `package.json`, así que
// se desincronizan solas: el comentario llegó a enumerar cinco gates cuando la
// cadena tenía seis. Este check compara cada copia, en orden, contra los pasos
// reales de `scripts.test` y falla ante la primera diferencia en cualquier
// dirección: un eslabón nuevo sin documentar y una promesa que ya no existe.
//
// Además de las listas, vigila los conteos: «los cinco gates» no se desactualiza
// con un error, se vuelve falso en silencio cuando entra un gate nuevo. Lo mismo
// vale para los otros dos sustantivos con los que los docs cuentan la cadena:
// «los ocho eslabones» (cada paso de `scripts.test`) y «los siete controles»
// (cada paso que verifica algo, o sea la cadena sin el build).
//
// No corre dentro de `npm test` a propósito: forma parte de la cadena que vigila,
// y meterlo ahí obligaría a que las listas se nombren a sí mismas.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const root = join(aqui, "..");
// Rutas opcionales para poder ejercitar el check con copias rotas sin tocar el repo:
// package.json, comentario del workflow, README y la raíz desde la que se buscan los
// .md que cuentan la cadena. Los tests pasan las cuatro y así no leen el repo real.
const [
  rutaPackage = join(root, "package.json"),
  rutaWorkflow = join(root, ".github", "workflows", "axiom-ci.yml"),
  rutaReadme = join(root, "README.md"),
  rutaDocs = root,
] = process.argv.slice(2);

// Los pasos que no son `npm run <script>` se leen con nombre humano en el comentario
// del workflow y comando crudo en el README; los dos se normalizan igual. Un paso
// nuevo que no esté en esta tabla cae al comando crudo, así que la lista tampoco
// puede crecer por su cuenta.
const ETIQUETAS = {
  "npm run build": "build",
  "tsc -p tsconfig.test.json": "tsc de tests",
  "node --test dist-test/*.test.js": "node --test",
};
const etiqueta = (paso) => ETIQUETAS[paso] ?? paso.replace(/^npm run /, "");

const pasos = (() => {
  const paquete = JSON.parse(readFileSync(rutaPackage, "utf8"));
  const test = paquete?.scripts?.test;
  if (typeof test !== "string" || !test.trim()) return null;
  return test.split("&&").map((p) => p.trim()).filter(Boolean);
})();
if (!pasos) {
  console.error(`check-gates: ${rutaPackage} no define scripts.test`);
  process.exit(1);
}
const cadena = pasos.map(etiqueta);

// Un gate es un `npm run <script>` de la cadena que no sea el build: es lo que
// la documentación cuenta cuando dice «los N gates». Si un gate deja de invocarse
// por `npm run`, el conteo deja de verlo y el check lo reportaría como faltante.
const gates = pasos
  .filter((p) => /^npm run /.test(p))
  .map((p) => p.replace(/^npm run /, ""))
  .filter((n) => n !== "build");

// Cada copia documentada sabe encontrarse y leer su propia lista; una copia con
// otro formato no se ignora: se reporta como fallo, para que el check no pase
// en silencio justo cuando alguien reescribió la documentación.
const FUENTES = [
  {
    nombre: "comentario del workflow",
    ruta: rutaWorkflow,
    // Las líneas `#` se unen primero porque la lista está partida en tres.
    leer: (texto) => {
      const comentario = texto
        .split("\n")
        .filter((l) => /^\s*#/.test(l))
        .map((l) => l.replace(/^\s*#\s?/, ""))
        .join(" ");
      const m = /cadena completa \(([\s\S]*?)\)/.exec(comentario);
      return m ? m[1].split("->") : null;
    },
  },
  {
    nombre: "README",
    ruta: rutaReadme,
    // **Qué corre `npm test`**, en orden: `a` → `b` → … .
    leer: (texto) => {
      const linea = texto.split("\n").find((l) => l.includes("Qué corre `npm test`"));
      if (!linea) return null;
      const i = linea.indexOf("en orden:");
      if (i < 0) return null;
      // El último eslabón arrastra el resto de la oración; se corta ahí.
      return linea.slice(i + "en orden:".length).split("→").map((t) => t.split(". ")[0]);
    },
  },
];

// Cada copia rota se reporta como un bloque de líneas, para que dos docs malos
// en la misma corrida se vean completos en vez de solo el primero.
const problemas = [];
for (const fuente of FUENTES) {
  const leida = fuente.leer(readFileSync(fuente.ruta, "utf8"));
  // Se quitan las marcas de Markdown sin tocar el `*` de `dist-test/*.test.js`:
  // por eso solo caen los backticks y los `**` de negrita, nunca un asterisco suelto.
  const documentada = (leida ?? [])
    .map((p) => p.replace(/`/g, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .map(etiqueta);
  if (!documentada.length) {
    problemas.push({
      lineas: [
        `el ${fuente.nombre} (${fuente.ruta}) no tiene la lista de la cadena`,
        "formato esperado: «en orden: a → b» en el README, «cadena completa (a -> b)» en la cabecera del workflow",
      ],
    });
    continue;
  }
  if (documentada.length === cadena.length && documentada.every((p, i) => p === cadena[i])) continue;

  const largo = Math.max(cadena.length, documentada.length);
  let i = 0;
  while (i < largo && cadena[i] === documentada[i]) i++;
  const indice = i + 1;
  const lineas = [
    `la cadena de \`npm test\` no coincide con el ${fuente.nombre} (${fuente.ruta})`,
    `pasos reales (${rutaPackage}, ${cadena.length}): ${cadena.join(" -> ")}`,
    `documentados (${documentada.length}): ${documentada.join(" -> ")}`,
  ];
  if (i >= cadena.length) lineas.push(`paso ${indice}: el doc promete «${documentada[i]}», que la cadena no corre`);
  else if (i >= documentada.length) lineas.push(`paso ${indice}: la cadena corre «${cadena[i]}», que el doc no nombra`);
  else lineas.push(`paso ${indice}: la cadena corre «${cadena[i]}», el doc dice «${documentada[i]}»`);
  problemas.push({ lineas });
}

// Conteos explícitos: «los cinco gates» no rompe nada cuando entra un gate nuevo,
// solo miente. Se revisan todos los .md del repo (raíz, docs/ y el README que se
// haya pasado como argumento) y los tres sustantivos con los que se cuenta la
// cadena, cada uno con su valor real:
//
// - gate: cada `npm run` de la cadena salvo build (la cadena sin build, control).
// - eslabón: cada paso, build incluido (la cadena entera).
// - control: cada paso que verifica algo, o sea la cadena sin el build, que es
//   preparación y no comprueba nada por sí solo.
const DIGITO = /^[0-9]+$/;
// Los docs cuentan con palabras tanto como con cifras («los cinco gates» y
// «los 5 gates» conviven), así que el conteo se lee en las dos formas.
// Sin «un»/«una»: «agrega o quita un gate» no cuenta nada, solo nombra el objeto.
const NUMEROS = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
};
// Las palabras largas primero para que «doce» no se lea como «dos».
const ALTERNATIVA = Object.keys(NUMEROS).sort((a, b) => b.length - a.length).join("|");
const controles = cadena.filter((p) => p !== "build");
const CONCEPTOS = [
  {
    nombre: "gate",
    formas: "gates?",
    valor: gates.length,
    plural: (n) => `gate${n === 1 ? "" : "s"}`,
    detalle: `cuentan los \`npm run\` de ${rutaPackage} salvo build: ${gates.join(", ") || "(ninguno)"}`,
  },
  {
    nombre: "eslabón",
    formas: "eslab[oó]n(?:es)?",
    valor: cadena.length,
    plural: (n) => `eslab${n === 1 ? "ón" : "ones"}`,
    detalle: `cada paso de scripts.test, build incluido: ${cadena.join(" -> ")}`,
  },
  {
    nombre: "control",
    formas: "controles?",
    valor: controles.length,
    plural: (n) => `control${n === 1 ? "" : "es"}`,
    detalle: `cada paso que verifica algo (la cadena sin build): ${controles.join(", ")}`,
  },
];
for (const concepto of CONCEPTOS) {
  const forma = concepto.formas;
  concepto.re = new RegExp(`\\b(?:los|las)?\\s*(\\d+|${ALTERNATIVA})\\s*${forma}\\b`, "gi");
}

function documentosMd(dir, acc) {
  let entradas = [];
  try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entrada of entradas) {
    if (entrada.name.startsWith(".") || entrada.name === "node_modules") continue;
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) documentosMd(ruta, acc);
    else if (entrada.isFile() && entrada.name.endsWith(".md")) acc.push(ruta);
  }
}

const documentos = [];
for (const nombre of ["README.md", "AGENTS.md", "ESTADO-MVP0.md"]) {
  const ruta = resolve(join(rutaDocs, nombre));
  if (existsSync(ruta)) documentos.push(ruta);
}
documentosMd(join(rutaDocs, "docs"), documentos);
const rutaReadmeAbs = resolve(rutaReadme);
if (existsSync(rutaReadmeAbs) && !documentos.includes(rutaReadmeAbs)) documentos.push(rutaReadmeAbs);

// Un doc fuera del repo (los tests pasan copias en /tmp) se nombra por su ruta
// absoluta en vez de con una cadena de `../`.
const rutaDoc = (p) => {
  const r = relative(root, p);
  return r.startsWith("..") ? p : r;
};

for (const doc of documentos) {
  readFileSync(doc, "utf8").split("\n").forEach((linea, i) => {
    for (const concepto of CONCEPTOS) {
      concepto.re.lastIndex = 0;
      let m;
      while ((m = concepto.re.exec(linea)) !== null) {
        const escrito = m[1].toLowerCase();
        const n = DIGITO.test(escrito) ? Number(escrito) : NUMEROS[escrito];
        if (n === concepto.valor) continue;
        problemas.push({
          lineas: [
            `${rutaDoc(doc)}:${i + 1} dice «${m[0].trim()}» pero la cadena tiene ${concepto.valor} ${concepto.plural(concepto.valor)}`,
            concepto.detalle,
          ],
        });
      }
    }
  });
}

if (problemas.length) {
  for (const { lineas } of problemas) {
    console.error(`check-gates: ${lineas[0]}`);
    for (const l of lineas.slice(1)) console.error(`  ${l}`);
  }
  process.exit(1);
}
console.log(`check-gates OK (${cadena.length} eslabones, ${controles.length} controles, ${gates.length} gates, ${FUENTES.length} copias y ${documentos.length} docs al día: ${cadena.join(" -> ")})`);
