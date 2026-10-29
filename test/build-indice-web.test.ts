// El compositor se prueba solo, pero lo que importa es que el índice llegue al
// prompt que ve el modelo. Este test captura el cuerpo real del proveedor en
// modo Build: con plan aprobado (contexto recortado) el índice tiene que estar,
// el archivo del plan tiene que viajar con contenido y sus hermanos solo como ruta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWeb } from "../dist/web.js";
import { saveConfig } from "../dist/modules/adapters/config.js";
import { openDb } from "../dist/store.js";
import { guardarArtefactosPlan } from "../dist/chat-build.js";

test("Build manda el índice de rutas junto al contexto recortado por el plan", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-build-indice-"));
  let cuerpoPedido = "";
  const mock = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", () => {
      cuerpoPedido = cuerpo;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ summary: "ok", changes: [{ path: "src/a.ts", content: "export const a = 2;\n" }] }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  await new Promise<void>((ok) => mock.listen(0, "127.0.0.1", ok));
  const puerto = (mock.address() as AddressInfo).port;
  try {
    writeFileSync(join(base, "axiom.json"), "{}");
    saveConfig(base, { proveedor: "openai", model: "mock", baseUrl: `http://127.0.0.1:${puerto}`, timeoutMs: 10_000, maxChars: 8_000 });
    process.env.OPENAI_API_KEY = "test-key";

    mkdirSync(join(base, "src"), { recursive: true });
    mkdirSync(join(base, "docs"), { recursive: true });
    writeFileSync(join(base, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(base, "src", "hermano.ts"), "// contenido-que-no-debe-viajar\n");
    writeFileSync(join(base, "docs", "guia.md"), "# guia\n");

    const ahora = new Date().toISOString();
    const db = openDb(base);
    db.prepare("INSERT INTO chat_sessions(id,titulo,modo,archivada,created_at,updated_at) VALUES(?,?,?,0,?,?)").run("s-1", "login", "build", ahora, ahora);
    db.close();
    const plan = guardarArtefactosPlan(base, "s-1", "Implementá el login en src/a.ts", "1. Tocar `src/a.ts`");
    assert.equal(plan.ok, true, "el plan de prueba debe guardarse");
    if (!plan.ok) return;
    const aprob = openDb(base);
    aprob.prepare("UPDATE plan_propuestas SET estado='aprobada' WHERE id=?").run(plan.proposal_id);
    aprob.close();

    const srv = startWeb(base, 0);
    try {
      const resp = await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto: "seguí con el login", modo: "build", session_id: "s-1" }),
      });
      assert.equal(resp.status, 200);
      const datos = (await resp.json()) as { ok?: boolean; error?: string };
      assert.equal(datos.ok, true, `respuesta del chat: ${JSON.stringify(datos)}`);

      assert.match(cuerpoPedido, /Estructura del proyecto \(solo rutas, sin contenido/);
      assert.match(cuerpoPedido, /- src\/hermano\.ts/);
      assert.match(cuerpoPedido, /- docs\/guia\.md/);
      assert.match(cuerpoPedido, /--- src\/a\.ts ---/, "el archivo del plan sigue viajando con contenido");
      assert.doesNotMatch(cuerpoPedido, /contenido-que-no-debe-viajar/, "el hermano viaja como ruta, no como contenido");
    } finally {
      srv.close();
    }
  } finally {
    mock.close();
    rmSync(base, { recursive: true, force: true });
  }
});
