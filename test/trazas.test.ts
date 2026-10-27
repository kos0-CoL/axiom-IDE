// Traza de tool calls (AXM-066): cada llamada a herramienta deja una fila en
// trace_log con decisión + IO resumido (sha256 del completo), y
// `axiom status --trace` la consulta. Reglas que estos tests fijan:
//  - broker.check() es el único punto que escribe (CLI, run, handoff, telegram).
//  - una traza que no se escribe NUNCA rompe la decisión (best-effort).
//  - el resumen se acota; el sha cubre el IO completo (trazable byte a byte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, consumirAprobacion } from "../dist/broker.js";
import { listTrazas, openDb, recordTraza } from "../dist/store.js";
import { cmdStatus, lineaTraza } from "../dist/commands.js";

function raiz(): string {
  return mkdtempSync(join(tmpdir(), "axiom-trazas-"));
}

test("check deja traza con decisión, origen, IO y sha en allow, deny y ask", () => {
  const root = raiz();
  try {
    // allow: riesgo bajo auto (sin política que lo niegue).
    const a = check(root, "read", undefined, undefined, { origen: "cli", entrada: { q: "x" } });
    assert.equal(a.decision, "allow");
    // deny: `terminal` es riesgo alto sin aprobación global.
    const d = check(root, "terminal");
    assert.equal(d.decision, "deny");
    // ask: riesgo medio con permiso global explícito y sin definir en proyecto.
    writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools: { editar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }) + "\n");
    const p = check(root, "editar", undefined, undefined, { origen: "run", entrada: { archivo: "a.md" }, contexto: "run s/T1" });
    assert.equal(p.decision, "ask");
    assert.ok(p.id, "ask debe registrar solicitud");

    const trazas = listTrazas(root, 10);
    assert.equal(trazas.length, 3, "una traza por llamada");
    // orden: la más reciente primero
    const [tAsk, tDeny, tAllow] = trazas;
    assert.deepEqual(
      [tAllow.tool, tDeny.tool, tAsk.tool],
      ["read", "terminal", "editar"],
    );
    assert.equal(tAllow.decision, "allow");
    assert.equal(tAllow.origen, "cli");
    assert.ok(tAllow.entrada.includes("\"q\":\"x\""), "la entrada queda en el resumen");
    assert.equal(tDeny.decision, "deny");
    assert.ok(tDeny.motivo.length > 0, "el motivo explica la denegación");
    assert.equal(tAsk.decision, "ask");
    assert.equal(tAsk.approval_id, p.id, "la traza guarda el id de la solicitud");
    assert.equal(tAsk.contexto, "run s/T1", "contexto vincula la traza a la corrida");
    for (const t of trazas) assert.match(t.sha_io, /^[0-9a-f]{64}$/, "sha256 del IO completo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("el IO grande se acota en el resumen pero el sha cubre el completo", () => {
  const root = raiz();
  try {
    const grande = "x".repeat(5000);
    recordTraza(root, { origen: "cli", tool: "terminal", decision: "deny", entrada: grande, salida: "ok" });
    const [z] = listTrazas(root, 1);
    assert.ok(z.entrada.length < 520, `resumen acotado: ${z.entrada.length}`);
    assert.ok(z.entrada.includes("(+4500 B)"), "el resumen dice cuánto omitió");
    const completo = createHash("sha256").update(`${grande}\nok`).digest("hex");
    assert.equal(z.sha_io, completo, "el sha es del IO completo, no del resumen");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("una traza que no se escribe jamás rompe la decisión que la produjo", () => {
  // raíz inválida (el padre es un archivo): openDb falla al escribir la traza.
  const tmp = raiz();
  try {
    const archivo = join(tmp, "no-dir");
    writeFileSync(archivo, "x");
    const rootMalo = join(archivo, "hijo");
    assert.doesNotThrow(() => recordTraza(rootMalo, { origen: "cli", tool: "t", decision: "allow" }));
    // check debe seguir devolviendo su veredicto normal aunque no pueda trazar.
    let r: { decision: string } | undefined;
    assert.doesNotThrow(() => { r = check(rootMalo, "read"); });
    assert.equal(r?.decision, "allow", "la decisión no depende de la traza");
    assert.deepEqual(listTrazas(rootMalo, 5), [], "sin traza no hay fila, pero tampoco excepción");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("consumirAprobacion deja la traza del uso real con approval_id y corrida", () => {
  const root = raiz();
  try {
    // consumirAprobacion crea la tabla (prepararTabla); sin filas no deja traza.
    assert.equal(consumirAprobacion(root, "editar", "nodo-code", "run demo/T9"), undefined);
    const db = openDb(root);
    const ahora = new Date().toISOString();
    db.prepare("INSERT INTO aprobaciones(id,tool,riesgo,estado,created_at,decided_at,agente) VALUES(?,?,?,?,?,?,?)")
      .run("apr1", "editar", "medio", "aprobada", ahora, ahora, "nodo-code");
    db.close();
    const usada = consumirAprobacion(root, "editar", "nodo-code", "run demo/T9");
    assert.ok(usada, "la aprobación vigente se consume");
    const [z] = listTrazas(root, 5);
    assert.ok(z, "el uso deja traza");
    assert.equal(z.decision, "allow");
    assert.equal(z.approval_id, "apr1");
    assert.equal(z.contexto, "run demo/T9", "la corrida queda vinculada");
    assert.equal(z.origen, "run");
    // La traza por contexto es la que `status --trace <tarea>` consulta.
    assert.equal(listTrazas(root, 5, "demo/T9").length, 1);
    assert.equal(listTrazas(root, 5, "otra-tarea").length, 0);
    // Segunda consumo: ya usada, no hay traza nueva.
    assert.equal(consumirAprobacion(root, "editar", "nodo-code", "run demo/T9"), undefined);
    assert.equal(listTrazas(root, 5).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status --trace consulta las trazas de la tarea y las globales", () => {
  const root = raiz();
  try {
    const db = openDb(root);
    db.prepare("INSERT INTO tasks(id,spec_id,spec_ver,title,scenario,estado,owner) VALUES(?,?,?,?,?,?,?)")
      .run("a-T1", "a", "v1", "Tarea", "", "implementado", "unassigned");
    db.close();
    // Una traza vinculada a la tarea (contexto) y una global suelta.
    recordTraza(root, { origen: "run", tool: "editar", decision: "allow", contexto: "run a/a-T1", entrada: { f: "x" }, salida: { ok: true } });
    recordTraza(root, { origen: "cli", tool: "terminal", decision: "deny", entrada: {}, salida: {} });

    const lineas: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]): void => { lineas.push(args.join(" ")); };
    try {
      cmdStatus(root, "a-T1");
      const tarea = lineas.join("\n");
      assert.match(tarea, /trazas=1/, "la línea principal cuenta las trazas de la tarea");
      assert.match(tarea, /traza .* editar\(?\)?: allow/, "y lista cada tool call");
      const trazaTarea = listTrazas(root, 5, "a-T1")[0];
      assert.ok(trazaTarea && lineaTraza(trazaTarea).includes("editar"), "lineaTraza formatea la fila de la tarea");

      lineas.length = 0;
      cmdStatus(root, undefined, true);
      const global = lineas.join("\n");
      assert.match(global, /trazas: últimas 2/, "sin id muestra las últimas globales");
      assert.match(global, /terminal: deny/, "con tool y decisión");
    } finally {
      console.log = original;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
