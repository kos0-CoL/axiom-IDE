import { readFileSync, writeFileSync } from 'node:fs';

const R = readFileSync('./src/web.ts', 'utf8');
const base = R.split("'};")[0].split('function modgrafo')[0];
const I = `\n'};function indicador(id) {\n  var p = porAgente(id);\n  var cen = (g.centro && id === g.centro) ? 'var(--lila)' : 'var(--panel-line)';\n  if (p && p.estado === 'activo') return 'var(--good)';\n  if (p && p.estado === 'aviso') return 'var(--warn)';\n  return cen;\n}';function porAgente(id) {\n  if (!g || !g.nodos) return null;\n  for (var i = 0; i < g.nodos.length; i++) { if (g.nodos[i].id === id) { if (g.nodos[i].estado !== undefined) return g.nodos[i]; } }\n  for (var j = 0; j < (g.agentes || []).length; j++) { if (g.agentes[j].id === id) { return g.agentes[j]; } }\n  return null;\n}';function modgrafo`;
const rest = R.split('function modgrafo')[1];
const X = base + I + rest;
writeFileSync('./src/web.ts', X, 'utf8');
console.log('inyectado', X.indexOf('indicador(id)') !== -1, 'ln', X.split('\n').length);
