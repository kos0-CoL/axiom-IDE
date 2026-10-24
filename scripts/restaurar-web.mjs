// One-off: restaura las piezas JS perdidas en web.ts (pintaToggle, tgencendido, load).
import { readFileSync, writeFileSync } from "node:fs";

const p = "src/web.ts";
const lines = readFileSync(p, "utf8").split("\n");

const tgtoggleIdx = lines.findIndex((l) => l.startsWith("'function tgtoggle()"));
const bootIdx = lines.findIndex((l) => l.startsWith("'load(); chatprov();"));
if (tgtoggleIdx < 0 || bootIdx < 0) { console.error("no se encontraron anclas"); process.exit(1); }

// Convierte una línea JS de la página a la forma en que vive en web.ts:
//  '  var b = ...\"tgtoggle\"...;',   (comillas dobles escapadas dentro de comillas simples)
const q = (js) => "''.replace?".length < 0 ? "" : "'" + js.replace(/"/g, '\\"') + "',";

const pintaToggle = [
  q("var tgencendido = false;"),
  q("function pintaToggle(on) {"),
  q("  tgencendido = on;"),
  q('  var b = document.getElementById("tgtoggle"); if (b) { b.textContent = on ? "Telegram: on" : "Telegram: off"; b.className = on ? "pill on" : "pill off"; }'),
  q('  var p = document.getElementById("tgenabled"); if (p) { p.textContent = on ? "Canal: on" : "Canal: off"; p.className = on ? "pill on" : "pill off"; }'),
  q('  var f = document.getElementById("st-tg"); if (f) f.textContent = on ? "Telegram: on" : "Telegram: off";'),
  q("}"),
];

const loadFn = [
  q("function load() {"),
  q("  tgcfg();"),
  q('  fetch("api/orquestacion").then(function(r) { return r.json(); }).then(function(d) {'),
  q('    var sp = document.getElementById("st-techo");'),
  q('    if (sp && d.techo) sp.textContent = "Techo: " + d.techo.rondas + "r · " + d.techo.tokens + "t";'),
  q('    var tl = document.getElementById("orq-timeline");'),
  q("    if (tl && d.aprobaciones) tl.innerHTML = timeline(d);"),
  q('    var ap = document.getElementById("apr");'),
  q("    if (ap && d.aprobaciones) {"),
  q('      var pend = d.aprobaciones.filter(function(x) { return x.estado === "pendiente"; });'),
  q('      ap.innerHTML = "<h2>Aprobaciones</h2><div>" + pend.length + " pendiente(s) — decide en Aprobaciones o con axiom approve <id>.</div>" + timeline(d);'),
  q("    }"),
  q("  });"),
  q('  fetch("api/trabajo").then(function(r) { return r.json(); }).then(function(d) {'),
  q('    var t = document.getElementById("tra");'),
  q('    if (t && d.specs) { var h = ""; d.specs.forEach(function(s) { h += "<div class=\\"hint\\">" + esc(s.id) + " · " + esc(s.title) + " · " + esc(s.status) + " · " + esc(s.tareas.length) + " tarea(s)</div>"; }); t.innerHTML = "<h2>Trabajo</h2><div>" + (h || "Sin specs: usa /init y /spec para empezar.") + "</div>"; }'),
  q("  });"),
  q("}"),
];

lines.splice(bootIdx, 0, ...loadFn);
lines.splice(tgtoggleIdx, 0, ...pintaToggle);
writeFileSync(p, lines.join("\n"));
console.log("pintaToggle + tgencendido + load() restaurados en", p);
