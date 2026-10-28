import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ID_POLITICA,
  datosModulo,
  detalleModulo,
  guardarDetalleModulo,
} from "../dist/modules/security/index.js";
import { listarModulos } from "../dist/modulos.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "axiom-security-mod-"));
}

function leerPolitica(base: string): unknown {
  return JSON.parse(readFileSync(join(base, "policies.global.json"), "utf8"));
}

test("las filas de skills delegan al editor del módulo skills", () => {
  const base = temp();
  try {
    const r = detalleModulo(base, "sec-net");
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.equal(r.detalle.id, "sec-net");
    const claves = r.detalle.campos.map((c) => c.k);
    assert.deepEqual(claves, ["descripcion", "cuerpo"]);
    assert.ok(r.detalle.bruto.includes("sec-net"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("un id que no es skill ni política responde error", () => {
  const base = temp();
  try {
    const r = detalleModulo(base, "no-existe");
    assert.equal(r.ok, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("guardar un skill desde security crea el override en disco", () => {
  const base = temp();
  try {
    const r = guardarDetalleModulo(base, {
      id: "sec-net",
      cambios: { descripcion: "red propia", cuerpo: "Bloquea salidas salvo allowlist." },
    });
    assert.ok(r.ok, r.ok ? "" : (r as { error: string }).error);
    const p = join(base, "skills", "sec-net", "SKILL.md");
    assert.ok(existsSync(p), "debería existir el override");
    assert.match(readFileSync(p, "utf8"), /Bloquea salidas salvo allowlist/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("politica-global expone terminal/delega/techo con ayuda y valores por defecto", () => {
  const base = temp();
  try {
    const r = detalleModulo(base, ID_POLITICA);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.equal(r.detalle.id, ID_POLITICA);
    const porK = new Map(r.detalle.campos.map((c) => [c.k, c]));
    const terminal = porK.get("terminal");
    assert.equal(terminal?.tipo, "opciones");
    assert.deepEqual(terminal?.opciones, ["sí", "no"]);
    assert.equal(terminal?.valor, "no", "sin archivo equivale a no (deniega)");
    assert.equal(porK.get("delega")?.tipo, "opciones");
    assert.equal(porK.get("techo")?.valor, "3:100000:500");
    for (const c of r.detalle.campos) assert.ok((c.ayuda ?? "").length > 10, `sin ayuda en ${c.k}`);
    assert.ok(r.detalle.bruto.includes("techo"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("guardar política válida persiste y se relee igual", () => {
  const base = temp();
  try {
    const r = guardarDetalleModulo(base, {
      id: ID_POLITICA,
      cambios: { terminal: "sí", delega: "no", techo: "5:200000:100" },
    });
    assert.ok(r.ok, r.ok ? "" : (r as { error: string }).error);
    assert.deepEqual(leerPolitica(base), {
      tools: { terminal: true, delega: false },
      techo: { rondas: 5, tokens: 200000, calls: 100 },
    });
    const d = detalleModulo(base, ID_POLITICA);
    assert.ok(d.ok);
    if (!d.ok) return;
    const porK = new Map(d.detalle.campos.map((c) => [c.k, c]));
    assert.equal(porK.get("terminal")?.valor, "sí");
    assert.equal(porK.get("delega")?.valor, "no");
    assert.equal(porK.get("techo")?.valor, "5:200000:100");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("guardar política por JSON completo reemplaza y conserva otras tools", () => {
  const base = temp();
  try {
    const bruto = JSON.stringify({
      tools: { terminal: false, delega: true, read: true },
      techo: { rondas: 4, tokens: 50000, calls: 50 },
    });
    const r = guardarDetalleModulo(base, { id: ID_POLITICA, bruto });
    assert.ok(r.ok, r.ok ? "" : (r as { error: string }).error);
    assert.deepEqual(leerPolitica(base), {
      tools: { terminal: false, delega: true, read: true },
      techo: { rondas: 4, tokens: 50000, calls: 50 },
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rechazos fail-closed dejan policies.global.json intacto", () => {
  const base = temp();
  try {
    const bueno = guardarDetalleModulo(base, {
      id: ID_POLITICA,
      cambios: { terminal: "no", delega: "no", techo: "3:100000:500" },
    });
    assert.ok(bueno.ok);
    const antes = readFileSync(join(base, "policies.global.json"), "utf8");
    const malos: unknown[] = [
      { terminal: "quizás", delega: "no", techo: "3:100000:500" },
      { terminal: "sí", delega: "no", techo: "a:b:c" },
      { terminal: "sí", delega: "no", techo: "0:100000:500" },
      { terminal: "sí", delega: "no", techo: "3:99999999:500" },
      { terminal: "sí", delega: "no", techo: "3:100000:500", otro: "x" },
    ];
    for (const cambios of malos) {
      const r = guardarDetalleModulo(base, { id: ID_POLITICA, cambios });
      assert.equal(r.ok, false, `debería rechazar ${JSON.stringify(cambios)}`);
    }
    const brutosMalos = [
      "{mal json",
      JSON.stringify({ tools: { terminal: true, delega: false }, techo: { rondas: 3, tokens: "mucho", calls: 5 } }),
      JSON.stringify({ tools: { terminal: "sí", delega: false }, techo: { rondas: 3, tokens: 1, calls: 1 } }),
      JSON.stringify({ tools: { terminal: true, delega: true }, techo: { rondas: 3, tokens: 1, calls: 1 }, extra: 1 }),
    ];
    for (const bruto of brutosMalos) {
      const r = guardarDetalleModulo(base, { id: ID_POLITICA, bruto });
      assert.equal(r.ok, false, `debería rechazar bruto ${bruto.slice(0, 40)}`);
    }
    assert.equal(readFileSync(join(base, "policies.global.json"), "utf8"), antes, "el archivo no debió cambiar");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("datosModulo incluye la fila politica-global y el módulo publica detalle", () => {
  const base = temp();
  try {
    const d = datosModulo(base) as { items: { id: string; nota: string }[] };
    const fila = d.items.find((i) => i.id === ID_POLITICA);
    assert.ok(fila, "falta la fila politica-global");
    assert.match(fila?.nota ?? "", /terminal=/);
    const lista = listarModulos(base);
    assert.equal(lista.find((m) => m.nombre === "security")?.detalle, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
