// par-techo-tareas — relleno de #orq-techo y #orq-tareas dentro de load().
// String.raw conserva los bytes del fragmento tal cual deben quedar en web.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = join(root, "src", "web.ts");
let src = readFileSync(p, "utf8");

if (src.includes("var te = document.getElementById")) {
  console.log("ya aplicado; no se duplica");
  process.exit(0);
}

const anchor = "    if (tl && d.aprobaciones) tl.innerHTML = timeline(d);',\n";
const i = src.indexOf(anchor);
if (i === -1) { console.error("ancla no encontrada"); process.exit(1); }
if (src.indexOf(anchor) !== src.lastIndexOf(anchor)) { console.error("ancla ambigua"); process.exit(1); }

const block = String.raw`'    var te = document.getElementById(\"orq-techo\");',
'    if (te && d.techo) te.innerHTML = "Rondas: <strong>" + esc(d.techo.rondas) + "</strong> · Tokens: <strong>" + esc(d.techo.tokens) + "</strong> · Llamadas: <strong>" + esc(d.techo.calls) + "</strong> <span class=\"hint\">reserva de verificacion: 20%</span>";',
'    var ta = document.getElementById("orq-tareas");',
'    if (ta) {',
'      var taq = "";',
'      if (d.tareas && d.tareas.length) d.tareas.forEach(function(s) { taq += "<div class=\"trl\"><button class=\"mini\" onclick=\"nav(&apos;tra&apos;)\" title=\"Ir a Trabajo\">" + esc(s.estado) + ": " + esc(s.n) + "</button></div>"; });',
'      else taq = "<div class=\"hint\">Sin tareas todavia: el orquestador las crea cuando ejecutas tu pedido en modo Build.</div>";',
'      ta.innerHTML = taq;',
'    }',`;

src = src.slice(0, i + anchor.length) + block + "\n" + src.slice(i + anchor.length);
writeFileSync(p, src);
console.log("techo/tareas insertados");
