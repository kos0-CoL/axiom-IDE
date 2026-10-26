import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { datosModulo } from "../dist/modules/kanban/index.js";
import { PAGE, startWeb } from "../dist/web.js";
import { openDb } from "../dist/store.js";
import { setModulo } from "../dist/modulos.js";

function raiz(): string {
  return mkdtempSync(join(tmpdir(), "axiom-kanban-"));
}

function sembrar(root: string): void {
  const db = openDb(root);
  const ins = db.prepare(
    "INSERT INTO tasks(id,spec_id,spec_ver,title,scenario,estado,owner) VALUES(?,?,?,?,?,?,?)",
  );
  ins.run("a-T1", "a", "v1", "Tarea uno", "", "pendiente", "unassigned");
  ins.run("a-T2", "a", "v1", "Tarea dos", "", "pendiente", "naza");
  ins.run("b-T1", "b", "v1", "Tarea tres", "", "verificado", "unassigned");
  ins.run("b-T2", "b", "v1", "Tarea cuatro", "", "bloqueado", "unassigned");
  ins.run("c-T1", "c", "v1", "Tarea fuera de esquema", "", "en-revision", "unassigned");
  db.close();
}

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

test("kanban agrupa las tareas por estado en columnas ordenadas y sin perder estados nuevos", () => {
  const root = raiz();
  try {
    sembrar(root);
    const d = datosModulo(root);
    assert.equal(d.vacio, false);
    assert.deepEqual(
      d.columnas.map((c) => c.id),
      ["pendiente", "implementado", "verificado", "bloqueado", "en-revision"],
    );
    const pend = d.columnas.find((c) => c.id === "pendiente");
    assert.ok(pend);
    assert.equal(pend.total, 2);
    assert.equal(pend.tarjetas.length, 2);
    assert.equal(pend.tarjetas[0].spec, "a");
    assert.equal(pend.tarjetas[1].owner, "naza");
    // columna conocida sin tareas se muestra vacía, no desaparece
    assert.equal(d.columnas.find((c) => c.id === "implementado")?.total, 0);
    assert.equal(d.columnas.find((c) => c.id === "verificado")?.tarjetas[0].id, "b-T1");
    assert.match(d.fuente, /tabla tasks/);
    // nada de HTML en los datos: el panel pinta, el módulo no
    assert.equal(JSON.stringify(d).includes("<"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("proyecto sin tareas: columnas conocidas vacías y fuente honesta", () => {
  const root = raiz();
  try {
    const d = datosModulo(root);
    assert.equal(d.vacio, true);
    assert.deepEqual(d.columnas.map((c) => c.id), ["pendiente", "implementado", "verificado", "bloqueado"]);
    assert.match(d.fuente, /sin tareas todavía/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("el tablero se sirve por HTTP y la página lo pinta; apagado = 409", async () => {
  const root = raiz();
  sembrar(root);
  const server = startWeb(root, await puertoLibre());
  try {
    const r = await fetch(`http://127.0.0.1:${server.port}/api/modulos/datos?nombre=kanban`);
    assert.equal(r.status, 200);
    const d = (await r.json()) as { ok: boolean; datos: { columnas: { id: string }[] } };
    assert.equal(d.ok, true);
    assert.equal(d.datos.columnas.length, 5);

    // la vista del módulo existe en la página servida (costura modtablero)
    assert.ok(PAGE.includes("modtablero"), "falta modtablero en la web");
    assert.ok(PAGE.includes(".board{"), "falta el CSS del tablero");

    setModulo(root, "kanban", "off");
    const off = await fetch(`http://127.0.0.1:${server.port}/api/modulos/datos?nombre=kanban`);
    assert.equal(off.status, 409);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// DOM mínimo: el render se ejercita como lo haría el navegador, sin red.
interface Elem {
  className: string;
  textContent: string;
  children: Elem[];
  innerHTML: string;
  attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
  appendChild(c: Elem): Elem;
}

function elem(): Elem {
  const e = {
    className: "",
    textContent: "",
    children: [] as Elem[],
    innerHTML: "",
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) { e.attrs[k] = v; },
    appendChild(c: Elem) { e.children.push(c); return c; },
  };
  return e;
}

test("modtablero pinta las columnas del DOM con las tarjetas recibidas", () => {
  const ini = PAGE.lastIndexOf("<script>") + "<script>".length;
  const fin = PAGE.lastIndexOf("</scr" + "ipt>");
  const js = PAGE.slice(ini, fin);
  const linea = js.split("\n").find((l) => l.startsWith("function modtablero("));
  assert.ok(linea, "no se encontró la definición de modtablero");

  const panel = elem();
  const context: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => (id === "modpanel" ? panel : null),
      createElement: () => elem(),
    },
  };
  vm.createContext(context);
  new vm.Script(linea).runInContext(context);

  const modtablero = context.modtablero as (d: unknown) => void;
  assert.equal(typeof modtablero, "function");
  modtablero({
    datos: {
      columnas: [
        { id: "pendiente", titulo: "pendiente", total: 3, tarjetas: [{ id: "x-T1", titulo: "Hola", spec: "x", owner: "naza" }] },
        { id: "listo", titulo: "listo", total: 0, tarjetas: [] },
      ],
      fuente: "SQLite del proyecto (tabla tasks)",
    },
  });

  assert.equal(panel.children.length, 2, "tablero + pie con la fuente");
  const board = panel.children[0];
  assert.equal(board.className, "board");
  assert.equal(board.children.length, 2);
  const [col1, col2] = board.children;
  assert.equal(col1.className, "bcol");
  assert.equal(col1.children[0].textContent, "pendiente — 3");
  assert.equal(col1.children[1].className, "bcard");
  assert.equal(col1.children[1].children[0].textContent, "Hola");
  assert.match(col1.children[1].children[2].textContent, /^x · naza$/);
  assert.equal(col2.children[1].textContent, "Sin tareas");
  assert.match(panel.children[1].textContent, /tabla tasks/);
});
