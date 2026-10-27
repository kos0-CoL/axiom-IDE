// Flujo verify --url con página de error: la evidencia observable manda sobre
// el veredicto pedido. Si el navegador no puede cargar la URL (DNS imposible),
// el pass del juez se ajusta a fail con: evidencia firmada (sha256 del artefacto),
// la captura declarada en los archivos de la evidencia, bloqueo registrado y la
// nota de ajuste en verification-<tarea>.md.
//
// Sin motor de navegador el caso se OMITE declarando el motivo (criterio de los
// evals): nunca se salta asumiendo que pasó.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verificar } from "../dist/commands.js";
import { openDb } from "../dist/store.js";
import { detectarMotor } from "../dist/modules/browser/index.js";

// .invalid nunca resuelve (RFC 2606): la página de error no depende de red real.
const URL_ERROR = "http://no-existe-axiom.invalid";

interface Evidencia {
  exit: number;
  verdict: string;
  sha256: string;
  archivos: string;
}

test("verify --url con página de error: pass ajustado a fail con evidencia trazable", (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-verify-url-"));
  try {
    if (!detectarMotor(root)) {
      t.skip("sin motor de navegador (instala Chromium o la caché de Playwright)");
      return;
    }
    const semilla = openDb(root);
    semilla
      .prepare("INSERT INTO tasks(id,spec_id,spec_ver,title,scenario,estado,owner) VALUES(?,?,?,?,?,?,?)")
      .run("a-T1", "a", "v1", "Tarea verify url", "", "implementado", "unassigned");
    semilla.close();

    const lanzar = () => verificar(root, "a-T1", "pass", 100, 1, undefined, "humano", undefined, URL_ERROR, "png");
    let r = lanzar();
    if (r.code !== 0 && /No usable sandbox/.test(r.msg)) {
      // Este host bloquea los user namespaces de Chromium (AppArmor): se opta
      // por noSandbox de forma explícita y se reintenta una sola vez.
      writeFileSync(join(root, "browser.config.json"), JSON.stringify({ noSandbox: true }) + "\n");
      r = lanzar();
    }

    // 1) El veredicto queda registrado (no «captura fallida») y ajustado a fail.
    assert.equal(r.code, 0, `verify debió registrar veredicto: ${r.msg}`);
    assert.match(r.msg, /PÁGINA DE ERROR/);
    assert.doesNotMatch(r.msg, /captura fallida/i);

    const db = openDb(root);
    const ev = db
      .prepare("SELECT exit, verdict, sha256, archivos FROM evidences WHERE task_id = ? ORDER BY rowid DESC LIMIT 1")
      .get("a-T1") as Evidencia | undefined;
    const estado = db.prepare("SELECT estado FROM tasks WHERE id = ?").get("a-T1") as { estado: string } | undefined;
    const bloqueo = db
      .prepare("SELECT causa FROM bloqueos WHERE task_id = ? ORDER BY rowid DESC LIMIT 1")
      .get("a-T1") as { causa: string } | undefined;
    db.close();

    // 2) Evidencia fail (exit 1), tarea bloqueada y bloqueo con el motivo.
    assert.equal(ev?.verdict, "fail");
    assert.equal(ev?.exit, 1);
    assert.equal(estado?.estado, "bloqueado");
    assert.match(bloqueo?.causa ?? "", /página de error/);

    // 3) El verification.md documenta el ajuste y referencia la captura.
    const mdPath = join(root, "specs", "active", "a", "verification-a-T1.md");
    assert.ok(existsSync(mdPath), "falta verification-a-T1.md");
    const md = readFileSync(mdPath, "utf8");
    assert.match(md, /página de error del navegador/);
    assert.match(md, /ajustado de pass a fail/);

    // 4) Trazabilidad byte a byte: la captura existe, está declarada en la
    //    evidencia y su sha256 es el de la evidencia y el del verification.md.
    const rel = /\*\*captura browser:\*\* `([^`]+)` · sha256 `([0-9a-f]{64})`/.exec(md);
    assert.ok(rel, "el verification.md no referencia la captura con su sha256");
    const [, capturaRel, shaMd] = rel;
    const capturaPath = join(root, capturaRel);
    assert.ok(existsSync(capturaPath), `captura inexistente: ${capturaRel}`);
    const shaArchivo = createHash("sha256").update(readFileSync(capturaPath)).digest("hex");
    assert.equal(shaArchivo, shaMd, "el sha del md no es el del artefacto");
    assert.equal(ev?.sha256, shaArchivo, "el sha de la evidencia no es el del artefacto");
    assert.ok(ev?.archivos.split("\n").includes(capturaRel), "la captura no está en los archivos de la evidencia");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
