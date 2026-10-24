// par-niveles — el BFS original de agred() aplastaba todos los nodos en nivel 0:
// la arista "comunica" nodo-review -> orquestador le daba padre al orquestador,
// el arranque quedaba vacio y todo el grafo caia en una sola fila con flechas
// invertidas. Se parte del orquestador y las aristas de vuelta no marcan nivel.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = join(root, "src", "web.ts");
let src = readFileSync(p, "utf8");

if (src.includes("var raiz = os0[0]")) { console.log("ya aplicado"); process.exit(0); }

const startAnchor = "'  var nivel = {}; var orden = []; var visto = {};',\n";
const endAnchor = "'  var porNiv = {}; var maxN = 0;',\n";
const i1 = src.indexOf(startAnchor);
if (i1 === -1) { console.error("ancla inicial no encontrada"); process.exit(1); }
const i2 = src.indexOf(endAnchor, i1);
if (i2 === -1) { console.error("ancla final no encontrada"); process.exit(1); }

const block = String.raw`'  // Niveles: se parte del orquestador (o de alguien sin arista entrante) y se baja',
'  // por las aristas salientes. Las que vuelven hacia atras (comunica, ciclo) no',
'  // marcan nivel: asi el grafo no se aplana en una sola fila.',
'  var nivel = {}; var orden = [];',
'  var os0 = d.agentes.filter(function(a) { return a.rol === "orquestador"; });',
'  var raiz = os0[0] || d.agentes.filter(function(a) { return !conPadre[a.id]; })[0] || d.agentes[0];',
'  nivel[raiz.id] = 0; orden.push(raiz.id);',
'  var cola = [raiz.id];',
'  while (cola.length) {',
'    var id = cola.shift();',
'    (hijos[id] || []).forEach(function(e) {',
'      if (nivel[e.a] !== undefined || !porId[e.a]) return;',
'      nivel[e.a] = nivel[id] + 1; orden.push(e.a); cola.push(e.a);',
'    });',
'  }',
'  // Sueltos (no alcanzables): fila propia al final.',
'  var filas = 0;',
'  d.agentes.forEach(function(a) {',
'    if (nivel[a.id] !== undefined) return;',
'    var maxAt = 0;',
'    orden.forEach(function(x) { if (nivel[x] > maxAt) maxAt = nivel[x]; });',
'    nivel[a.id] = maxAt + 1 + filas; filas++; orden.push(a.id);',
'  });',
`;
// conservar la linea tras la ancla final intacta
const head = src.slice(0, i1);
const tail = src.slice(i2);
src = head + block + "\n" + tail;
writeFileSync(p, src);
console.log("niveles corregidos");
