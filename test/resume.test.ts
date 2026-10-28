import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anexarEvento, archivosCompletados, runIdParaSpec } from "../dist/server/run-log.js";
import { reanudarBuild } from "../dist/orchestrator/resume.js";
import { escribirSpecPlan } from "../dist/nodes/architect.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-resume-"));
}

test("el log persiste eventos y lista completados", () => {
  const base = temp();
  try {
    const runId = "demo";
    anexarEvento(base, runId, { type: "file_success", ruta: "a/uno.txt" });
    anexarEvento(base, runId, { type: "file_success", ruta: "a/dos.txt" });
    assert.deepEqual(archivosCompletados(base, runId).sort(), ["a/dos.txt", "a/uno.txt"]);
    assert.equal(runIdParaSpec(".speckit/build.md"), "speckit-build-md");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resume no repite archivos ya escritos y termina el resto", async () => {
  const base = temp();
  try {
    const archivos = ["demo/uno.txt", "demo/dos.txt"];
    const specRel = escribirSpecPlan(base, "demo", archivos, "plan");
    const runId = runIdParaSpec(specRel);
    // Simula pausa a mitad: uno.txt ya escrito + marcado + logueado.
    mkdirSync(join(base, "demo"), { recursive: true });
    writeFileSync(join(base, "demo", "uno.txt"), "export const a = 1;\n");
    writeFileSync(join(base, specRel), readFileSync(join(base, specRel), "utf8").replace("- [ ] demo/uno.txt", "- [X] demo/uno.txt"));
    anexarEvento(base, runId, { type: "file_success", ruta: "demo/uno.txt" });
    let llamadas = 0;
    const r = await reanudarBuild(base, specRel, {
      generarCodigo: (ruta) => {
        llamadas++;
        assert.equal(ruta, "demo/dos.txt");
        return "export const b = 2;\n";
      },
      emitir: () => {},
    });
    assert.equal(r.estado, "completo");
    assert.equal(llamadas, 1);
    assert.deepEqual(r.reutilizados, ["demo/uno.txt"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
