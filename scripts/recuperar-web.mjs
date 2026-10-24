// recuperar-web — reconstruye la region da\u00f1ada de src/web.ts a partir del
// PAGE runtime del ultimo build valido (dist/web.js). Cada item del array es
// una linea del runtime; se vuelve a emitir escapando \\ y ' de forma canonica.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { PAGE } = await import(join(root, "dist", "web.js"));
let src = readFileSync(join(root, "src", "web.ts"), "utf8");

// Fronteras en el runtime del build bueno (dist/web.js):
const pStart = PAGE.indexOf('id="orq-techo"');
const pEnd = PAGE.indexOf("var ap = document.getElementById");
if (pStart === -1 || pEnd === -1 || pEnd <= pStart) throw new Error("fronteras en PAGE no encontradas");
const rStart = PAGE.lastIndexOf("\n", pStart) + 1;
const rEnd = PAGE.lastIndexOf("\n", pEnd) + 1;
const regionRt = PAGE.slice(rStart, rEnd);

// Fronteras en el src danado (mismos marcadores, primera aparicion):
const sIdx = src.indexOf('orq-techo');
if (sIdx === -1) throw new Error("marcador orq-techo no existe en src (region ya sana?)");
const sStart = src.lastIndexOf("\n", sIdx) + 1;
const aIdx = src.indexOf("var ap = document.getElementById");
if (aIdx === -1) throw new Error("ancla var ap no existe en src");
const aEnd = src.lastIndexOf("\n", aIdx) + 1;

const lines = regionRt.split("\n");
const out = lines.map(function (l) {
  return "'" + l.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "',\n";
}).join("");

src = src.slice(0, sStart) + out + src.slice(aEnd);
writeFileSync(join(root, "src", "web.ts"), src);
console.log("region reconstruida:", lines.length, "lineas, desde byte", sStart, "hasta", aEnd, "(!antes:", aEnd - sStart, "bytes ~consumidos)");
