/**
 * validate-tokens.ts
 * Valida que no haya hex crudo fuera de @theme en los archivos CSS/TSX
 * Equivalente a npm run validate-tokens del backend
 */

import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
const ALLOWED_IN_TSX = [
  'validate-tokens.ts', // este archivo
];

function scanFile(filePath: string): { file: string; line: number; match: string }[] {
  const content = readFileSync(filePath, 'utf-8');
  const results: { file: string; line: number; match: string }[] = [];
  
  content.split('\n').forEach((line, idx) => {
    const matches = line.match(HEX_REGEX);
    if (matches) {
      matches.forEach(match => {
        // Ignorar si está en un comentario
        const commentIdx = line.indexOf('//');
        const matchIdx = line.indexOf(match);
        if (commentIdx !== -1 && matchIdx > commentIdx) return;
        
        // Ignorar URLs (http://, https://)
        if (line.includes('http://') || line.includes('https://')) return;
        
        // Ignorar en template literals de CSS-in-JS si están en @theme
        // (esto es una heurística simple)
        results.push({ file: filePath, line: idx + 1, match });
      });
    }
  });
  
  return results;
}

function scanDir(dir: string): { file: string; line: number; match: string }[] {
  let results: { file: string; line: number; match: string }[] = [];
  
  function walk(currentDir: string) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'build', '.vite'].includes(entry.name)) {
          walk(fullPath);
        }
      } else if (['.ts', '.tsx', '.css'].includes(extname(entry.name))) {
        if (ALLOWED_IN_TSX.includes(entry.name)) continue;
        results = results.concat(scanFile(fullPath));
      }
    }
  }
  
  walk(dir);
  return results;
}

const violations = scanDir(join(__dirname, '..'));

if (violations.length > 0) {
  console.error('❌ validate-tokens: HEX crudo encontrado fuera de @theme\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} → ${v.match}`);
  }
  console.error(`\nTotal: ${violations.length} violaciones`);
  process.exit(1);
} else {
  console.log('✅ validate-tokens: Cero hex fuera de @theme');
  process.exit(0);
}