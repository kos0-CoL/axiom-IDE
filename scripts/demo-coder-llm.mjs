// Demo end-to-end del coder con LLM: fetch stubbed (sin gastar tokens),
// spec real en temp, prompt raw verificado (sin ```), código devuelto limpio.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realFetch = globalThis.fetch;
const CODIGO = "export const saludo = \"hola\";\n";
globalThis.fetch = (async () => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => ({ choices: [{ message: { content: CODIGO } }] }),
}));

const root = mkdtempSync(join(tmpdir(), "axiom-demo-coder-"));
try {
  const { generarCodigoLLM } = await import("../dist/nodes/coder-llm.js");
  const out = await generarCodigoLLM(root, "demo/saludo.txt", "- [ ] demo/saludo.txt", {
    key: `sk-or-v1-${"a".repeat(48)}`,
    model: "demo-model",
  });
  const raw = !out.includes("```");
  console.log(`demo coder-llm: raw=${raw} codigo=${JSON.stringify(out)}`);
  if (out !== CODIGO || !raw) {
    console.error("DEMO FALLIDA");
    process.exit(1);
  }
  console.log("DEMO OK");
} finally {
  globalThis.fetch = realFetch;
  rmSync(root, { recursive: true, force: true });
}
