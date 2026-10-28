import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aRomano,
  deRomano,
  enmendarPrincipio,
  fijarPrincipio,
  leerConstitucion,
  quitarPrincipio,
  textoConstitucion,
  textoConstitucionPrompt,
} from "../dist/constitution.js";
import { promptPara } from "../dist/sessions.js";

function base(): string {
  return mkdtempSync(join(tmpdir(), "axiom-constitution-"));
}

test("romanos: ida y vuelta hasta XX", () => {
  assert.equal(aRomano(1), "I");
  assert.equal(aRomano(4), "IV");
  assert.equal(aRomano(14), "XIV");
  assert.equal(aRomano(20), "XX");
  assert.equal(deRomano("xiv"), 14);
  assert.equal(deRomano(""), null);
  assert.equal(deRomano("ABC"), null);
  assert.throws(() => aRomano(0), /rango/);
});

test("primera redacción: 1.0.0 con Ratified; añadir sube MINOR", () => {
  const root = base();
  try {
    const r1 = fijarPrincipio(root, "Fail closed", "Ante duda, denegar. MUST anteponer seguridad.");
    assert.equal(r1.ok, true);
    assert.match(r1.msg, /1\.0\.0/);
    const r2 = fijarPrincipio(root, "Trazar todo", "Toda decisión deja traza.", "Sin traza no hay confianza.");
    assert.match(r2.msg, /1\.1\.0/);
    const leida = leerConstitucion(root);
    assert.equal(leida.existe, true);
    assert.equal(leida.constitucion?.version, "1.1.0");
    assert.match(leida.constitucion?.ratificada ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(leida.constitucion?.enmendada, leida.constitucion?.ratificada, "al ratificar, amended = ratified");
    assert.deepEqual(leida.constitucion?.principios.map((p) => p.romano), ["I", "II"]);
    const raw = readFileSync(join(root, ".specify", "memory", "constitution.md"), "utf8");
    assert.match(raw, /Version: 1\.1\.0 \| Ratified: \d{4}-\d{2}-\d{2} \| Last Amended: \d{4}-\d{2}-\d{2}/);
    assert.match(raw, /Rationale: Sin traza no hay confianza/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enmendar y quitar suben MAJOR, Ratified se conserva y se renumera", () => {
  const root = base();
  try {
    fijarPrincipio(root, "A", "reglas A.");
    fijarPrincipio(root, "B", "reglas B.");
    const antes = leerConstitucion(root).constitucion!;
    const e = enmendarPrincipio(root, "ii", "reglas B enmendadas.");
    assert.equal(e.ok, true);
    assert.match(e.msg, /2\.0\.0/);
    const q = quitarPrincipio(root, "I");
    assert.match(q.msg, /3\.0\.0/);
    const despues = leerConstitucion(root).constitucion!;
    assert.equal(despues.ratificada, antes.ratificada, "Ratified no cambia");
    assert.deepEqual(despues.principios.map((p) => p.romano + p.nombre), ["IB"]);
    assert.equal(despues.principios[0].reglas, "reglas B enmendadas.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail closed: inválidos no tocan el archivo", () => {
  const root = base();
  try {
    assert.equal(fijarPrincipio(root, "", "reglas.").ok, false);
    assert.equal(fijarPrincipio(root, "A", "").ok, false);
    fijarPrincipio(root, "A", "reglas A.");
    const doc = readFileSync(join(root, ".specify", "memory", "constitution.md"), "utf8");
    assert.equal(fijarPrincipio(root, "a", "otras.").ok, false, "duplicado insensible a mayúsculas");
    assert.equal(enmendarPrincipio(root, "IX", "x.").ok, false);
    assert.equal(quitarPrincipio(root, "IX").ok, false);
    assert.equal(enmendarPrincipio(root, "I", "").ok, false);
    assert.equal(readFileSync(join(root, ".specify", "memory", "constitution.md"), "utf8"), doc, "nada inválido pisa");
    assert.equal(enmendarPrincipio(root, "I", "x.").ok, true);
    assert.equal(quitarPrincipio(root, "zzz").ok, false);
    const sinNada = mkdtempSync(join(tmpdir(), "axiom-cons-vacio-"));
    try {
      assert.equal(enmendarPrincipio(sinNada, "I", "x.").ok, false);
      assert.equal(quitarPrincipio(sinNada, "I").ok, false);
      assert.ok(!existsSync(join(sinNada, ".specify", "memory", "constitution.md")));
      assert.equal(textoConstitucionPrompt(sinNada), "", "sin archivo el bloque es vacío");
    } finally {
      rmSync(sinNada, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("el bloque manda en plan y build, ask queda fuera", () => {
  const root = base();
  try {
    fijarPrincipio(root, "Fail closed", "Ante duda, denegar.");
    const bloque = textoConstitucionPrompt(root);
    assert.match(bloque, /constitución del proyecto v1\.0\.0/);
    assert.match(bloque, /I\. Fail closed/);
    const plan = promptPara("plan", "", "implementa el login", { constitucion: bloque });
    assert.ok(plan.includes(bloque), "el plan recibe la constitución");
    assert.match(plan, /plan numerado/);
    const build = promptPara("build", "", "implementa el login", { constitucion: bloque });
    assert.ok(build.includes(bloque), "el build la recibe como restricción");
    const ask = promptPara("ask", "", "qué es esto", { constitucion: bloque });
    assert.ok(!ask.includes(bloque), "ask no la lleva");
    const sinBloque = promptPara("plan", "", "implementa el login", {});
    assert.ok(!sinBloque.includes("constitución del proyecto"), "sin bloque el prompt sale como hoy");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("textoConstitucion resume versión y principios", () => {
  const root = base();
  try {
    assert.match(textoConstitucion(root), /Sin constitución/);
    fijarPrincipio(root, "A", "reglas A.");
    const t = textoConstitucion(root);
    assert.match(t, /1\.0\.0/);
    assert.match(t, /I\. A: reglas A\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
