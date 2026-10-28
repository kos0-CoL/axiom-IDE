import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWeb } from "../dist/web.js";
import { escribirSpecPlan } from "../dist/nodes/architect.js";
import { leerEventos } from "../dist/server/run-log.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-streamweb-"));
}

async function leerTipos(puerto: number, qs: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`http://127.0.0.1:${puerto}/api/build/stream?${qs}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  const evs: Record<string, unknown>[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const partes = buf.split("\n\n");
    buf = partes.pop() ?? "";
    for (const p of partes) {
      const linea = p.replace(/^data: /, "").trim();
      if (linea) evs.push(JSON.parse(linea));
    }
  }
  return evs;
}

test("startWeb expone el stream con run-log y sin red sin clave", async () => {
  const base = temp();
  const srv = startWeb(base, 0);
  try {
    const specRel = escribirSpecPlan(base, "demo", ["demo/a.txt"], "plan");
    const evs = await leerTipos(srv.port, `spec=${specRel}`);
    const tipos = evs.map((e) => e.type);
    assert.equal(tipos[0], "status");
    assert.ok(tipos.includes("file_start"));
    // Sin clave de proveedor no hay red: el coder falla y el build pausa.
    const ultimo = evs[evs.length - 1];
    assert.equal(ultimo.estado, "pausado");
    const runId = specRel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    assert.ok(leerEventos(base, runId).length >= 2);
    assert.ok(existsSync(join(base, ".runs", `${runId}.jsonl`)));
  } finally {
    srv.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("ruta inexistente del stream principal da 404", async () => {
  const base = temp();
  const srv = startWeb(base, 0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/build/inexistente`);
    assert.equal(r.status, 404);
  } finally {
    srv.close();
    rmSync(base, { recursive: true, force: true });
  }
});
