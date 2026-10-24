// insertar-funciones — inyecta los bloques de funciones-restore.js en src/web.ts.
// Convierte cada línea de JS (ya en forma de navegador) a una línea del arreglo
// PAGE de web.ts (TS, comillas simples):  \ -> \\   y   ' -> \'
import { readFileSync, writeFileSync } from "node:fs";

const TS = "src/web.ts";
const FUENTE = "scripts/funciones-restore.js";

const ts = readFileSync(TS, "utf8");
const src = readFileSync(FUENTE, "utf8");

const bloques = {};
let actual = null;
for (const raw of src.split("\n")) {
  const m = raw.match(/^---(\S+)---$/);
  if (m) { actual = m[1]; bloques[actual] = []; continue; }
  if (actual && raw.trim().length) bloques[actual].push(raw);
}

function q(line) {
  return "'" + line.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "',";
}
function bloque(nombre, indent) {
  return bloques[nombre].map((l) => (indent ?? "") + q(l)).join("\n");
}

let editado = ts;
const notas = [];

function insertarAntes(ancla, bk, etiqueta) {
  if (!editado.includes(ancla)) throw new Error("ancla no encontrada: " + ancla);
  const n = editado.split(ancla).length;
  if (n !== 2) throw new Error("ancla ambigua: " + ancla);
  editado = editado.replace(ancla, bloque(bk) + "\n" + ancla);
  notas.push(etiqueta);
}

insertarAntes("'function load() {'", "MOD", "mod+allow");
insertarAntes("'var EFECTOS = ", "TG", "telegram");
insertarAntes("'function agadd() {'", "SEC", "secolvidar");
insertarAntes("'function skilload() {'", "PROY", "proyectos");
insertarAntes("'function indicador(id) {'", "AYUDA", "mostrarAyuda");
insertarAntes("'function modgrafo(nombre) {'", "GRAFO", "grafoSVG");

// Aprobaciones dentro de load(): botones con data-tgcb que cablean
// tgcb(id, ok) para el flujo approve/reject (marcador "data-tgcb" del check).
const APR = [
  "      var h = \"<h2>Aprobaciones</h2><div>\" + pend.length + \" pendiente(s) — decide aquí, en Aprobaciones o con axiom approve <id>.</div>\";",
  "      pend.forEach(function(x) { h += \"<div class=\\\"trl\\\"><strong>\" + esc(String(x.id)) + \"</strong> \" + esc(x.tool) + (x.texto ? \" — \" + esc(String(x.texto).slice(0, 80)) : \"\") + \" <span class=\\\"hint\\\">\" + esc(expiraEn(x.created_at || x.created)) + \"</span></div>\"; });",
  "      ap.innerHTML = h + timeline(d);",
  "      pend.forEach(function(x) {",
  "        var fila = document.createElement(\"div\"); fila.className = \"row\";",
  "        var si = document.createElement(\"button\"); si.textContent = \"Telegram-aprobar\"; si.setAttribute(\"data-tgcb\", String(x.id)); si.onclick = function() { tgcb(String(x.id), true); };",
  "        var no = document.createElement(\"button\"); no.textContent = \"Telegram-rechazar\"; no.setAttribute(\"data-tgcb\", String(x.id)); no.onclick = function() { tgcb(String(x.id), false); };",
  "        fila.appendChild(si); fila.appendChild(no); ap.appendChild(fila);",
  "      });",
];
const lineas = editado.split("\n");
const idxs = lineas
  .map((l, i) => (l.includes("ap.innerHTML") && l.includes("axiom approve") ? i : -1))
  .filter((i) => i >= 0);
if (idxs.length !== 1) throw new Error("línea del bloque APR no encontrada de forma única");
const vieja = lineas[idxs[0]];
if (!vieja.trim().endsWith("',")) throw new Error("APR: la línea no parece del arreglo PAGE");
const indent = vieja.slice(0, vieja.indexOf("'"));
lineas.splice(idxs[0], 1, ...APR.map((l) => indent + q(l)));
editado = lineas.join("\n");
notas.push("apr: reemplazada por versión con data-tgcb");

writeFileSync(TS, editado);
console.log("insertar-funciones OK: " + notas.join(" · "));
