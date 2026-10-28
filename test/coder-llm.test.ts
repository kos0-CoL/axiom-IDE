import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_PROMPT_CODER, promptCoder } from "../dist/nodes/coder.js";
import { generarCodigoLLM } from "../dist/nodes/coder-llm.js";

const KEY = `sk-or-v1-${"a".repeat(48)}`;

function stubFetch(respuestas: { content?: string; ok?: boolean; error?: string }[]): {
  llamadas: string[];
  restaurar: () => void;
} {
  const real = globalThis.fetch;
  const llamadas: string[] = [];
  let n = 0;
  globalThis.fetch = (async (url: unknown) => {
    llamadas.push(String(url));
    const r = respuestas[Math.min(n++, respuestas.length - 1)];
    return {
      ok: r.ok ?? true,
      status: (r.ok ?? true) ? 200 : 401,
      headers: { get: () => "application/json" },
      json: async () =>
        (r.ok ?? true)
          ? { choices: [{ message: { content: r.content } }] }
          : { error: { message: r.error ?? "no" } },
    };
  }) as unknown as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = real; } };
}

test("el prompt del coder es raw: prohíbe fences y lleva la ruta objetivo", () => {
  // El prompt MENCIONA ``` una sola vez para prohibirlo; no envuelve nada en fences.
  assert.equal(SYSTEM_PROMPT_CODER.split("```").length - 1, 1);
  assert.ok(/PROHIBIDO/.test(SYSTEM_PROMPT_CODER));
  const p = promptCoder("demo/a.txt", "- [ ] demo/a.txt");
  assert.equal(p.system.split("```").length - 1, 1);
  assert.ok(!p.user.includes("```"));
  assert.ok(p.user.includes("demo/a.txt"));
});

test("truncado reintenta una vez contra openrouter por defecto y devuelve el completo", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-coder-"));
  const { llamadas, restaurar } = stubFetch([
    { content: `export const a = '${"x".repeat(200)}';\n` },
    { content: "export const a = 1;\n" },
  ]);
  try {
    const codigo = await generarCodigoLLM(base, "demo/a.txt", "- [ ] demo/a.txt", {
      key: KEY,
      model: "m",
      maxChars: 64,
    });
    assert.equal(codigo, "export const a = 1;\n");
    assert.equal(llamadas.length, 2);
    assert.match(llamadas[0], /openrouter\.ai/);
  } finally {
    restaurar();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sin truncado hace una sola llamada", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-coder-"));
  const { llamadas, restaurar } = stubFetch([{ content: "export const a = 1;\n" }]);
  try {
    const codigo = await generarCodigoLLM(base, "demo/a.txt", "- [ ] demo/a.txt", {
      key: KEY,
      model: "m",
    });
    assert.equal(codigo, "export const a = 1;\n");
    assert.equal(llamadas.length, 1);
  } finally {
    restaurar();
    rmSync(base, { recursive: true, force: true });
  }
});

test("el fallo del proveedor lanza error con proveedor y motivo", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-coder-"));
  const { restaurar } = stubFetch([{ ok: false, error: "Missing Authentication header" }]);
  try {
    await assert.rejects(
      () => generarCodigoLLM(base, "demo/a.txt", "- [ ] demo/a.txt", { key: KEY, model: "m" }),
      /openrouter.*Missing Authentication header/,
    );
  } finally {
    restaurar();
    rmSync(base, { recursive: true, force: true });
  }
});
