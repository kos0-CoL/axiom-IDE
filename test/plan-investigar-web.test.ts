// Camino completo del botón «Investigar y preguntarme»: el endpoint busca,
// guarda preguntas, las devuelve, y al responderlas quedan en la spec. Se
// prueba con proveedor y EXA simulados (sin red).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWeb } from "../dist/web.js";
import { crearSesion, mensajesDe } from "../dist/sessions.js";
import { saveConfig } from "../dist/modules/adapters/config.js";

const PREGUNTAS = [
  { pregunta: "¿Qué moneda usa el kiosco?", motivo: "Afecta a los totales" },
  { pregunta: "¿Cuántos usuarios hay?", motivo: "Afecta a roles" },
  { pregunta: "¿Se cobra con tarjeta?", motivo: "Afecta a integraciones" },
];

function specEn(base: string): void {
  mkdirSync(join(base, "specs", "active", "demo"), { recursive: true });
  writeFileSync(join(base, "specs", "active", "demo", "spec.md"), "# Spec demo — kiosco\n\n## Objetivo solicitado\n\nun dashboard de kiosco\n", "utf8");
}

test("investigar → preguntas en el chat → respuestas en la spec", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-invweb-"));
  const realFetch = globalThis.fetch;
  const mock = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(PREGUNTAS) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((ok) => mock.listen(0, "127.0.0.1", ok));
  const puerto = (mock.address() as AddressInfo).port;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.EXA_API_KEY = "test-key";
  try {
    writeFileSync(join(base, "axiom.json"), "{}");
    writeFileSync(join(base, "axiom.db"), "");
    writeFileSync(join(base, "agents.config.json"), JSON.stringify({
      config_version: 2,
      agentes: [{ id: "planificador", rol: "nodo", herramientas: [{ tool: "buscar", acceso: "allow" }] }],
      aristas: [],
    }));
    writeFileSync(join(base, "policies.global.json"), JSON.stringify({ tools: { buscar: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }));
    saveConfig(base, { proveedor: "openai", model: "mock", baseUrl: `http://127.0.0.1:${puerto}`, timeoutMs: 10_000, maxChars: 8_000 });
    specEn(base);
    // EXA simulado: solo la búsqueda deja de salir a la red; el resto de las
    // llamadas (incluidas las del propio test al servidor local) pasan.
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? "");
      if (!url.includes("api.exa.ai")) return realFetch(input, init);
      return { ok: true, status: 200, json: async () => ({ results: [{ title: "Ref kiosco", url: "https://ejemplo.test/k", text: "resumen" }] }) };
    }) as unknown as typeof fetch;

    const srv = startWeb(base, 0);
    try {
      const s = crearSesion(base, "investigar", "plan");
      assert.equal(s.ok, true);
      if (!s.ok) return;
      const url = (p: string) => `http://127.0.0.1:${srv.port}${p}`;

      const inv = await (await fetch(url("/api/plan/investigar"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, spec_id: "demo" }),
      })).json() as { ok: boolean; referencias: number; preguntas: { id: string }[]; error?: string };
      assert.equal(inv.ok, true, inv.error);
      assert.equal(inv.referencias, 1);
      assert.equal(inv.preguntas.length, 3);
      assert.match(readFileSync(join(base, "specs/active/demo/spec.md"), "utf8"), /\[1\] Ref kiosco/);

      // El chat guarda un mensaje con marcador para rearmar el formulario al reabrir.
      const msgs = mensajesDe(base, s.sesion.id);
      assert.equal(msgs.ok, true);
      if (msgs.ok) assert.ok(msgs.mensajes.some((m) => m.texto.includes("[[clarify:demo]]")));

      const g = await (await fetch(url("/api/plan/preguntas?spec=demo"))).json() as { ok: boolean; estado: string; preguntas: unknown[] };
      assert.equal(g.ok, true);
      assert.equal(g.estado, "pendiente");
      assert.equal(g.preguntas.length, 3);

      const resp = await (await fetch(url("/api/plan/respuestas"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, spec_id: "demo", respuestas: [{ id: "q1", respuesta: "pesos" }, { id: "q2", respuesta: "uno" }, { id: "q3", respuesta: "no" }] }),
      })).json() as { ok: boolean; respondidas: number; spec: string };
      assert.equal(resp.ok, true);
      assert.equal(resp.respondidas, 3);
      assert.match(readFileSync(join(base, "specs/active/demo/spec.md"), "utf8"), /Q: ¿Qué moneda usa el kiosco\? → A: pesos/);

      const g2 = await (await fetch(url("/api/plan/preguntas?spec=demo"))).json() as { estado: string };
      assert.equal(g2.estado, "respondida");
    } finally {
      srv.close();
    }
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.EXA_API_KEY;
    await new Promise<void>((ok) => mock.close(() => ok()));
    rmSync(base, { recursive: true, force: true });
  }
});
