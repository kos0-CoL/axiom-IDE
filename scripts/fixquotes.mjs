import { readFileSync, writeFileSync } from 'node:fs';
const p = './src/web.ts';
const lines = readFileSync(p, 'utf8').split('\n');
const start = 893; // 0-based line 894
const end = 906;   // 0-based line 907
const block = [
  "'function indicador(id) {",
  "  var p = porAgente(id);",
  "  var cen = (g.centro && id === g.centro) ? 'var(--lila)' : 'var(--panel-line)';",
  "  if (p && p.estado === 'activo') return 'var(--good)';",
  "  if (p && p.estado === 'aviso') return 'var(--warn)';",
  "  return cen;",
  "}',",
  "'function porAgente(id) {",
  "  if (!g || !g.nodos) return null;",
  "  for (var i = 0; i < g.nodos.length; i++) { if (g.nodos[i].id === id) { if (g.nodos[i].estado !== undefined) return g.nodos[i]; } }",
  "  for (var j = 0; j < (g.agentes || []).length; j++) { if (g.agentes[j].id === id) { return g.agentes[j]; } }",
  "  return null;",
  "}',",
  "'function modgrafo(nombre) {"
];
const quoted = block.map((s) => (/^'/.test(s) ? s : "'" + s + "',"));
lines.splice(start, end - start + 1, ...quoted);
writeFileSync(p, lines.join('\n'), 'utf8');
console.log('done');
