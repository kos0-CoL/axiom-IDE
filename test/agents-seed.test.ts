import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarProyecto } from "../dist/proyectos.js";
import { loadAgents } from "../dist/modules/agents/config.js";

const TIPOS = new Set(["delega", "comunica", "escala"]);

test("el esqueleto nuevo escribe agents.config.json que loadAgents acepta", () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-seed-"));
  const ruta = join(base, "mi-proyecto");
  try {
    const r = asegurarProyecto(ruta);
    assert.deepEqual(r, { ok: true });
    const carga = loadAgents(ruta);
    assert.ok(carga.ok, `loadAgents rechaza el esqueleto: ${!carga.ok ? carga.error : ""}`);
    if (carga.ok) {
      assert.equal(carga.defecto, false);
      for (const e of carga.config.aristas) assert.ok(TIPOS.has(e.tipo), `tipo sembrado inválido: ${e.tipo}`);
      assert.equal(carga.config.aristas.length, 7);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("loadAgents repara los tipos legados de la siembra vieja ('sin asa', 'revista')", () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-sinasa-"));
  const ruta = join(base, "viejo");
  try {
    assert.deepEqual(asegurarProyecto(ruta), { ok: true });
    // Archivo tal como lo escribió el esqueleto viejo (JSON crudo, tipos inválidos).
    writeFileSync(join(ruta, "agents.config.json"), JSON.stringify({
      nombre: "viejo",
      agentes: [
        { id: "orquestador", rol: "orquestador" },
        { id: "implementador", rol: "nodo" },
        { id: "verificador", rol: "nodo" },
        { id: "revisor", rol: "nodo" },
      ],
      aristas: [
        { de: "orquestador", a: "implementador", tipo: "delega" },
        { de: "implementador", a: "verificador", tipo: "sin asa" },
        { de: "verificador", a: "revisor", tipo: "revista" },
      ],
    }, null, 2) + "\n");
    const carga = loadAgents(ruta);
    assert.ok(carga.ok, `no reparó el legado: ${!carga.ok ? carga.error : ""}`);
    if (carga.ok) {
      assert.deepEqual(
        carga.config.aristas.map((e) => e.tipo),
        ["delega", "delega", "comunica"],
      );
    }
    // La primera carga persiste el config reparado en disco: saveAgents y el
    // CLI leen después un archivo con los tipos válidos.
    const enDisco = readFileSync(join(ruta, "agents.config.json"), "utf8");
    assert.match(enDisco, /"delega".*"delega".*"comunica"/s);
    assert.doesNotMatch(enDisco, /"sin asa"|"revista"/);
    assert.match(enDisco, /"viejo"/); // las demás claves del archivo se conservan
    const recarga = loadAgents(ruta);
    assert.ok(recarga.ok);
    assert.ok(recarga.ok && !recarga.reparado, "la segunda carga no debe reportar reparación");
    // Un tipo desconocido de verdad sigue fallando con mensaje honesto.
    writeFileSync(join(ruta, "agents.config.json"), JSON.stringify({
      agentes: [{ id: "a", rol: "orquestador" }, { id: "b", rol: "nodo" }],
      aristas: [{ de: "a", a: "b", tipo: "banana" }],
    }, null, 2) + "\n");
    const roto = loadAgents(ruta);
    assert.deepEqual(roto.ok, false);
    if (!roto.ok) {
      assert.match(roto.error, /agents\.config\.json inválido/);
      // El error señala la arista rota, no un mensaje crudo de zod:
      assert.match(roto.error, /aristas\[0\]\.tipo/);
      assert.match(roto.error, /válido: delega \| comunica \| escala/);
      assert.doesNotMatch(roto.error, /Invalid option|expected/);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el error de loadAgents nombra el campo exacto que falló", () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-campo-"));
  try {
    assert.deepEqual(asegurarProyecto(join(base, "p")), { ok: true });
    // Agente sin rol (campo ausente) y con skill que no respeta el formato.
    writeFileSync(join(base, "p", "agents.config.json"), JSON.stringify({
      agentes: [
        { id: "a", rol: "orquestador" },
        { id: "b", skills: ["pepito!"] },
      ],
      aristas: [{ de: "a", a: "b", tipo: "delega" }],
    }, null, 2) + "\n");
    const roto = loadAgents(join(base, "p"));
    assert.deepEqual(roto.ok, false);
    if (!roto.ok) {
      assert.match(roto.error, /agentes\[1\]\.rol: esperaba .*\(llegó campo ausente\)/);
      assert.match(roto.error, /agentes\[1\]\.skills\[0\]: /);
      assert.match(roto.error, /skill: a-z, 0-9, - \(1-64\)/);
    }
    // Arista apuntando a un agente que no existe: índice y causa.
    writeFileSync(join(base, "p", "agents.config.json"), JSON.stringify({
      agentes: [{ id: "a", rol: "orquestador" }],
      aristas: [{ de: "a", a: "fantasma", tipo: "delega" }],
    }, null, 2) + "\n");
    const fantasma = loadAgents(join(base, "p"));
    assert.deepEqual(fantasma.ok, false);
    if (!fantasma.ok) {
      assert.match(fantasma.error, /aristas\[0\] rota \(destino inexistente\): a → fantasma/);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
