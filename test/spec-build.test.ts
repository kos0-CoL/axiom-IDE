import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leerChecklist, marcarHecha, pendientes } from "../dist/spec/checklist.js";
import { validarCodigo } from "../dist/nodes/validator.js";
import { escribirArchivo } from "../dist/server/filesystem.js";
import { escribirSpecPlan } from "../dist/nodes/architect.js";
import { AgentOrchestrator, type EventoBuild } from "../dist/orchestrator/orchestrator.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-specbuild-"));
}

test("el parser lee el checklist y respeta el orden FIFO", () => {
  const md = "# Spec\n\n- [X] a/uno.ts\n- [ ] b/dos.ts\n- [ ] c/tres.ts\n";
  assert.equal(leerChecklist(md).length, 3);
  assert.deepEqual(pendientes(md).map((t) => t.ruta), ["b/dos.ts", "c/tres.ts"]);
});

test("marcarHecha es idempotente y no colisiona con nombres parecidos", () => {
  const md = "- [ ] a/b.ts\n- [ ] a/b.ts.bak\n";
  const r1 = marcarHecha(md, "a/b.ts");
  assert.equal(r1.changed, true);
  assert.match(r1.markdown, /- \[X\] a\/b\.ts\n/);
  assert.match(r1.markdown, /- \[ \] a\/b\.ts\.bak/);
  const r2 = marcarHecha(r1.markdown, "a/b.ts");
  assert.equal(r2.changed, false);
  assert.equal(r2.markdown, r1.markdown);
});

test("el validator rechaza vacío, truncado, markdown y cháchara", () => {
  assert.equal(validarCodigo("").ok, false);
  assert.equal(validarCodigo("x=1").ok, false);
  assert.equal(validarCodigo("function f( {").ok, false);
  assert.equal(validarCodigo("```js\nconst a = 1;\n```").ok, false);
  assert.equal(validarCodigo("Aquí tienes el código:\nconst a = 1;\n").ok, false);
  const bueno = validarCodigo("export const saludo = \"hola\";\n");
  assert.equal(bueno.ok, true, bueno.errores.join("; "));
});

test("el filesystem bloquea path traversal y escribe dentro del root", () => {
  const base = temp();
  try {
    assert.throws(() => escribirArchivo(base, "../fuera.txt", "x".repeat(32)), /traversal/);
    assert.throws(() => escribirArchivo(base, "/abs.txt", "x".repeat(32)), /traversal/);
    const r = escribirArchivo(base, "demo/saludo.txt", "export const saludo = \"hola\";\n");
    assert.ok(existsSync(join(base, "demo", "saludo.txt")));
    assert.ok(r.bytes > 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("architect solo corre en modo plan y el build demo escribe y marca", async () => {
  const base = temp();
  try {
    assert.throws(() => escribirSpecPlan(base, "demo", ["demo/saludo.txt"], "build"), /solo corre en modo plan/);
    const specRel = escribirSpecPlan(base, "demo", ["demo/saludo.txt"], "plan");
    const eventos: EventoBuild[] = [];
    const orq = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "export const saludo = \"hola\";\n",
      emitir: (e) => eventos.push(e),
    });
    const r = await orq.ejecutar();
    assert.equal(r.estado, "completo");
    assert.ok(existsSync(join(base, "demo", "saludo.txt")));
    const spec = readFileSync(join(base, specRel), "utf8");
    assert.match(spec, /- \[X\] demo\/saludo\.txt/);
    const tipos = eventos.map((e) => e.type);
    assert.ok(tipos.includes("file_start") && tipos.includes("file_success") && tipos.includes("complete"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("tres fallos seguidos pausan el build sin escribir nada", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/roto.txt"], "plan");
    const orqu = new AgentOrchestrator(base, specRel, {
      generarCodigo: () => "x",
      emitir: () => {},
    });
    const r = await orqu.ejecutar();
    assert.equal(r.estado, "pausado");
    assert.equal(r.fallos["demo/roto.txt"], 3);
    assert.ok(!existsSync(join(base, "demo", "roto.txt")));
    const spec = readFileSync(join(base, specRel), "utf8");
    assert.match(spec, /- \[ \] demo\/roto\.txt/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
