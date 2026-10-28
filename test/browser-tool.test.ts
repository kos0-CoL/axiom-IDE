// Sesiones de navegador conducibles (ADR-0006): el agente no tiene atajo
// alrededor del broker ni de los límites duros. Este caso cubre la validación
// previa (que no gasta tool call), la allowlist de dominios, la aprobación de
// un solo uso del riesgo alto, el deny por política, el presupuesto de acciones
// y la traza con contexto/origen; el volante real (abrir, navegar, escribir,
// leer, capturar, cerrar) se ejercita contra un servidor local con el motor
// detectado.
//
// Sin motor de navegador el caso se OMITE declarando el motivo (criterio de los
// evals): nunca se salta asumiendo que pasó.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarProyecto } from "../dist/proyectos.js";
import { decide } from "../dist/broker.js";
import { loadPolicies } from "../dist/policy.js";
import { openDb } from "../dist/store.js";
import { ejecutar, listarSesiones, type RespuestaAccion } from "../dist/modules/browser/sesion.js";
import { detectarMotor } from "../dist/modules/browser/index.js";

const HERRAMIENTAS = ["browser.abrir", "navegar", "clic", "escribir", "esperar", "leerTexto", "capturar", "browser.cerrar"];

function parchearConfig(root: string, parche: Record<string, unknown>): void {
  const p = join(root, "browser.config.json");
  let actual: Record<string, unknown> = {};
  try { actual = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; } catch { /* sin config previa */ }
  writeFileSync(p, JSON.stringify({ ...actual, ...parche }) + "\n");
}

function permitir(root: string, global: Record<string, boolean>, proyecto: Record<string, boolean>): void {
  const pol = loadPolicies(root);
  pol.global.tools = { ...pol.global.tools, ...global };
  pol.project.tools = { ...pol.project.tools, ...proyecto };
  writeFileSync(join(root, "policies.global.json"), JSON.stringify(pol.global, null, 2) + "\n");
  writeFileSync(join(root, "project.json"), JSON.stringify(pol.project, null, 2) + "\n");
}

function conProyecto(fn: (root: string) => Promise<void> | void): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "axiom-browser-tool-"));
  const root = join(base, "p");
  return (async () => {
    try {
      assert.deepEqual(asegurarProyecto(root), { ok: true });
      await fn(root);
    } finally {
      for (const s of listarSesiones()) {
        try { await ejecutar(root, "cerrar", { sesion: s.id }); } catch { /* el proceso del test lo recoge */ }
      }
      rmSync(base, { recursive: true, force: true });
    }
  })();
}

function idAprobable(r: RespuestaAccion): string {
  const id = (r.msg.match(/necesita aprobación \(([^)]+)\)/) ?? [])[1];
  assert.ok(id, `sin id aprobable en: ${r.msg}`);
  return id;
}

function aprobar(root: string, r: RespuestaAccion): void {
  const d = decide(root, idAprobable(r), true, "test");
  assert.equal(d.estado, "aprobada", d.msg);
}

test("validación previa, allowlist y sesión inexistente no son tool call", () =>
  conProyecto(async (root) => {
    // La validación corre ANTES del broker: una llamada malformada no gasta
    // decisión ni deja traza.
    const mala = await ejecutar(root, "nav", { url: "ftp://interno" });
    assert.equal(mala.code, 2);
    assert.match(mala.msg, /URL inválida/);

    const sinSelector = await ejecutar(root, "click", {});
    assert.equal(sinSelector.code, 2);
    assert.match(sinSelector.msg, /selector requerido/);

    const sinSesion = await ejecutar(root, "text", {});
    assert.equal(sinSesion.code, 2);
    assert.match(sinSesion.msg, /sin sesión de navegador/);

    // Allowlist de dominios: se rechaza ANTES de tocar el motor y sin broker.
    writeFileSync(join(root, "browser.config.json"), JSON.stringify({ sesiones: { dominios: ["ejemplo.test"] } }) + "\n");
    const fuera = await ejecutar(root, "abrir", { url: "https://otro.test/" });
    assert.equal(fuera.code, 2);
    assert.match(fuera.msg, /fuera de la allowlist/);

    const db = openDb(root);
    const filas = db
      .prepare(`SELECT tool FROM trace_log WHERE tool IN (${HERRAMIENTAS.map(() => "?").join(",")})`)
      .all(...HERRAMIENTAS) as { tool: string }[];
    db.close();
    assert.equal(filas.length, 0, `nada llegó al broker: ${JSON.stringify(filas)}`);
    assert.equal(listarSesiones().length, 0, "ninguna sesión abierta ni proceso huérfano");
  }));

test("sesión CDP: aprobación única, deny, presupuesto de acciones y traza", (t) =>
  conProyecto(async (root) => {
    if (!detectarMotor(root)) {
      t.skip("sin motor de navegador (instala Chromium o la caché de Playwright)");
      return;
    }

    const html = `<!doctype html><html lang="es"><body><h1>AXIOM SESION</h1><input id="campo" oninput="document.getElementById('out').textContent='VAL:'+this.value"><button id="btn" onclick="document.getElementById('out').textContent='CLIC'">ok</button><div id="out">SIN CAMBIO</div></body></html>`;
    const servidor = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    const puerto = (servidor.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${puerto}/`;

    // Riesgo alto (abrir, navegar) → ask; medio (clic, escribir) → exige
    // global+proyecto; leer y esperar son de solo lectura → pasan solos.
    permitir(root, { "browser.abrir": true, navegar: true, clic: true, escribir: true, "browser.cerrar": true }, { clic: true, escribir: true, "browser.cerrar": true });

    const abrirSesion = async (): Promise<RespuestaAccion> => {
      for (let intento = 0; intento < 4; intento++) {
        const r = await ejecutar(root, "abrir", { url });
        if (r.code === 0) return r;
        if (/necesita aprobación/.test(r.msg)) { aprobar(root, r); continue; }
        if (/pestaña|sandbox/i.test(r.msg)) {
          // Este host bloquea los user namespaces de Chromium (AppArmor): se
          // opta por noSandbox de forma explícita y se reintenta.
          parchearConfig(root, { noSandbox: true });
          continue;
        }
        return r;
      }
      throw new Error("la sesión no pudo abrirse en 4 intentos");
    };

    try {
      // 1) abrir es openWorld → alto: siempre pasa por un humano, un uso por concesión.
      const pedida = await ejecutar(root, "abrir", { url });
      assert.equal(pedida.code, 1, pedida.msg);
      assert.match(pedida.msg, /necesita aprobación/);

      const abierta = await abrirSesion();
      assert.equal(abierta.code, 0, abierta.msg);
      const idSesion = String(abierta.datos?.sesion ?? "");
      assert.ok(idSesion, "devuelve el id de la sesión");
      assert.equal(listarSesiones().length, 1);

      // 2) lecturas de solo lectura (riesgo bajo) pasan sin aprobación.
      const texto = await ejecutar(root, "text", {});
      assert.equal(texto.code, 0, texto.msg);
      assert.match(texto.msg, /AXIOM SESION/);

      // 3) captura como evidencia, escrita en disco.
      const captura = await ejecutar(root, "shot", {});
      assert.equal(captura.code, 0, captura.msg);
      assert.ok(existsSync(String(captura.datos?.ruta)), "la captura debe existir");

      // 4) navegar (openWorld → alto) pide aprobación; la concesión gasta UN uso.
      const navPedida = await ejecutar(root, "nav", { url: `${url}?p=2` });
      assert.equal(navPedida.code, 1, navPedida.msg);
      aprobar(root, navPedida);
      const nav = await ejecutar(root, "nav", { url: `${url}?p=2` }, { origen: "web" });
      assert.equal(nav.code, 0, nav.msg);
      assert.match(String(nav.datos?.url), /\?p=2$/, "la url final refleja la navegación");

      // 5) escribir (medio: global+proyecto) y leer el efecto en la página.
      const escrito = await ejecutar(root, "type", { selector: "#campo", texto: "hola" });
      assert.equal(escrito.code, 0, escrito.msg);
      const trasEscribir = await ejecutar(root, "text", { selector: "#out" });
      assert.equal(trasEscribir.code, 0, trasEscribir.msg);
      assert.match(trasEscribir.msg, /VAL:hola/);

      // 6) clic y su efecto observable.
      const clic = await ejecutar(root, "click", { selector: "#btn" });
      assert.equal(clic.code, 0, clic.msg);
      assert.match((await ejecutar(root, "text", { selector: "#out" })).msg, /CLIC/);

      // 7) espera con objeto ms.
      const espera = await ejecutar(root, "wait", { ms: 30 });
      assert.equal(espera.code, 0, espera.msg);

      // 8) deny por política: la sesión abierta no lo elude.
      permitir(root, { clic: false }, {});
      const denegado = await ejecutar(root, "click", { selector: "#btn" });
      assert.equal(denegado.code, 2, denegado.msg);
      assert.match(denegado.msg, /denegado/);

      // 9) presupuesto duro de la sesión (nada de política lo levanta).
      assert.equal((await ejecutar(root, "cerrar", {})).code, 0);
      assert.equal(listarSesiones().length, 0);
      parchearConfig(root, { sesiones: { maxAcciones: 1 } });
      const corta = await abrirSesion();
      assert.equal(corta.code, 0, corta.msg);
      assert.equal((await ejecutar(root, "text", {})).code, 0);
      const agotada = await ejecutar(root, "text", {});
      assert.equal(agotada.code, 2, agotada.msg);
      assert.match(agotada.msg, /agotada/);
      assert.equal((await ejecutar(root, "cerrar", {})).code, 0);

      // 10) Trazas: ask con id, allow del consumo con origen/contexto y deny.
      const db = openDb(root);
      const filas = db
        .prepare("SELECT tool, decision, origen, contexto, approval_id FROM trace_log ORDER BY id")
        .all() as { tool: string; decision: string; origen: string; contexto: string; approval_id: string }[];
      const aprob = db.prepare("SELECT tool, estado, usada_por FROM aprobaciones").all() as { tool: string; estado: string; usada_por: string }[];
      db.close();

      const navAsk = filas.find((f) => f.tool === "navegar" && f.decision === "ask");
      assert.ok(navAsk, "el ask del broker queda trazado");
      assert.ok(navAsk.approval_id, "el ask deja id aprobable");
      const navAllow = filas.find((f) => f.tool === "navegar" && f.decision === "allow");
      assert.ok(navAllow, "el consumo de la concesión queda trazado");
      assert.equal(navAllow.origen, "web", "la traza registra quién gastó la concesión");
      assert.match(navAllow.contexto, /^sesion /, "el contexto es la sesión");
      assert.ok(filas.some((f) => f.tool === "clic" && f.decision === "deny"), "el deny también deja traza");
      const usada = aprob.find((a) => a.tool === "navegar" && a.estado === "usada");
      assert.ok(usada, "la concesión queda como usada (un solo uso)");
      assert.equal(usada.usada_por, `sesion ${idSesion}`);
    } finally {
      servidor.closeAllConnections?.();
      servidor.close();
    }
  }));
