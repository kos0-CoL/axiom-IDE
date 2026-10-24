import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { validarPropuestaModulo, parsearPropuestaModulo, guardarPropuestaModulo, obtenerPropuestaModulo, marcarPropuestaModuloInstalada } from "../dist/modules/module-builder.js";
import { startWeb } from "../dist/web.js";
import { setModulo, listarModulos } from "../dist/modulos.js";
import { AdaptersConfig, saveConfig } from "../dist/modules/adapters/config.js";

const buena = {
  nombre: "module-test-real",
  tipo: "lista" as const,
  descripcion: "Normaliza consulta de lista.",
  resumen: "Recorta y normaliza la consulta entregada y devuelve un resultado verificable.",
  indexTs: 'export const NOMBRE = "module-test-real";\nexport function estadoTexto(): string { return NOMBRE + ": listo"; }\nexport function datosModulo(root: string): unknown { return { consulta: root.trim().toLowerCase(), longitud: root.trim().length }; }',
  configTs: 'import { z } from "zod";\nexport const Config = z.object({});',
};
const refs = [{ title: "Guía fuente", url: "https://example.org/reference", snippet: "Extracto real" }];
let root = "";
let base = "";
let closeServer: () => void = () => {};
let moduleDir = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
  });
}

async function post(route: string, body: unknown) {
  const r = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() as any };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "axiom-module-builder-"));
  moduleDir = join(process.cwd(), "src/modules", buena.nombre);
  const server = startWeb(root, await freePort());
  base = `http://127.0.0.1:${server.port}`;
  closeServer = server.close;
});

afterEach(() => {
  closeServer();
  if (existsSync(moduleDir)) rmSync(moduleDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("parser valida tipos, longitudes y JSON de propuesta", () => {
  assert.equal(parsearPropuestaModulo(JSON.stringify(buena)).ok, true);
  assert.equal(parsearPropuestaModulo("```json\n" + JSON.stringify(buena) + "\n```").ok, true);
  assert.equal(parsearPropuestaModulo("no JSON").ok, false);
  assert.equal(parsearPropuestaModulo(JSON.stringify({ ...buena, nombre: "No válido" })).ok, false);
});

test("validador compila y ejecuta contrato aislado, rechaza efectos laterales y objetos vacíos", async () => {
  assert.deepEqual(await validarPropuestaModulo(buena), { ok: true, errores: [] });
  const conRed = { ...buena, indexTs: buena.indexTs.replace('return { consulta:', 'return fetch("https://invalid.example"); // { consulta:') };
  const insegura = await validarPropuestaModulo(conRed);
  assert.equal(insegura.ok, false);
  assert.match(insegura.errores.join(" "), /no permitido|fuera del entorno/);
  const vacia = { ...buena, indexTs: buena.indexTs.replace('return { consulta: root.trim().toLowerCase(), longitud: root.trim().length };', 'return {};') };
  const resultadoVacio = await validarPropuestaModulo(vacia);
  assert.equal(resultadoVacio.ok, false);
  assert.match(resultadoVacio.errores.join(" "), /objeto JSON comprobable/);
});

test("propuestas se persisten, checksum detecta alteración y estado instalado sobrevive", async () => {
  const saved = guardarPropuestaModulo(root, buena, refs);
  assert.equal(saved.estado, "pendiente");
  assert.deepEqual(obtenerPropuestaModulo(root, saved.id), saved);
  marcarPropuestaModuloInstalada(root, saved.id);
  assert.equal(obtenerPropuestaModulo(root, saved.id)?.estado, "instalada");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(root, "axiom.db"));
  try { db.prepare("UPDATE module_proposals SET payload=? WHERE id=?").run("{}", saved.id); } finally { db.close(); }
  assert.equal(obtenerPropuestaModulo(root, saved.id), undefined, "payload alterado no se devuelve ni puede aprobarse");
});

test("HTTP pide confirmación explícita, revalida, instala apagado y sirve módulo habilitado", async () => {
  setModulo(root, "agents", "on");
  const saved = guardarPropuestaModulo(root, buena, refs);
  const sinConfirmar = await post("/api/modulos/propuestas/aprobar", { id: saved.id });
  assert.equal(sinConfirmar.status, 400);
  assert.equal(existsSync(moduleDir), false);
  const valid = await post("/api/modulos/propuestas/validar", { id: saved.id });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.ok, true);
  const instalada = await post("/api/modulos/propuestas/aprobar", { id: saved.id, confirmar: true });
  assert.equal(instalada.status, 201, JSON.stringify(instalada.data));
  assert.equal(instalada.data.enabled, false);
  assert.equal(obtenerPropuestaModulo(root, saved.id)?.estado, "instalada");
  assert.equal(listarModulos(root).find((m) => m.nombre === buena.nombre)?.enabled, false);
  const apagado = await fetch(`${base}/api/modulos/datos?nombre=${buena.nombre}`);
  assert.equal(apagado.status, 409);
  setModulo(root, buena.nombre, "on");
  const served = await fetch(`${base}/api/modulos/datos?nombre=${buena.nombre}`);
  assert.equal(served.status, 200);
  assert.deepEqual((await served.json() as any).datos, { consulta: root.toLowerCase(), longitud: root.length });
  const replay = await post("/api/modulos/propuestas/aprobar", { id: saved.id, confirmar: true });
  assert.equal(replay.status, 404);
});

test("generación HTTP falla cerrado con proveedor apagado y entrada inválida", async () => {
  setModulo(root, "agents", "on");
  saveConfig(root, AdaptersConfig.parse({ proveedor: "off" }));
  const invalid = await post("/api/modulos/propuestas/generar", { necesidad: "" });
  assert.equal(invalid.status, 400);
  const off = await post("/api/modulos/propuestas/generar", { necesidad: "normalizar una consulta", buscar: false });
  assert.equal(off.status, 503);
  assert.equal(off.data.ok, false);
  const pending = await fetch(`${base}/api/modulos/propuestas?id=desconocida`);
  assert.equal(pending.status, 404);
});
