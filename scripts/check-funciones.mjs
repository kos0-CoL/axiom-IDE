// check-funciones — el <script> de web.ts quedó varias veces con referencias a
// funciones que ya no existían ("Cargando..." eterno sin que tsc proteste).
// Compara cada función que la página usa (on* del HTML, la línea de auto-arranque
// y las llamadas dentro de código JS conocido) contra las declaradas en el mismo
// script. Ignora globales reales del navegador/Node.
import { Script } from "node:vm";
import { PAGE } from "../dist/web.js";

const ini = PAGE.lastIndexOf("<script>") + "<script>".length;
const fin = PAGE.lastIndexOf("</scr" + "ipt>");
const js = PAGE.slice(ini, fin);
try { new Script(js); } catch (e) {
  console.error(`check-funciones: sintaxis inválida: ${e.message}`);
  process.exit(1);
}

const definidas = new Set();
for (const m of js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) definidas.add(m[1]);

const usadas = new Set();
const html = PAGE.slice(0, PAGE.lastIndexOf("<script>"));
for (const m of html.matchAll(/on\w+="([^"]+)"/g)) {
  for (const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) usadas.add(c[1]);
}
const lineaBoot = js.split("\n").find((l) => l.includes("agwire();"));
if (lineaBoot) for (const m of lineaBoot.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) usadas.add(m[1]);

const GLOBALS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "typeof", "new", "do",
  "document", "window", "navigator", "confirm", "prompt", "alert", "location", "history",
  "fetch", "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat",
  "String", "Object", "Array", "Math", "JSON", "Date", "Number", "Boolean", "Promise",
  "setTimeout", "setInterval", "clearInterval", "clearTimeout", "console", "Error",
  "isFinite", "isNaN", "Set", "Map",
  // métodos sobre objetos, no funciones globales
  "getElementById", "querySelector", "querySelectorAll", "addEventListener",
  "trim", "focus", "closest", "getAttribute", "setAttribute", "getAttribute",
]);

const faltan = [...usadas].filter((n) => !definidas.has(n) && !GLOBALS.has(n));
if (faltan.length) {
  console.error(`check-funciones: funciones usadas sin definición: ${faltan.sort().join(", ")}`);
  process.exit(1);
}
console.log(`check-funciones OK (${definidas.size} definidas; handlers y arranque cubiertos)`);
