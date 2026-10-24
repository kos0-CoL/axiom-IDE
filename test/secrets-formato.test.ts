// La carga de API en proveedores fallaba en silencio: se guardaba cualquier
// cadena como OPENROUTER_API_KEY y OpenRouter luego respondía 401 «Missing
// Authentication header». setSecrets ahora valida el formato al guardar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSecrets, readSecrets, errorDeFormato, getSecret, secretPresence } from "../dist/secrets.js";

// sk-or-v1- + 64 hex (formato real de OpenRouter).
const BUENA = "sk-or-v1-" + "a".repeat(64);
// La mala que había guardada en este proyecto: OpenRouter la rechaza con 401.
const MALA = "tsk-or-v1-" + "7".repeat(64);

function raizTmp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-secrets-"));
}

test("setSecrets guarda una OPENROUTER_API_KEY con formato sk-or-v1- + hex", () => {
  const root = raizTmp();
  try {
    const r = setSecrets(root, { OPENROUTER_API_KEY: BUENA });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.saved, ["OPENROUTER_API_KEY"]);
    assert.equal(readSecrets(root)["OPENROUTER_API_KEY"], BUENA);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setSecrets rechaza una clave con formato no-OpenRouter y no escribe nada", () => {
  const root = raizTmp();
  try {
    const r = setSecrets(root, { OPENROUTER_API_KEY: MALA });
    assert.ok(r.error && r.error.includes("sk-or-v1-"), "explica el formato correcto");
    assert.ok(r.error.includes("tsk"), "dice qué se intentó guardar");
    assert.deepEqual(r.saved, []);
    assert.equal(readSecrets(root)["OPENROUTER_API_KEY"], undefined, "la mala no queda guardada");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setSecrets es atómico: si una clave del lote es mala, no guarda ninguna", () => {
  const root = raizTmp();
  try {
    const r = setSecrets(root, { AXIOM_TELEGRAM_WEBHOOK_SECRET: "sec1", OPENROUTER_API_KEY: MALA });
    assert.ok(r.error);
    assert.deepEqual(r.saved, []);
    assert.equal(readSecrets(root)["AXIOM_TELEGRAM_WEBHOOK_SECRET"], undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("errorDeFormato solo vigila las claves con formato conocido", () => {
  assert.ok(errorDeFormato("OPENROUTER_API_KEY", MALA));
  assert.equal(errorDeFormato("OPENROUTER_API_KEY", BUENA), undefined);
  assert.equal(errorDeFormato("OPENAI_API_KEY", "cualquier-cosa"), undefined, "sin validación exigida");
  assert.equal(errorDeFormato("AXIOM_TELEGRAM_WEBHOOK_SECRET", MALA), undefined);
});

// El servidor hereda env viejas: una OPENROUTER_API_KEY rota (tsk-or-v1-…)
// exportada en el shell ocultaba para siempre la clave buena guardada desde la
// web, porque getSecret daba prioridad a process.env. Una env con formato
// inválido no debe contar: gana el archivo.
test("getSecret ignora una env de OPENROUTER con formato inválido y usa el archivo", () => {
  const root = raizTmp();
  const previa = process.env.OPENROUTER_API_KEY;
  try {
    process.env.OPENROUTER_API_KEY = MALA;
    setSecrets(root, { OPENROUTER_API_KEY: BUENA });
    assert.equal(getSecret(root, "OPENROUTER_API_KEY"), BUENA, "la env rota no tapa la clave guardada");
  } finally {
    if (previa === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previa;
    rmSync(root, { recursive: true, force: true });
  }
});

test("secretPresence no cuenta una env rota al decidir si hay clave configurada", () => {
  const root = raizTmp();
  const previa = process.env.OPENROUTER_API_KEY;
  try {
    // sin archivo y con env de formato inválido: no hay clave utilizable
    process.env.OPENROUTER_API_KEY = MALA;
    assert.equal(secretPresence(root)["OPENROUTER_API_KEY"], false, "env rota no aparece como configurada");
    // con clave buena en archivo sí hay
    setSecrets(root, { OPENROUTER_API_KEY: BUENA });
    assert.equal(secretPresence(root)["OPENROUTER_API_KEY"], true);
    // env buena: también cuenta
    process.env.OPENROUTER_API_KEY = BUENA;
    rmSync(root, { recursive: true, force: true });
    assert.equal(secretPresence(root)["OPENROUTER_API_KEY"], true, "env con formato válido cuenta");
  } finally {
    if (previa === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previa;
    rmSync(root, { recursive: true, force: true });
  }
});
