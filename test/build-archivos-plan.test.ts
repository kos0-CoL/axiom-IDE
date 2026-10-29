// Build mandaba el workspace entero (hasta 24 000 caracteres) en cada turno.
// Cuando hay plan aprobado, el plan ya dice qué archivos toca: esto fija que se
// manden solo esos y que, si el plan no nombra ninguno, el llamador pueda caer
// al workspace completo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../dist/store.js";
import { archivosDelPlan, contextoWorkspace, guardarArtefactosPlan, indiceWorkspace } from "../dist/chat-build.js";

function proyecto(): string {
  const root = mkdtempSync(join(tmpdir(), "axiom-build-ctx-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  // Los dos archivos que el plan nombra tienen tamaño realista: si el recorte
  // se mide con archivos vacíos, el porcentaje no dice nada.
  writeFileSync(join(root, "src", "a.ts"), `export const a = 1;\n// ${"a".repeat(1500)}\n`);
  writeFileSync(join(root, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(join(root, "src", "c.ts"), "export const c = 3;\n");
  writeFileSync(join(root, "docs", "leeme.md"), `# Leeme\n\n${"n".repeat(1200)}\n`);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  // Relleno: lo que hace caro mandar el workspace completo en cada turno.
  for (let i = 0; i < 8; i++) writeFileSync(join(root, "src", `relleno${i}.ts`), `// ${i}\n${"x".repeat(3000)}\n`);
  return root;
}

function planCon(root: string, sesion: string, planTexto: string): void {
  const db = openDb(root);
  db.prepare("INSERT INTO chat_sessions(id,titulo,modo,archivada,created_at,updated_at) VALUES(?,?,?,0,?,?)").run(sesion, "pipeline", "build", new Date().toISOString(), new Date().toISOString());
  db.close();
  const r = guardarArtefactosPlan(root, sesion, "Implementá el pipeline de importación", planTexto, undefined, { proveedor: "mock", model: "mock" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const aprob = openDb(root);
  aprob.prepare("UPDATE plan_propuestas SET estado='aprobada' WHERE id=?").run(r.proposal_id);
  aprob.close();
}

test("con plan aprobado se mandan solo los archivos que el plan nombra", () => {
  const root = proyecto();
  try {
    planCon(root, "s-1", "1. Escribir `src/a.ts` con la lectura\n2. Documentar en docs/leeme.md");
    const r = archivosDelPlan(root, "s-1");
    assert.deepEqual(r.archivos.sort(), ["docs/leeme.md", "src/a.ts"], "solo los nombrados, sin duplicados");
    assert.match(r.contexto, /--- src\/a\.ts ---/);
    assert.match(r.contexto, /--- docs\/leeme\.md ---/);
    assert.doesNotMatch(r.contexto, /relleno0\.ts/, "el relleno no entra: lo que el plan no nombra no se paga");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("el recorte es real frente al workspace completo", () => {
  const root = proyecto();
  try {
    planCon(root, "s-2", "1. Escribir `src/a.ts`\n2. Documentar en docs/leeme.md");
    const completo = contextoWorkspace(root);
    const recortado = archivosDelPlan(root, "s-2").contexto;
    assert.ok(completo.includes("relleno0.ts"), "el workspace completo trae el relleno");
    assert.ok(recortado.length < completo.length / 2, `el recorte debe ser más de la mitad: ${recortado.length} vs ${completo.length}`);
    console.log(`medido: workspace ${completo.length} chars → plan ${recortado.length} chars (${Math.round((1 - recortado.length / completo.length) * 100)}% menos)`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// El plan dice qué tocar, no dónde vive cada cosa. Sin rutas hermanas el modelo
// inventa módulos; con contenido completo se paga el workspace en cada turno.
test("el índice da la estructura sin pagar contenido ni basura", () => {
  const root = proyecto();
  try {
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    writeFileSync(join(root, "node_modules", "x", "index.js"), "module.exports = 1;\n");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "a.js"), "var a = 1;\n");
    writeFileSync(join(root, "logo.png"), "PNG");
    const indice = indiceWorkspace(root);
    for (const ruta of ["src/a.ts", "src/b.ts", "src/c.ts", "docs/leeme.md", "package.json", "src/relleno7.ts"]) {
      assert.ok(indice.includes(`- ${ruta}`), `el índice debe nombrar ${ruta}`);
    }
    assert.doesNotMatch(indice, /node_modules|dist\/a\.js|logo\.png/, "sin dependencias, builds ni binarios");
    assert.doesNotMatch(indice, /export const a/, "solo rutas: el contenido no viaja");
    const completo = contextoWorkspace(root);
    assert.ok(indice.length < completo.length / 4, `índice ${indice.length} vs workspace ${completo.length}`);
    console.log(`medido: índice ${indice.length} chars vs workspace ${completo.length} chars (${Math.round((indice.length / completo.length) * 100)}%)`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("el índice respeta su tope y declara lo que dejó afuera", () => {
  const root = proyecto();
  try {
    const corto = indiceWorkspace(root, 120);
    assert.ok(corto.length < 400, `sin tope el índice crece: ${corto.length}`);
    assert.match(corto, /ruta\(s\) más/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("un proyecto sin archivos no agrega un índice vacío al prompt", () => {
  const vacio = mkdtempSync(join(tmpdir(), "axiom-build-vacio-"));
  try { assert.equal(indiceWorkspace(vacio), ""); } finally { rmSync(vacio, { recursive: true, force: true }); }
});

test("sin plan aprobado no hay recorte: el llamador usa el workspace", () => {
  const root = proyecto();
  try {
    const db = openDb(root);
    db.prepare("INSERT INTO chat_sessions(id,titulo,modo,archivada,created_at,updated_at) VALUES(?,?,?,0,?,?)").run("s-3", "x", "build", new Date().toISOString(), new Date().toISOString());
    db.close();
    const r = archivosDelPlan(root, "s-3");
    assert.deepEqual(r, { archivos: [], contexto: "" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("un archivo nombrado que no existe o sale del proyecto se ignora", () => {
  const root = proyecto();
  try {
    planCon(root, "s-4", "1. Tocá `../secreto.ts`, `src/no-existe.ts` y `src/b.ts`");
    const r = archivosDelPlan(root, "s-4");
    assert.deepEqual(r.archivos, ["src/b.ts"], "solo el que existe dentro del proyecto");
    assert.doesNotMatch(r.contexto, /secreto/, "nada fuera de la raíz");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
