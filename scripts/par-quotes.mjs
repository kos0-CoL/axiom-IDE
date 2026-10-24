// par-quotes — el JS del navegador recibe estas lineas como strings JS
// delimitados por ", asi que las comillas HTML interiores deben llevar \\"
// (dos contrabarras en el fuente TS). Bajamos el nivel en tres lineas de load().
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = join(root, "src", "web.ts");
let src = readFileSync(p, "utf8");

const fixes = [
  // te.innerHTML: <span class="hint"> -> <span class=\"hint\">
  [String.raw`</strong> <span class=\"hint\">reserva de verificacion: 20%</span>"`,
   String.raw`</strong> <span class=\\\"hint\\\">reserva de verificacion: 20%</span>"`],
  // taq +=: class="trl", class="mini", onclick="...", title="Ir a Trabajo"
  [String.raw`taq += "<div class=\"trl\"><button class=\"mini\" onclick=\"nav(&apos;tra&apos;)\" title=\"Ir a Trabajo\">"`,
   String.raw`taq += "<div class=\\\"trl\\\"><button class=\\\"mini\\\" onclick=\\\"nav(&apos;tra&apos;)\\\" title=\\\"Ir a Trabajo\\\">"`,
  ],
  // else taq: class="hint"
  [String.raw`taq = "<div class=\"hint\">Sin tareas todavia: el orquestador las crea cuando ejecutas tu pedido en modo Build.</div>"`,
   String.raw`taq = "<div class=\\\"hint\\\">Sin tareas todavia: el orquestador las crea cuando ejecutas tu pedido en modo Build.</div>"`],
];

let n = 0;
for (const [a, b] of fixes) {
  const c = src.split(a).length - 1;
  if (c !== 1) { console.error("esperaba 1 aparicion, hay", c, "de:", a.slice(0, 60)); process.exit(1); }
  src = src.replace(a, b);
  n++;
}
writeFileSync(p, src);
console.log("comillas corregidas en", n, "lineas");
