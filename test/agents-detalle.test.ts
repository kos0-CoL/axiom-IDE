import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarProyecto } from "../dist/proyectos.js";
import { detalleModulo, guardarDetalleModulo } from "../dist/modules/agents/index.js";

interface AgenteJson {
  id: string;
  rol: string;
  estado: string;
  modelo: string;
  skills: string[];
  instrucciones: string;
  herramientas: { tool: string; acceso: string }[];
  presupuesto?: { tokens: number; calls: number };
}
interface ConfigJson {
  agentes: AgenteJson[];
  aristas: { de: string; a: string; tipo: string }[];
}

function proyecto(): { base: string; ruta: string } {
  const base = mkdtempSync(join(tmpdir(), "axiom-detalle-"));
  const ruta = join(base, "p");
  assert.deepEqual(asegurarProyecto(ruta), { ok: true });
  return { base, ruta };
}

function leer(ruta: string): ConfigJson {
  return JSON.parse(readFileSync(join(ruta, "agents.config.json"), "utf8")) as ConfigJson;
}

test("el detalle trae los campos editables, su ayuda y el JSON real del agente", () => {
  const { base, ruta } = proyecto();
  try {
    const r = detalleModulo(ruta, "orquestador");
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (!r.ok) return;
    const claves = r.detalle.campos.map((c) => c.k);
    for (const k of ["rol", "estado", "modelo", "skills", "herramientas", "presupuesto", "instrucciones"]) {
      assert.ok(claves.includes(k), `falta el campo ${k}`);
    }
    for (const c of r.detalle.campos) assert.ok(c.ayuda.length > 10, `sin ayuda en ${c.k}`);
    const bruto = JSON.parse(r.detalle.bruto) as AgenteJson;
    assert.equal(bruto.id, "orquestador");
    assert.equal(bruto.rol, "orquestador");
    const herr = r.detalle.campos.find((c) => c.k === "herramientas");
    assert.match(herr?.valor ?? "", /^leer=allow, buscar=allow, delega=allow$/, "el orquestador declara sus herramientas");
    assert.ok(r.detalle.aristas.length > 0, "el orquestador tiene conexiones");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("guardar por campos persiste en agents.config.json y se relee igual", () => {
  const { base, ruta } = proyecto();
  try {
    const r = guardarDetalleModulo(ruta, {
      id: "verificador",
      cambios: {
        estado: "pausado",
        modelo: "modelo-x",
        skills: "plan, verify",
        herramientas: "leer=allow, editar=ask",
        presupuesto: "12000:40",
        instrucciones: "solo cambios mínimos",
      },
    });
    assert.ok(r.ok, r.ok ? "" : r.error);
    const a = leer(ruta).agentes.find((x) => x.id === "verificador");
    assert.ok(a);
    if (!a) return;
    assert.equal(a.estado, "pausado");
    assert.equal(a.modelo, "modelo-x");
    assert.deepEqual(a.skills, ["plan", "verify"]);
    assert.deepEqual(a.herramientas, [
      { tool: "leer", acceso: "allow" },
      { tool: "editar", acceso: "ask" },
    ]);
    assert.deepEqual(a.presupuesto, { tokens: 12000, calls: 40 });
    assert.equal(a.instrucciones, "solo cambios mínimos");

    const d = detalleModulo(ruta, "verificador");
    assert.ok(d.ok, d.ok ? "" : d.error);
    if (!d.ok) return;
    assert.equal(d.detalle.campos.find((c) => c.k === "herramientas")?.valor, "leer=allow, editar=ask");
    assert.equal(d.detalle.campos.find((c) => c.k === "presupuesto")?.valor, "12000:40");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("el modo avanzado guarda el JSON y vaciar presupuesto lo elimina", () => {
  const { base, ruta } = proyecto();
  try {
    const d = detalleModulo(ruta, "revisor");
    assert.ok(d.ok, d.ok ? "" : d.error);
    if (!d.ok) return;
    const obj = JSON.parse(d.detalle.bruto) as AgenteJson;
    obj.instrucciones = "revisa políticas antes de ejecutar";
    obj.herramientas = [{ tool: "sandbox", acceso: "deny" }];
    obj.presupuesto = { tokens: 500, calls: 5 };
    const r = guardarDetalleModulo(ruta, { id: "revisor", bruto: JSON.stringify(obj) });
    assert.ok(r.ok, r.ok ? "" : r.error);

    let a = leer(ruta).agentes.find((x) => x.id === "revisor");
    assert.equal(a?.instrucciones, "revisa políticas antes de ejecutar");
    assert.deepEqual(a?.presupuesto, { tokens: 500, calls: 5 });

    const vacio = guardarDetalleModulo(ruta, { id: "revisor", cambios: { presupuesto: "" } });
    assert.ok(vacio.ok, vacio.ok ? "" : vacio.error);
    a = leer(ruta).agentes.find((x) => x.id === "revisor");
    assert.equal(a?.presupuesto, undefined, "el presupuesto vacío se elimina");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("los datos inválidos se rechazan sin tocar el archivo", () => {
  const { base, ruta } = proyecto();
  try {
    const antes = readFileSync(join(ruta, "agents.config.json"), "utf8");
    const bruto = JSON.parse((detalleModulo(ruta, "orquestador") as { ok: true; detalle: { bruto: string } }).detalle.bruto) as AgenteJson;
    const casos: { entrada: { cambios?: Record<string, unknown>; bruto?: string }; espera: RegExp }[] = [
      { entrada: { cambios: { herramientas: "leer=quizas" } }, espera: /herramienta inválida/ },
      { entrada: { cambios: { skills: "no-existe-esta-skill" } }, espera: /sin cuerpo ni archivo/ },
      { entrada: { cambios: { rol: "jefe" } }, espera: /rol inválido/ },
      { entrada: { cambios: { presupuesto: "mucho" } }, espera: /tokens:llamadas/ },
      { entrada: { cambios: { id: "otro" } }, espera: /campo no editable/ },
      { entrada: { bruto: JSON.stringify({ ...bruto, id: "otro" }) }, espera: /el id no se cambia/ },
      { entrada: { bruto: "{no json" }, espera: /JSON inválido/ },
      { entrada: { bruto: JSON.stringify({ ...bruto, rol: "jefe" }) }, espera: /JSON del agente inválido/ },
    ];
    for (const c of casos) {
      const r = guardarDetalleModulo(ruta, { id: "orquestador", ...c.entrada });
      assert.equal(r.ok, false, `debió rechazar: ${JSON.stringify(c.entrada)}`);
      if (!r.ok) assert.match(r.error, c.espera);
    }
    assert.equal(readFileSync(join(ruta, "agents.config.json"), "utf8"), antes, "el archivo no cambió");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
