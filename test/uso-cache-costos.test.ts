// Los tokens de cache se facturan distinto y hoy no se leían: el costo quedaba
// sobreestimado en sesiones largas. Estos tests fijan el parseo de cada proveedor
// y la fórmula de costo, además de la persistencia por turno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "../dist/modules/adapters/index.js";
import { saveConfig } from "../dist/modules/adapters/config.js";
import { costoUsd, loadPrecios, precioDe } from "../dist/pricing.js";
import { addConsumo, getConsumo, openDb, recordUso } from "../dist/store.js";
import { crearSesion, guardarMensaje, usoSesion } from "../dist/sessions.js";

function proyecto(): string {
  const root = mkdtempSync(join(tmpdir(), "axiom-costos-"));
  writeFileSync(join(root, "pricing.json"), JSON.stringify({
    "openai/gpt-4o-mini": { prompt: 0.15, cacheLectura: 0.075, respuesta: 0.6 },
    "claude-3-5-sonnet": { prompt: 3, cacheLectura: 0.3, cacheEscritura: 3.75, respuesta: 15 },
    "google/gemini-2.0-flash": { prompt: 0.1, cacheLectura: 0.025, respuesta: 0.4 },
  }));
  saveConfig(root, { proveedor: "openai", model: "gpt-4o-mini", baseUrl: "http://127.0.0.1:9", timeoutMs: 5_000, maxChars: 8_000 });
  return root;
}

async function conFetch<T>(cuerpo: string, tipo: string, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(cuerpo, { status: 200, headers: { "content-type": tipo } })) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("OpenAI: cached_tokens se registra y el costo descuenta el cache", async () => {
  const root = proyecto();
  try {
    const cuerpo = JSON.stringify({
      choices: [{ message: { content: "hola" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 600 } },
    });
    const s = await conFetch(cuerpo, "application/json", () => spawn(root, "hola", { key: "sk-test" }));
    assert.equal(s.ok, true);
    assert.equal(s.uso?.prompt, 1000, "prompt sigue siendo la entrada total facturable");
    assert.equal(s.uso?.cacheLectura, 600);
    assert.equal(s.uso?.costoUsd, 0.000165, "400 frescos + 600 cacheados + 100 de salida");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("OpenAI streaming: el usage del último evento también trae el cache", async () => {
  const root = proyecto();
  try {
    const sse = [
      'data: {"choices":[{"delta":{"content":"ho"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"la"}}],"usage":{"prompt_tokens":500,"completion_tokens":20,"total_tokens":520,"prompt_tokens_details":{"cached_tokens":100}}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    const s = await conFetch(sse, "text/event-stream", () => spawn(root, "hola", { onDelta: () => {}, key: "sk-test" }));
    assert.equal(s.ok, true);
    assert.equal(s.text, "hola");
    assert.equal(s.uso?.cacheLectura, 100, "sin esto el costo de un chat con cache se sobreestima");
    assert.equal(s.uso?.costoUsd, 0.0000795, "400 frescos + 100 cacheados + 20 de salida");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Anthropic: el prompt total suma lectura y escritura de cache", async () => {
  const root = proyecto();
  try {
    const cuerpo = JSON.stringify({
      content: [{ type: "text", text: "hola" }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 700, cache_creation_input_tokens: 200 },
    });
    const s = await conFetch(cuerpo, "application/json", () => spawn(root, "hola", { proveedor: "anthropic", key: "k", model: "claude-3-5-sonnet" }));
    assert.equal(s.ok, true);
    assert.equal(s.uso?.prompt, 1000, "input_tokens sola subcontaba la entrada");
    assert.equal(s.uso?.cacheLectura, 700);
    assert.equal(s.uso?.cacheEscritura, 200);
    assert.equal(s.uso?.total, 1050);
    assert.equal(s.uso?.costoUsd, 0.00201);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Google: cachedContentTokenCount es el subconjunto cacheado", async () => {
  const root = proyecto();
  try {
    const cuerpo = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "hola" }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100, cachedContentTokenCount: 400 },
    });
    const s = await conFetch(cuerpo, "application/json", () => spawn(root, "hola", { proveedor: "google", key: "k", model: "gemini-2.0-flash" }));
    assert.equal(s.ok, true);
    assert.equal(s.uso?.cacheLectura, 400);
    assert.equal(s.uso?.costoUsd, 0.00011);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sin precio declarado no se inventa costo, pero el uso se registra igual", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-sin-precio-"));
  try {
    saveConfig(root, { proveedor: "openai", model: "modelo-desconocido", baseUrl: "http://127.0.0.1:9", timeoutMs: 5_000, maxChars: 8_000 });
    const cuerpo = JSON.stringify({ choices: [{ message: { content: "hola" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
    const s = await conFetch(cuerpo, "application/json", () => spawn(root, "hola", { key: "sk-test" }));
    assert.equal(s.ok, true);
    assert.equal(s.uso?.costoUsd, undefined, "un precio inventado sería peor que ninguno");
    assert.equal(s.uso?.prompt, 10);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("la tabla de precios acepta proveedor/modelo, modelo suelto y prefijo", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-precios-"));
  try {
    writeFileSync(join(root, "pricing.json"), JSON.stringify({
      "openai/gpt-4o-mini": { prompt: 0.15, respuesta: 0.6 },
      "gpt-4o-mini": { prompt: 9, respuesta: 9 },
      "gpt-4o": { prompt: 2.5, respuesta: 10 },
    }));
    assert.equal(precioDe(root, "openai", "gpt-4o-mini")?.prompt, 0.15, "proveedor/modelo gana al modelo suelto");
    assert.equal(precioDe(root, "litellm", "gpt-4o-mini")?.prompt, 9, "el modelo suelto sirve para cualquier gateway");
    assert.equal(precioDe(root, "openai", "gpt-4o-mini-2024-07-18")?.prompt, 0.15, "el prefijo cubre la versión fechada");
    assert.equal(precioDe(root, "openai", "otro"), undefined);
    // Tabla inválida: se ignora entera, no medio parseada.
    writeFileSync(join(root, "pricing.json"), JSON.stringify({ "openai/x": { prompt: "gratis", respuesta: 0.6 } }));
    assert.deepEqual(loadPrecios(root), {});
    assert.equal(precioDe(root, "openai", "x"), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("el costo usa los precios de cache declarados", () => {
  const precio = { prompt: 3, respuesta: 15, cacheLectura: 0.3, cacheEscritura: 3.75 };
  assert.equal(costoUsd({ prompt: 1000, respuesta: 0, cacheLectura: 700, cacheEscritura: 200 }, precio), 0.00126);
  // Sin precio de cache, se cobra como entrada normal (no se asume descuento).
  assert.equal(costoUsd({ prompt: 1000, respuesta: 0, cacheLectura: 500 }, { prompt: 3, respuesta: 15 }), 0.003);
});

test("uso_log, consumo y chat guardan el costo por turno", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-persistencia-costo-"));
  try {
    recordUso(root, { prompt: 1000, respuesta: 100, total: 1100, fuente: "medido", proveedor: "openai", model: "gpt-4o-mini", cacheLectura: 600, costoUsd: 0.000165 });
    const db = openDb(root);
    const fila = db.prepare("SELECT proveedor, modelo, cache_lectura, costo_usd FROM uso_log ORDER BY id DESC LIMIT 1").get() as { proveedor: string; modelo: string; cache_lectura: number; costo_usd: number };
    db.close();
    assert.equal(fila.proveedor, "openai");
    assert.equal(fila.modelo, "gpt-4o-mini");
    assert.equal(fila.cache_lectura, 600);
    assert.equal(fila.costo_usd, 0.000165);

    assert.equal(addConsumo(root, 1100, 1, "global", 0.000165).costo, 0.000165);
    assert.equal(getConsumo(root).costo, 0.000165);

    const ses = crearSesion(root, "costo", "build");
    assert.equal(ses.ok, true);
    if (!ses.ok) return;
    guardarMensaje(root, ses.sesion.id, "asistente", "hola", { proveedor: "openai", model: "gpt-4o-mini", tokens: 1100, costoUsd: 0.000165 });
    const uso = usoSesion(root, ses.sesion.id);
    assert.equal(uso.ok, true);
    if (uso.ok) assert.equal(uso.costo, 0.000165);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("una base anterior gana las columnas de cache y costo sin perder filas", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-migracion-costo-"));
  try {
    const vieja = new DatabaseSync(join(root, "axiom.db"));
    vieja.exec(`
      CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, rol TEXT, texto TEXT, proveedor TEXT, model TEXT, skill TEXT, ms INTEGER, created_at TEXT);
      CREATE TABLE uso_log(id INTEGER PRIMARY KEY AUTOINCREMENT, prompt INTEGER, respuesta INTEGER, total INTEGER, fuente TEXT, created_at TEXT);
      CREATE TABLE consumo(unit TEXT PRIMARY KEY, tokens INTEGER, calls INTEGER);
      INSERT INTO uso_log(prompt,respuesta,total,fuente,created_at) VALUES(10,5,15,'medido','2026-01-01');
    `);
    vieja.close();

    const db = openDb(root);
    const previa = db.prepare("SELECT prompt FROM uso_log").get() as { prompt: number };
    assert.equal(previa.prompt, 10, "la fila vieja sigue ahí");
    db.close();
    recordUso(root, { prompt: 20, respuesta: 2, total: 22, fuente: "medido", proveedor: "x", model: "y", cacheLectura: 5, costoUsd: 0.5 });
    const check = openDb(root);
    const ultima = check.prepare("SELECT costo_usd, cache_lectura FROM uso_log ORDER BY id DESC LIMIT 1").get() as { costo_usd: number; cache_lectura: number };
    check.close();
    assert.equal(ultima.costo_usd, 0.5);
    assert.equal(ultima.cache_lectura, 5);
    assert.equal(getConsumo(root).costo, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
