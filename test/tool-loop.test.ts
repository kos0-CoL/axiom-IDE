import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  correrLoop,
  extraerLlamadas,
  leerArchivoSandbox,
  seccionHerramientas,
  textoSinBloques,
  type DepsLoop,
} from "../dist/modules/agents/tool-loop.js";
import { ejecutarAgenteConTools, herramientasLoop } from "../dist/modules/agents/ejecucion.js";
import { asegurarProyecto } from "../dist/proyectos.js";

const OK = (text: string) => ({ ok: true as const, text, ms: 1, proveedor: "t", model: "m", uso: { prompt: 1, respuesta: 1, total: 2, fuente: "medido" as const } });
const ALLOW = { decision: "allow" as const, motivo: "test" };

function deps(turnos: string[], extra: Partial<DepsLoop> = {}): { d: DepsLoop; vistos: string[] } {
  const vistos: string[] = [];
  let i = 0;
  const d: DepsLoop = {
    spawn: async (p: string) => {
      vistos.push(p);
      return OK(turnos[Math.min(i++, turnos.length - 1)]);
    },
    autorizar: async () => ALLOW,
    leer: () => "contenido real",
    delegar: async () => "subtarea hecha",
    buscar: async () => "[1] Ref\nhttps://x\nsnippet",
    ...extra,
  };
  return { d, vistos };
}

test("extrae llamadas válidas e ignora basura", () => {
  const t = 'texto\n```tool\n{"tool":"leer","ruta":"src/a.ts"}\n```\n```tool\nno-json\n```\n```tool\n{"tool":"delega","agente":"explorador","tarea":"mapea"}\n```\n```js\ncodigo();\n```';
  const ls = extraerLlamadas(t);
  assert.equal(ls.length, 2);
  assert.deepEqual(ls[0], { tool: "leer", objetivo: "src/a.ts", tarea: "" });
  assert.deepEqual(ls[1], { tool: "delega", objetivo: "explorador", tarea: "mapea" });
  assert.equal(textoSinBloques(t).includes("```tool"), false);
  assert.match(textoSinBloques(t), /texto/);
});

test("sin bloques: un solo spawn, texto intacto", async () => {
  const { d, vistos } = deps(["trabajo final"]);
  const r = await correrLoop("a", "base", ["leer"], d);
  assert.equal(r.texto, "trabajo final");
  assert.equal(r.turnos, 1);
  assert.equal(r.herramientas, 0);
  assert.equal(vistos.length, 1);
});

test("leer real en el loop: el segundo turno ve el contenido", async () => {
  const { d, vistos } = deps([
    'necesito datos\n```tool\n{"tool":"leer","ruta":"src/a.ts"}\n```',
    "con los datos, trabajo final",
  ], { leer: () => "VALOR-REAL-DEL-ARCHIVO" });
  const r = await correrLoop("a", "base", ["leer"], d);
  assert.equal(r.turnos, 2);
  assert.equal(r.herramientas, 1);
  assert.match(vistos[1], /VALOR-REAL-DEL-ARCHIVO/);
  assert.equal(r.texto, "con los datos, trabajo final");
});

test("delega real: el resultado alimenta el turno siguiente", async () => {
  const { d, vistos } = deps([
    '```tool\n{"tool":"delega","agente":"explorador","tarea":"mapea x"}\n```',
    "síntesis final",
  ], { delegar: async (id, tarea) => `hecho por ${id}: ${tarea}` });
  const r = await correrLoop("padre", "base", ["delega"], d);
  assert.match(vistos[1], /hecho por explorador: mapea x/);
  assert.equal(r.texto, "síntesis final");
});

test("cada llamada se autoriza: deny aborta con el motivo", async () => {
  const { d } = deps(['```tool\n{"tool":"leer","ruta":"src/a.ts"}\n```'], {
    autorizar: async () => ({ decision: "deny" as const, motivo: "política lo prohíbe" }),
  });
  await assert.rejects(() => correrLoop("a", "base", ["leer"], d), /no puede usar leer.*política lo prohíbe/);
});

test("ask sin aprobación aborta con instrucciones", async () => {
  const { d } = deps(['```tool\n{"tool":"leer","ruta":"src/a.ts"}\n```'], {
    autorizar: async () => ({ decision: "ask" as const, motivo: "falta aprobación", id: "ap-1" }),
  });
  await assert.rejects(() => correrLoop("a", "base", ["leer"], d), /necesita aprobación.*ap-1.*aprueba y vuelve a correr/);
});

test("herramienta no ofrecida: fail closed aunque el modelo la pida", async () => {
  const { d } = deps(['```tool\n{"tool":"delega","agente":"x","tarea":"y"}\n```']);
  await assert.rejects(() => correrLoop("a", "base", ["leer"], d), /no está disponible/);
});

test("tope de turnos aborta sin alucinar trabajo", async () => {
  const { d } = deps(['```tool\n{"tool":"leer","ruta":"src/a.ts"}\n```'], { leer: () => "datos" });
  await assert.rejects(() => correrLoop("a", "base", ["leer"], d, { maxTurnos: 2 }), /tope de turnos \(2\) sin respuesta final/);
});

test("tope total de herramientas aborta", async () => {
  const { d } = deps(['```tool\n{"tool":"leer","ruta":"a"}\n```\n```tool\n{"tool":"leer","ruta":"b"}\n```']);
  await assert.rejects(() => correrLoop("a", "base", ["leer"], d, { maxTotal: 1, maxTurnos: 3 }), /tope de herramientas \(1\)/);
});

test("sandbox de leer: dentro sí, fuera no, binario no", () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-loop-leer-"));
  try {
    writeFileSync(join(base, "ok.txt"), "hola");
    assert.equal(leerArchivoSandbox(base, "ok.txt"), "hola");
    assert.match(leerArchivoSandbox(base, "../escape.txt"), /fuera del proyecto/);
    assert.match(leerArchivoSandbox(base, "/abs.txt"), /fuera del proyecto/);
    assert.match(leerArchivoSandbox(base, "no-existe.txt"), /no existe/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("herramientasLoop solo ofrece leer/delega no-denegadas", () => {
  assert.deepEqual(herramientasLoop({ herramientas: [{ tool: "leer", acceso: "allow" }, { tool: "buscar", acceso: "allow" }] }), ["leer", "buscar"]);
  assert.deepEqual(herramientasLoop({ herramientas: [{ tool: "leer", acceso: "deny" }] }), []);
  assert.deepEqual(herramientasLoop({ herramientas: [] }), []);
  assert.ok(!seccionHerramientas(["leer"]).includes("delega"), "el prompt no lista lo no ofrecido");
  assert.ok(seccionHerramientas(["leer", "delega", "buscar"]).includes('"tool":"buscar"'), "buscar documentada cuando se ofrece");
});

test("buscar real en el loop: refs como dato, sin key como error-dato", async () => {
  const { d, vistos } = deps([
    '```tool\n{"tool":"buscar","consulta":"rate limit exa"}\n```',
    "síntesis con refs",
  ], { buscar: async (q) => `[1] Doc\nhttps://doc\nRef sobre ${q}` });
  const r = await correrLoop("incidentes", "base", ["buscar"], d);
  assert.equal(r.herramientas, 1);
  assert.match(vistos[1], /Ref sobre rate limit exa/);
  assert.equal(r.texto, "síntesis con refs");
  // Sin key el ejecutor real falla cerrado como dato: el loop sigue.
  const base = mkdtempSync(join(tmpdir(), "axiom-loop-buscar-"));
  const root = join(base, "p");
  try {
    assert.deepEqual(asegurarProyecto(root), { ok: true });
    const agente = { id: "incidentes", rol: "nodo" as const, modelo: "hereda-proveedor", estado: "activo" as const, skills: [], instrucciones: "", herramientas: [{ tool: "buscar", acceso: "allow" as const }] };
    let turno = 0;
    const r2 = await ejecutarAgenteConTools(root, agente, "investiga x", {
      falsos: {
        spawn: (async () => (++turno === 1 ? OK('```tool\n{"tool":"buscar","consulta":"x"}\n```') : OK("final sin red"))) as DepsLoop["spawn"],
        autorizar: async () => ALLOW,
      },
    });
    assert.equal(r2.texto, "final sin red");
    assert.equal(r2.herramientas, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("ejecutarAgenteConTools integra broker real: deny de leer aborta", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-loop-int-"));
  const root = join(base, "p");
  try {
    assert.deepEqual(asegurarProyecto(root), { ok: true });
    const agente = { id: "explorador", rol: "nodo" as const, modelo: "hereda-proveedor", estado: "activo" as const, skills: [], instrucciones: "", herramientas: [{ tool: "leer", acceso: "allow" as const }] };
    await assert.rejects(
      () => ejecutarAgenteConTools(root, agente, "haz x", {
        falsos: {
          spawn: async () => OK('```tool\n{"tool":"leer","ruta":"src/a.ts"}\n```'),
          // Sin policies.*.json: leer es riesgo bajo → allow; lo denegamos aquí para probar el cierre.
          autorizar: async () => ({ decision: "deny" as const, motivo: "cerrado en test" }),
        },
      }),
      /no puede usar leer.*cerrado en test/,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
