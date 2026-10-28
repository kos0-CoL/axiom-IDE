import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { construirBuild } from "../dist/commands.js";
import { crearServidorBuild } from "../dist/server/build-events.js";
import { escribirSpecPlan } from "../dist/nodes/architect.js";
import { leerEventos } from "../dist/server/run-log.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-entrada-"));
}

async function leerTipos(puerto: number, qs: string): Promise<string[]> {
  const r = await fetch(`http://127.0.0.1:${puerto}/api/build/stream?${qs}`);
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  const tipos: string[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const partes = buf.split("\n\n");
    buf = partes.pop() ?? "";
    for (const p of partes) {
      const linea = p.replace(/^data: /, "").trim();
      if (linea) tipos.push(JSON.parse(linea).type);
    }
  }
  return tipos;
}

test("construirBuild corre el pipeline y pinta el resumen", async () => {
  const base = temp();
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/a.txt"], "plan");
    const r = await construirBuild(base, specRel, false, () => "export const a = 1;\n");
    assert.equal(r.code, 0);
    assert.match(r.msg, /build completo: 1 archivo/);
    assert.ok(existsSync(join(base, "demo", "a.txt")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("construirBuild sin spec falla cerrado", async () => {
  const base = temp();
  try {
    const r = await construirBuild(base, ".speckit/no-existe.md", false, () => "x");
    assert.equal(r.code, 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el servidor persiste el run-log y resume por ?resume=1", async () => {
  const base = temp();
  const server = crearServidorBuild({
    root: base,
    puerto: 36241,
    generarCodigo: (ruta) => `// ${ruta}\nexport const ok = 1;\n`,
  });
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/uno.txt", "demo/dos.txt"], "plan");
    const tipos = await leerTipos(36241, `spec=${specRel}`);
    assert.deepEqual(tipos, ["status", "file_start", "file_success", "file_start", "file_success", "complete"]);
    const runId = specRel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const evs = leerEventos(base, runId);
    assert.ok(evs.length >= 6);
    assert.ok(evs.every((e, i) => e.seq === i));
    assert.ok(existsSync(join(base, ".runs", `${runId}.spec.md`)));
  } finally {
    server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("?resume=1 termina un build pausado sin reescribir lo hecho", async () => {
  const base = temp();
  let soloDos = 0;
  const server = crearServidorBuild({
    root: base,
    puerto: 36242,
    generarCodigo: (ruta) => {
      assert.equal(ruta, "demo/dos.txt");
      soloDos++;
      return "export const b = 2;\n";
    },
  });
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/uno.txt", "demo/dos.txt"], "plan");
    // Simula la primera pasada: uno.txt hecho y logueado como file_success.
    const { anexarEvento } = await import("../dist/server/run-log.js");
    const { runIdParaSpec } = await import("../dist/server/run-log.js");
    const runId = runIdParaSpec(specRel);
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(base, "demo"), { recursive: true });
    writeFileSync(join(base, "demo", "uno.txt"), "export const a = 1;\n");
    writeFileSync(join(base, specRel), readFileSync(join(base, specRel), "utf8").replace("- [ ] demo/uno.txt", "- [X] demo/uno.txt"));
    anexarEvento(base, runId, { type: "file_success", ruta: "demo/uno.txt" });
    const tipos = await leerTipos(36242, `spec=${specRel}&resume=1`);
    assert.ok(tipos.includes("file_success") && tipos[tipos.length - 1] === "complete");
    assert.equal(soloDos, 1);
    assert.ok(existsSync(join(base, "demo", "dos.txt")));
  } finally {
    server.close();
    rmSync(base, { recursive: true, force: true });
  }
});
