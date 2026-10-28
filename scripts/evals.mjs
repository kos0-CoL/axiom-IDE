// evals — suite de evaluación del harness con línea base ejecutable (ADR-0003).
// Mide el harness, no un modelo: construcción, contratos de módulos, fail-closed
// del verify, el endpoint web y — con proveedor LLM configurado — la trayectoria
// de un run (llamadas, tokens y latencia por run). Sin proveedor el grupo
// trayectoria se omite justificado y no cuenta como fallo. Cada caso produce un
// veredicto y una latencia.
//
//   npm run evals                      → ejecuta y compara contra evals/baseline.json
//   npm run evals -- --write-baseline  → (re)escribe la línea base (solo si todo pasa)
//   npm run evals -- --no-build        → no recompila (usa dist actual)
//
// Regresión = un caso que estaba ok en la línea base y ahora falla: eso rompe el
// run (exit 1). La latencia solo avisa (x2 y >200 ms): es ruidosa, la corrección no.
// Un caso omitido (p. ej. sin motor de navegador) se justifica y no cuenta como fallo.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const CLI = join(raiz, "dist", "cli.js");
const BASELINE = join(raiz, "evals", "baseline.json");
const args = process.argv.slice(2);
const escribirBaseline = args.includes("--write-baseline");
const sinBuild = args.includes("--no-build");

function nodo(binarios, opts = {}) {
  const r = spawnSync(binarios[0], binarios.slice(1), {
    cwd: raiz,
    encoding: "utf8",
    timeout: 300000,
    ...opts,
  });
  return {
    code: r.status ?? (r.error ? 1 : 0),
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    error: r.error?.message,
  };
}

function cli(root, cliArgs) {
  return nodo([process.execPath, CLI, "--root", root, ...cliArgs], { timeout: 120000 });
}

// --- SQLite del proyecto (mismo store que usa el harness) ---
const { openDb } = await import(pathToFileURL(join(raiz, "dist", "store.js")).href);

function fila(root, sql, ...params) {
  const db = openDb(root);
  try {
    return db.prepare(sql).get(...params);
  } finally {
    db.close();
  }
}

function evidencias(root, taskId) {
  return taskId
    ? fila(root, "SELECT COUNT(*) c FROM evidences WHERE task_id = ?", taskId).c
    : fila(root, "SELECT COUNT(*) c FROM evidences").c;
}

function estadoTarea(root, taskId) {
  return fila(root, "SELECT estado FROM tasks WHERE id = ?", taskId)?.estado;
}

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function esperarHttp(url, msMax = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* aún no levantó */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function jsonPost(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- Proyecto temporal de evaluación (setup, no se puntúa) ---
function prepararProyecto() {
  const root = mkdtempSync(join(tmpdir(), "axiom-evals-"));
  for (const paso of [
    ["init"],
    ["spec", "demo", "Demo evals"],
    ["plan", "demo"],
    ["tasks", "demo"],
  ]) {
    const r = cli(root, paso);
    if (r.code !== 0) throw new Error(`setup falló (${paso.join(" ")}): ${r.out.slice(0, 300)}`);
  }
  return root;
}

// --- Casos ---
const casos = [
  {
    id: "build",
    grupo: "estatico",
    async ejecutar() {
      if (sinBuild) return { omitido: "omitido por --no-build (usa dist actual)" };
      const r = nodo([process.execPath, join(raiz, "node_modules", "typescript", "bin", "tsc")], { timeout: 300000 });
      return {
        ok: r.code === 0,
        detalle: r.code === 0 ? "tsc OK" : `tsc falló: ${r.out.slice(0, 300)}`,
      };
    },
  },
  {
    id: "boundaries",
    grupo: "estatico",
    async ejecutar() {
      const r = nodo([process.execPath, join(raiz, "scripts", "check-boundaries.mjs")]);
      return { ok: r.code === 0, detalle: r.code === 0 ? "sin violaciones de boundaries" : r.out.slice(0, 300) };
    },
  },
  {
    id: "seeds",
    grupo: "estatico",
    async ejecutar() {
      const r = nodo([process.execPath, join(raiz, "scripts", "check-seeds.mjs")]);
      return { ok: r.code === 0, detalle: r.code === 0 ? "seeds sin drift" : r.out.slice(0, 300) };
    },
  },
  {
    id: "webjs",
    grupo: "estatico",
    async ejecutar() {
      const r = nodo([process.execPath, join(raiz, "scripts", "check-webjs.mjs")]);
      return { ok: r.code === 0, detalle: r.code === 0 ? r.out.trim() : r.out.slice(0, 300) };
    },
  },
  {
    id: "superficie",
    grupo: "estatico",
    async ejecutar(ctx) {
      const r = cli(ctx.root, ["module", "check"]);
      return { ok: r.code === 0, detalle: r.code === 0 ? "todas las superficies declaradas ok" : r.out.slice(0, 300) };
    },
  },
  {
    id: "openapi",
    grupo: "estatico",
    async ejecutar() {
      const r = nodo([process.execPath, CLI, "validate-openapi"]);
      return { ok: r.code === 0, detalle: r.code === 0 ? "spec y router coherentes" : r.out.slice(0, 300) };
    },
  },
  {
    id: "tokens",
    grupo: "estatico",
    async ejecutar() {
      const r = nodo([process.execPath, CLI, "validate-tokens"]);
      return { ok: r.code === 0, detalle: r.code === 0 ? "page sin tokens filtrados" : r.out.slice(0, 300) };
    },
  },
  {
    id: "modulos-contrato",
    grupo: "contratos",
    async ejecutar(ctx) {
      const dir = join(raiz, "dist", "modules");
      let n = 0;
      const fallos = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const entrada = join(dir, e.name, "index.js");
        if (!existsSync(entrada)) continue;
        let mod;
        try {
          mod = await import(pathToFileURL(entrada).href);
        } catch (err) {
          fallos.push(`${e.name}: import (${err.message})`);
          continue;
        }
        if (typeof mod.datosModulo !== "function") continue;
        n++;
        try {
          const datos = mod.datosModulo(ctx.root);
          const s = JSON.stringify(datos);
          if (s === undefined || s.length > 100000) fallos.push(`${e.name}: datosModulo sin JSON acotado`);
          // estadoTexto es convención (lo exige module-builder para módulos
          // generados); si existe, no puede venir vacío. El núcleo no lo llama.
          if (typeof mod.estadoTexto === "function") {
            const est = mod.estadoTexto();
            if (typeof est !== "string" || !est.trim()) fallos.push(`${e.name}: estadoTexto vacío`);
          }
        } catch (err) {
          fallos.push(`${e.name}: ${err.message}`);
        }
      }
      if (n === 0) return { ok: false, detalle: "ningún módulo exporta datosModulo" };
      return { ok: fallos.length === 0, detalle: fallos.length ? fallos.join(" · ") : `${n} módulo(s) con contrato ok` };
      },
    },
    {
      id: "seguridad-detalle",
      grupo: "contratos",
      async ejecutar(ctx) {
        const mod = await import(pathToFileURL(join(raiz, "dist", "modules", "security", "index.js")).href);
        if (typeof mod.detalleModulo !== "function" || typeof mod.guardarDetalleModulo !== "function") {
          return { ok: false, detalle: "security no expone detalle editable" };
        }
        const d = mod.detalleModulo(ctx.root, "politica-global");
        if (!d.ok) return { ok: false, detalle: `detalle politica-global: ${d.error}` };
        const g = mod.guardarDetalleModulo(ctx.root, {
          id: "politica-global",
          cambios: { terminal: "quizás", delega: "no", techo: "3:100000:500" },
        });
        if (g.ok) return { ok: false, detalle: "aceptó terminal inválido (debería rechazar sin escribir)" };
        return { ok: true, detalle: "detalle politica-global ok · rechazo fail-closed de terminal inválido" };
      },
    },
  {
    id: "verify-inexistente",
    grupo: "fail-closed",
    async ejecutar(ctx) {
      const r = cli(ctx.root, ["verify", "evals-no-existe", "pass"]);
      const ok = r.code !== 0 && /no existe/.test(r.out) && evidencias(ctx.root, "evals-no-existe") === 0;
      return { ok, detalle: ok ? "tarea inexistente → error y sin evidencia" : `code=${r.code} ${r.out.slice(0, 200)}` };
    },
  },
  {
    id: "verify-juez-error",
    grupo: "fail-closed",
    async ejecutar(ctx) {
      const r = cli(ctx.root, ["verify", "demo-T1", "error", "--detalle", "evals"]);
      const archivo = join(ctx.root, "specs", "active", "demo", "verification-demo-T1-ERROR.md");
      const ok =
        r.code === 0 &&
        evidencias(ctx.root, "demo-T1") === 0 &&
        existsSync(archivo) &&
        estadoTarea(ctx.root, "demo-T1") === "implementado";
      return {
        ok,
        detalle: ok ? "juez fallido → ERROR.md, sin evidencia, estado intacto" : `code=${r.code} ev=${evidencias(ctx.root, "demo-T1")}`,
      };
    },
  },
  {
    id: "verify-staging",
    grupo: "fail-closed",
    async ejecutar(ctx) {
      const r = cli(ctx.root, ["verify", "demo-T1", "pass", "--archivos", "../../fuera.md"]);
      const ok = r.code === 2 && evidencias(ctx.root, "demo-T1") === 0;
      return { ok, detalle: ok ? "archivo fuera de allowlist → exit 2 y sin firma" : `code=${r.code} ${r.out.slice(0, 200)}` };
    },
  },
  {
    id: "verify-browser-off",
    grupo: "fail-closed",
    async ejecutar(ctx) {
      cli(ctx.root, ["module", "off", "browser"]);
      let r;
      try {
        r = cli(ctx.root, ["verify", "demo-T1", "pass", "--url", "https://example.com"]);
      } finally {
        cli(ctx.root, ["module", "on", "browser"]);
      }
      const ok = r.code === 2 && /deshabilitado/.test(r.out) && evidencias(ctx.root, "demo-T1") === 0;
      return { ok, detalle: ok ? "módulo apagado → 409/exit 2 antes de capturar" : `code=${r.code} ${r.out.slice(0, 200)}` };
    },
  },
  {
    id: "verify-pagina-error",
    grupo: "fail-closed",
    async ejecutar(ctx) {
      const browser = await import(pathToFileURL(join(raiz, "dist", "modules", "browser", "index.js")).href);
      if (!browser.detectarMotor(ctx.root)) {
        return { omitido: "sin motor de navegador (instala Chromium o la caché de Playwright para activarlo)" };
      }
      let r = cli(ctx.root, ["verify", "demo-T2", "pass", "--url", "http://no-existe-axiom.invalid"]);
      if (r.code !== 0 && /No usable sandbox/.test(r.out)) {
        // Este host bloquea los user namespaces de Chromium (AppArmor): se opta
        // por noSandbox de forma explícita y se reintenta una sola vez.
        writeFileSync(join(ctx.root, "browser.config.json"), JSON.stringify({ noSandbox: true }) + "\n");
        r = cli(ctx.root, ["verify", "demo-T2", "pass", "--url", "http://no-existe-axiom.invalid"]);
      }
      const ev = fila(ctx.root, "SELECT exit, verdict FROM evidences WHERE task_id = 'demo-T2' ORDER BY rowid DESC LIMIT 1");
      const md = join(ctx.root, "specs", "active", "demo", "verification-demo-T2.md");
      const mdOk = existsSync(md) && readFileSync(md, "utf8").includes("ajustado de pass a fail");
      const ok =
        r.code === 0 &&
        /PÁGINA DE ERROR/.test(r.out) &&
        ev?.verdict === "fail" &&
        ev?.exit === 1 &&
        estadoTarea(ctx.root, "demo-T2") === "bloqueado" &&
        mdOk;
      return {
        ok,
        detalle: ok
          ? "página de error → pass ajustado a fail con evidencia"
          : `code=${r.code} ev=${JSON.stringify(ev)} md=${mdOk} ${r.out.slice(0, 160)}`,
      };
    },
  },
  {
    id: "verify-timeout",
    grupo: "fail-closed",
    async ejecutar(ctx) {
      const browser = await import(pathToFileURL(join(raiz, "dist", "modules", "browser", "index.js")).href);
      if (!browser.detectarMotor(ctx.root)) {
        return { omitido: "sin motor de navegador (instala Chromium o la caché de Playwright para activarlo)" };
      }
      // URL que cuelga: acepta la conexión TCP y nunca responde, para que el
      // motor supere su límite (timeoutMs corto) y dispare el timeout de red.
      const servidor = net.createServer(() => { /* sin respuesta */ });
      await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
      const puerto = servidor.address().port;
      const cfgPath = join(ctx.root, "browser.config.json");
      let cfgPrev = "";
      try { cfgPrev = readFileSync(cfgPath, "utf8"); } catch { /* sin config previa */ }
      let cfg = {};
      try { cfg = JSON.parse(cfgPrev || "{}"); } catch { cfg = {}; }
      cfg.timeoutMs = 2000;
      writeFileSync(cfgPath, JSON.stringify(cfg) + "\n");
      try {
        let r = cli(ctx.root, ["verify", "demo-T2", "pass", "--url", `http://127.0.0.1:${puerto}`]);
        if (r.code !== 0 && /No usable sandbox/.test(r.out)) {
          cfg.noSandbox = true;
          writeFileSync(cfgPath, JSON.stringify(cfg) + "\n");
          r = cli(ctx.root, ["verify", "demo-T2", "pass", "--url", `http://127.0.0.1:${puerto}`]);
        }
        const ev = fila(ctx.root, "SELECT exit, verdict FROM evidences WHERE task_id = 'demo-T2' ORDER BY rowid DESC LIMIT 1");
        const md = join(ctx.root, "specs", "active", "demo", "verification-demo-T2.md");
        const mdTxt = existsSync(md) ? readFileSync(md, "utf8") : "";
        const ok =
          r.code === 0 &&
          /TIMEOUT DE RED/.test(r.out) &&
          !/captura fallida/i.test(r.out) &&
          ev?.verdict === "fail" &&
          ev?.exit === 1 &&
          estadoTarea(ctx.root, "demo-T2") === "bloqueado" &&
          mdTxt.includes("timeout de red") &&
          mdTxt.includes("ajustado de pass a fail");
        return {
          ok,
          detalle: ok
            ? "timeout de red → parte de timeout + pass ajustado a fail"
            : `code=${r.code} ev=${JSON.stringify(ev)} md=${mdTxt.includes("timeout de red")} ${r.out.slice(0, 160)}`,
        };
      } finally {
        servidor.close();
        if (cfgPrev) writeFileSync(cfgPath, cfgPrev);
        else { try { rmSync(cfgPath); } catch { /* ya no estaba */ } }
      }
    },
  },
  {
    id: "api-verify",
    grupo: "e2e",
    async ejecutar(ctx) {
      const puerto = await puertoLibre();
      const hijo = spawn(process.execPath, [CLI, "--root", ctx.root, "serve", String(puerto)], {
        cwd: raiz,
        stdio: "ignore",
      });
      try {
        const base = `http://127.0.0.1:${puerto}`;
        if (!(await esperarHttp(`${base}/`))) return { ok: false, detalle: "el servidor no levantó" };
        const errores = [];
        const pagina = await fetch(`${base}/`);
        if (pagina.status !== 200) errores.push(`GET / → ${pagina.status}`);
        const sinTask = await jsonPost(`${base}/api/verify`, { verdict: "pass" });
        if (sinTask.status !== 400) errores.push(`sin taskId → ${sinTask.status} (esperado 400)`);
        const pass = await jsonPost(`${base}/api/verify`, { taskId: "demo-T1", verdict: "fail" });
        const passBody = await pass.json().catch(() => ({}));
        if (pass.status !== 200 || passBody.ok !== true) errores.push(`fail registrado → ${pass.status}`);
        return {
          ok: errores.length === 0,
          detalle: errores.length ? errores.join(" · ") : "GET / 200 · sin taskId 400 · veredicto 200",
        };
      } finally {
        hijo.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 300));
        if (!hijo.killed) hijo.kill("SIGKILL");
      }
    },
  },
  {
    id: "trazas-toolcall",
    grupo: "e2e",
    async ejecutar(ctx) {
      // Política sembrada por init: `terminal` deny (global=false), `status`
      // allow (riesgo bajo). Ambas tool calls deben dejar traza con sha del IO
      // completo, y `status --trace` debe consultarla (global y por tarea).
      const allow = cli(ctx.root, ["check", "status"]);
      const deny = cli(ctx.root, ["check", "terminal"]);
      const db = openDb(ctx.root);
      const filas = db.prepare("SELECT tool, decision, origen, sha_io FROM trace_log ORDER BY id DESC LIMIT 10").all();
      db.close();
      const tAllow = filas.find((f) => f.tool === "status" && f.decision === "allow");
      const tDeny = filas.find((f) => f.tool === "terminal" && f.decision === "deny");
      const global = cli(ctx.root, ["status", "--trace"]);
      const tarea = cli(ctx.root, ["status", "--trace", "demo-T1"]);
      const ok =
        allow.code === 0 &&
        deny.code === 2 &&
        !!tAllow &&
        !!tDeny &&
        tAllow.origen === "cli" &&
        /^[0-9a-f]{64}$/.test(tAllow.sha_io ?? "") &&
        /trazas:/.test(global.out) &&
        /status/.test(global.out) &&
        /terminal/.test(global.out) &&
        /trazas=\d+/.test(tarea.out);
      return {
        ok,
        detalle: ok
          ? "check deja traza (allow+deny) y status --trace la consulta"
          : `code=${allow.code}/${deny.code} filas=${filas.length} global=${global.out.slice(0, 120)} tarea=${tarea.out.slice(0, 120)}`,
      };
    },
  },
  {
    // ADR-0004: el panel consume el endpoint real, no la CLI. Servidor `axiom serve`
    // levantado de verdad: GET /api/trazas devuelve las filas con `linea` de la CLI,
    // filtra por contexto (positivo y negativo), sanea `limite` y la página anuncia
    // la vista Trazas. Diferente de trazas-toolcall, que consulta la base directo.
    id: "api-trazas",
    grupo: "e2e",
    async ejecutar(ctx) {
      // Trazas reales por la CLI: allow + deny, y un handoff que lleva contexto
      // de tarea (contexto = tarea) para poder aislarlo con el filtro.
      cli(ctx.root, ["check", "status"]);
      cli(ctx.root, ["check", "terminal"]);
      cli(ctx.root, ["agents", "handoff", "orquestador", "implementador", "demo-T1", "filtro", "trazas"]);
      const puerto = await puertoLibre();
      const hijo = spawn(process.execPath, [CLI, "--root", ctx.root, "serve", String(puerto)], {
        cwd: raiz,
        stdio: "ignore",
      });
      try {
        const base = `http://127.0.0.1:${puerto}`;
        if (!(await esperarHttp(`${base}/`))) return { ok: false, detalle: "el servidor no levantó" };
        const errores = [];
        const html = await (await fetch(`${base}/`)).text();
        for (const marca of ["api/trazas", "trazasload", "v-trz"]) {
          if (!html.includes(marca)) errores.push(`HTML sin ${marca}`);
        }
        const r = await fetch(`${base}/api/trazas`);
        if (r.status !== 200) errores.push(`GET /api/trazas → ${r.status}`);
        const d = await r.json().catch(() => ({}));
        const t = d.trazas ?? [];
        if (d.ok !== true) errores.push(`ok=${d.ok}`);
        const allow = t.find((z) => z.tool === "status" && z.decision === "allow");
        const deny = t.find((z) => z.tool === "terminal" && z.decision === "deny");
        if (!allow) errores.push("sin fila status/allow");
        if (!deny) errores.push("sin fila terminal/deny");
        // `linea` lo formatea lineaTraza (misma función que la CLI) y el sha es del IO completo.
        if (allow && !String(allow.linea ?? "").includes("status")) errores.push("fila sin linea de la CLI");
        if (allow && !/^[0-9a-f]{64}$/.test(allow.sha_io ?? "")) errores.push("sha_io no es sha256");
        // Filtro por contexto: positivo (la del handoff) y negativo.
        const pos = await (await fetch(`${base}/api/trazas?contexto=${encodeURIComponent("demo-T1")}`)).json();
        const posT = pos.trazas ?? [];
        if (posT.length < 1) errores.push("contexto demo-T1 no aísla ninguna fila");
        if (posT.some((z) => !String(z.contexto ?? "").includes("demo-T1"))) errores.push("filtro dejó filas ajenas");
        const neg = await (await fetch(`${base}/api/trazas?contexto=zzz-sin-coincidencias`)).json();
        if ((neg.trazas ?? []).length !== 0) errores.push("filtro sin coincidencias devolvió filas");
        // Saneo de límites: lo no numérico → 50, fuera de rango → tope 200 (nunca 500).
        const l1 = await (await fetch(`${base}/api/trazas?limite=abc`)).json();
        const l2 = await (await fetch(`${base}/api/trazas?limite=9999`)).json();
        if (l1.limite !== 50) errores.push(`limite=abc → ${l1.limite} (esperado 50)`);
        if (l2.limite !== 200) errores.push(`limite=9999 → ${l2.limite} (esperado 200)`);
        return {
          ok: errores.length === 0,
          detalle: errores.length
            ? errores.join(" · ")
            : `GET 200 · ${t.length} filas con linea · contexto aísla · límites saneados · vista en el HTML`,
        };
      } finally {
        hijo.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 300));
        if (!hijo.killed) hijo.kill("SIGKILL");
      }
    },
  },
  {
    // ADR-0006: el agente conduce un navegador con la misma disciplina que el
    // resto de herramientas — aprobación humana de un solo uso, traza con
    // origen, límites de sesión — y la web expone la misma fachada (200/400/409).
    // Sin motor el caso se OMITE justificado: nunca asume que pasó.
    id: "browser-tool",
    grupo: "e2e",
    async ejecutar(ctx) {
      const browser = await import(pathToFileURL(join(raiz, "dist", "modules", "browser", "index.js")).href);
      if (!browser.detectarMotor(ctx.root)) {
        return { omitido: "sin motor de navegador (instala Chromium o la caché de Playwright para activarlo)" };
      }
      const modulos = await import(pathToFileURL(join(raiz, "dist", "modulos.js")).href);
      const moduloPrevia = modulos.moduloActivo(ctx.root, "browser");
      const polPath = join(ctx.root, "policies.global.json");
      let polPrev = "";
      try { polPrev = readFileSync(polPath, "utf8"); } catch { /* init aún no lo escribió */ }
      const cfgPath = join(ctx.root, "browser.config.json");
      let cfgPrev = "";
      try { cfgPrev = readFileSync(cfgPath, "utf8"); } catch { /* sin config previa */ }

      // `abrir` es openWorld → riesgo alto: pide aprobación humana por uso.
      let pol = {};
      try { pol = polPrev ? JSON.parse(polPrev) : {}; } catch { pol = {}; }
      pol.tools = { ...(pol.tools ?? {}), "browser.abrir": true };
      writeFileSync(polPath, JSON.stringify(pol, null, 2) + "\n");
      cli(ctx.root, ["module", "on", "browser"]);

      const marcador = "MARCADOR EVALS BROWSER";
      // La página objetivo vive en UN PROCESO PROPIO: la consola CLI se ejecuta
      // con spawnSync (bloquea este bucle de eventos), así que un servidor aquí
      // dentro no respondería mientras la CLI corre y la navegación colgaría.
      const puertoPagina = await puertoLibre();
      const pagina = spawn(
        process.execPath,
        ["-e", "require('node:http').createServer((q,s)=>{s.writeHead(200,{'content-type':'text/html; charset=utf-8'});s.end('<!doctype html><html lang=es><body><h1>'+process.env.MARCADOR+'</h1></body></html>')}).listen(Number(process.env.PUERTO),'127.0.0.1')"],
        { cwd: raiz, stdio: "ignore", env: { ...process.env, MARCADOR: marcador, PUERTO: String(puertoPagina) } },
      );
      const url = `http://127.0.0.1:${puertoPagina}/`;
      const errores = [];
      // Dos hosts, una sola fachada: el servidor web (larga duración) conduce
      // la sesión entre peticiones y la CLI conduce la suya en su propio
      // proceso por stdin — mismo broker, mismos límites, mismo origen en traza.
      let cfg = {};
      try { cfg = cfgPrev ? JSON.parse(cfgPrev) : {}; } catch { cfg = {}; }
      const optarNoSandbox = () => { cfg = { ...cfg, noSandbox: true }; writeFileSync(cfgPath, JSON.stringify(cfg) + "\n"); };
      const aprobar = (id) => cli(ctx.root, ["approve", id]).code === 0;
      const idAprobable = (texto) => (String(texto ?? "").match(/necesita aprobación \(([^)]+)\)/) ?? [])[1];
      const puerto = await puertoLibre();
      const hijo = spawn(process.execPath, [CLI, "--root", ctx.root, "serve", String(puerto)], { cwd: raiz, stdio: "ignore" });
      let fase = "levantar servidor";
      try {
        const base = `http://127.0.0.1:${puerto}`;
        if (!(await esperarHttp(`${base}/`))) return { ok: false, detalle: "el servidor no levantó" };
        if (!(await esperarHttp(url))) return { ok: false, detalle: "la página objetivo no levantó" };
        const accion = async (cuerpo) => {
          const r = await fetch(`${base}/api/browser/accion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
          return { status: r.status, ...(await r.json().catch(() => ({}))) };
        };
        const listar = async () => {
          const r = await fetch(`${base}/api/browser/sesiones`);
          return { status: r.status, ...(await r.json().catch(() => ({}))) };
        };

        // 1) Petición mal formada → 400 (lo demás es fail closed 409).
        fase = "web: petición mal formada";
        const mala = await accion({ accion: "volar" });
        if (mala.status !== 400) errores.push(`acción desconocida → ${mala.status} (esperado 400)`);

        // 2) Flujo web completo: pedir → aprobar → consumir UN uso → leer/cerrar.
        fase = "web: abrir";
        let sesion = "";
        for (let i = 0; i < 6 && !sesion; i++) {
          const r = await accion({ accion: "abrir", args: { url } });
          if (r.status === 200 && r.ok) { sesion = String(r.datos?.sesion ?? ""); break; }
          const id = idAprobable(r.msg);
          if (id) { if (!aprobar(id)) return { ok: false, detalle: `approve ${id} falló: ${r.msg}` }; continue; }
          // Este host puede bloquear los user namespaces de Chromium (AppArmor).
          if (/pestaña|sandbox/i.test(String(r.msg ?? "")) && !cfg.noSandbox) { optarNoSandbox(); continue; }
          errores.push(`abrir web → ${r.status} ${String(r.msg ?? "").slice(0, 160)}`);
          break;
        }
        if (!sesion) errores.push("la sesión no abrió por la web");
        else {
          fase = "web: text";
          const texto = await accion({ accion: "text", args: {} });
          if (texto.status !== 200 || !String(texto.msg ?? "").includes(marcador)) errores.push(`text web → ${texto.status} ${String(texto.msg ?? "").slice(0, 160)}`);
          fase = "web: listar sesiones";
          const lista = await listar();
          if (lista.status !== 200 || (lista.sesiones ?? []).length !== 1) errores.push(`GET sesiones → ${lista.status} n=${(lista.sesiones ?? []).length}`);
          fase = "web: cerrar";
          const cerrada = await accion({ accion: "cerrar", args: { sesion } });
          if (cerrada.status !== 200) errores.push(`cerrar web → ${cerrada.status} ${String(cerrada.msg ?? "").slice(0, 120)}`);
          fase = "web: listar tras cerrar";
          const vacias = await listar();
          if ((vacias.sesiones ?? []).length !== 0) errores.push("tras cerrar siguen apareciendo sesiones");
        }

        // 3) Traza: el ask deja id aprobable y el consumo deja el ORIGEN de
        //    quien gastó la concesión (la web) con la sesión como contexto.
        fase = "trazas";
        const ask = fila(ctx.root, "SELECT COUNT(*) c FROM trace_log WHERE tool='browser.abrir' AND decision='ask'");
        const origenWeb = fila(ctx.root, "SELECT COUNT(*) c FROM trace_log WHERE tool='browser.abrir' AND decision='allow' AND origen='web'");
        if (!ask?.c) errores.push("sin traza ask de browser.abrir");
        if (!origenWeb?.c) errores.push("el consumo por la web no deja origen=web en la traza");

        // 4) Módulo apagado → 409 en la web y exit 2 en la CLI (fail closed).
        //    Se hace YA (con todas las llamadas HTTP seguidas): la consola CLI
        //    de abajo tarda y no vuelve a tocar la red.
        fase = "módulo apagado";
        cli(ctx.root, ["module", "off", "browser"]);
        const off = await listar();
        if (off.status !== 409) errores.push(`módulo apagado web → ${off.status} (esperado 409)`);
        const cliOff = cli(ctx.root, ["browser", "text"]);
        if (cliOff.code !== 2 || !/deshabilitado/.test(cliOff.out)) errores.push(`CLI con módulo apagado → exit ${cliOff.code}`);
        cli(ctx.root, ["module", "on", "browser"]); // la consola lo necesita

        // 5) Consola CLI: `abrir` abre y conduce la sesión desde stdin en SU
        //    propio proceso (la sesión no vive en disco, vive en esta memoria).
        fase = "consola CLI";
        let consola = null;
        for (let i = 0; i < 6 && !consola; i++) {
          const r = nodo([process.execPath, CLI, "--root", ctx.root, "browser", "abrir", url], { input: "text\nsesiones\ncerrar\n", timeout: 120000 });
          if (r.code === 0) { consola = r; break; }
          const id = idAprobable(r.out);
          if (id) { if (!aprobar(id)) return { ok: false, detalle: `approve ${id} falló (consola)` }; continue; }
          if (/pestaña|sandbox/i.test(r.out) && !cfg.noSandbox) { optarNoSandbox(); continue; }
          errores.push(`consola CLI → code=${r.code} ${r.out.slice(0, 160)}`);
          break;
        }
        if (!consola) errores.push("la consola de sesión de la CLI no corrió");
        else {
          if (!consola.out.includes(marcador)) errores.push(`consola CLI: text no devolvió la página — salida: ${consola.out.slice(0, 300)}`);
          if (!/acciones/.test(consola.out)) errores.push("consola CLI: sesiones no listó la sesión viva");
          if (!/cerrada/.test(consola.out)) errores.push("consola CLI: la sesión no se cerró");
          const origenCli = fila(ctx.root, "SELECT COUNT(*) c FROM trace_log WHERE tool='browser.abrir' AND decision='allow' AND origen='cli'");
          if (!origenCli?.c) errores.push("el consumo por la CLI no deja origen=cli en la traza");
        }
        const usadas = fila(ctx.root, "SELECT COUNT(*) c FROM aprobaciones WHERE tool='browser.abrir' AND estado='usada'");
        if (!usadas?.c) errores.push("ninguna concesión quedó como usada (un solo uso)");
      } catch (e) {
        errores.push(`excepción en «${fase}»: ${e.message}${e.cause ? ` · causa: ${e.cause.message ?? e.cause}` : ""} · servidor exit=${hijo.exitCode}`);
      } finally {
        hijo.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 300));
        if (!hijo.killed) hijo.kill("SIGKILL");
        // Restaura el interruptor ANTES de cerrar (la CLI falla cerrado con el
        // módulo apagado) y luego devuelve el proyecto a como estaba.
        cli(ctx.root, ["module", "on", "browser"]);
        cli(ctx.root, ["browser", "cerrar"]);
        cli(ctx.root, ["module", moduloPrevia ? "on" : "off", "browser"]);
        if (polPrev) writeFileSync(polPath, polPrev);
        else { try { rmSync(polPath); } catch { /* no existía */ } }
        if (cfgPrev) writeFileSync(cfgPath, cfgPrev);
        else { try { rmSync(cfgPath); } catch { /* no existía */ } }
        pagina.kill("SIGTERM");
      }
      return {
        ok: errores.length === 0,
        detalle: errores.length
          ? errores.join(" · ")
          : "web y consola CLI con aprobación única · texto leído · trazas con origen web+cli · módulo apagado 409/exit 2",
      };
    },
  },
  {
    // ADR-0003 (grupo añadido): trayectoria REAL de un run con `--agente` —
    // llamadas al LLM, tokens y latencia por run. Requiere proveedor configurado
    // en adapters.config.json del repo; sin él el caso se omite justificado.
    id: "trayectoria-run",
    grupo: "trayectoria",
    async ejecutar(ctx) {
      const cfgRepo = join(raiz, "adapters.config.json");
      let cfg;
      try {
        cfg = JSON.parse(readFileSync(cfgRepo, "utf8"));
      } catch (e) {
        const motivo = e?.code === "ENOENT" ? "ausente" : e.message;
        return { omitido: `sin proveedor LLM configurado (adapters.config.json ${motivo})` };
      }
      if (!cfg.proveedor || cfg.proveedor === "off") {
        return { omitido: "sin proveedor LLM configurado (adapters.config.json con proveedor off)" };
      }
      // El proyecto temporal hereda la config del repo; la key llega por env
      // si tiene formato válido, y si no — o si no hay env — por el archivo de
      // secrets del operador (gitignored, 0600), igual que la config. Sin key
      // en ninguna de las dos fuentes el run sigue fallando fail-closed.
      writeFileSync(join(ctx.root, "adapters.config.json"), JSON.stringify(cfg, null, 2) + "\n");
      try {
        const secs = readFileSync(join(raiz, ".axiom-secrets.json"), "utf8");
        JSON.parse(secs); // solo se copia si es JSON legible
        writeFileSync(join(ctx.root, ".axiom-secrets.json"), secs, { mode: 0o600 });
      } catch { /* sin secrets en el repo: una env válida basta */ }
      // Habilitación del operador para correr con agente: el harness arranca
      // fail-closed (sin permiso global+proyecto el broker bloquea `delega` y
      // `editar`, los tres usos del paso trabajo+juez) y aquí se replica esa
      // habilitación en el proyecto temporal, preservando lo que init ya sembró
      // (terminal: false, techo, presupuesto…).
      for (const nombre of ["policies.global.json", "project.json"]) {
        const p = join(ctx.root, nombre);
        let actual = {};
        try {
          actual = JSON.parse(readFileSync(p, "utf8"));
        } catch { /* init aún no lo escribió */ }
        actual.tools = { ...(actual.tools ?? {}), delega: true, editar: true };
        writeFileSync(p, JSON.stringify(actual, null, 2) + "\n");
      }
      // El grafo sembrado declara `editar=ask` (aprobación humana por uso). Para
      // medir la trayectoria sin interacción, el operador lo eleva a allow con el
      // propio comando de agentes (el loader cae al seed si no hay archivo y
      // `agents define` crea agents.config.json al guardar).
      const agentsCfg = await import(pathToFileURL(join(raiz, "dist", "modules", "agents", "config.js")).href);
      const grafo = agentsCfg.loadAgents(ctx.root);
      if (!grafo.ok) return { ok: false, detalle: `agents.config: ${grafo.error}` };
      for (const a of grafo.config.agentes) {
        if ((a.herramientas ?? []).some((h) => h.tool === "editar")) {
          cli(ctx.root, ["agents", "define", a.id, "herramienta", "editar=allow"]);
        }
      }
      // Spec propio con tareas pendientes: el run trabaja y juzga de verdad
      // (la trayectoria mide el run completo, no una estimación seca).
      for (const paso of [
        ["spec", "trayect", "Trayectoria"],
        ["plan", "trayect"],
        ["tasks", "trayect"],
      ]) {
        const s = cli(ctx.root, paso);
        if (s.code !== 0) return { ok: false, detalle: `setup (${paso[0]}) falló: ${s.out.slice(0, 200)}` };
      }
      const consumo = () =>
        fila(ctx.root, "SELECT COALESCE(tokens,0) t, COALESCE(calls,0) c FROM consumo WHERE unit='global'") ?? { t: 0, c: 0 };
      const antes = consumo();
      const t0 = Date.now();
      // Timeout propio: un run con proveedor remoto puede tardar más que el
      // default de 120 s de los demás casos (varios spawns trabajo+juez).
      const r = nodo([process.execPath, CLI, "--root", ctx.root, "run", "trayect", "--agente", "--rondas", "1"], {
        timeout: 600000,
      });
      const latencia = Date.now() - t0;
      const d = consumo();
      const llamadas = d.c - antes.c;
      const tokens = d.t - antes.t;
      const fuente = fila(ctx.root, "SELECT fuente FROM uso_log ORDER BY id DESC LIMIT 1")?.fuente ?? "";
      const detalle =
        `llamadas=${llamadas} tokens=${tokens}${fuente ? `(${fuente})` : ""} latencia=${latencia} ms · run exit=${r.code}`;
      // La run puede terminar OK (0) o PARCIAL (1, quedan tareas sin evidencia
      // del juez); lo que no puede es no dejar trayectoria: sin llamadas no hay
      // métrica que comparar contra la línea base.
      const ok = r.code >= 0 && r.code <= 1 && llamadas >= 1 && tokens > 0 && latencia > 0;
      return { ok, detalle: ok ? detalle : `${detalle} — ${r.out.slice(0, 220)}` };
    },
  },
];

// --- Runner ---
async function main() {
  const t0 = Date.now();
  let root;
  try {
    root = prepararProyecto();
  } catch (e) {
    console.error(`evals: no se pudo preparar el proyecto temporal — ${e.message}`);
    process.exit(1);
  }

  console.log(`evals Axiom — ${new Date().toISOString()}`);
  console.log(`proyecto temporal: ${root}\n`);

  const resultados = [];
  for (const c of casos) {
    const t = Date.now();
    let res;
    try {
      res = await c.ejecutar({ root });
    } catch (err) {
      res = { ok: false, detalle: `excepción: ${err.message}` };
    }
    const ms = Date.now() - t;
    const fila = { id: c.id, grupo: c.grupo, ms, ...res };
    resultados.push(fila);
    const marca = res.omitido ? "·" : res.ok ? "✔" : "✖";
    const detalle = res.omitido ?? res.detalle ?? "";
    console.log(`${marca} [${c.grupo.padEnd(10)}] ${c.id.padEnd(22)} ${String(ms).padStart(6)} ms  ${detalle}`);
  }

  rmSync(root, { recursive: true, force: true });

  const fallidos = resultados.filter((r) => !r.omitido && !r.ok);
  const omitidos = resultados.filter((r) => r.omitido);
  const total = resultados.length;

  // --- Línea base ---
  let base = null;
  if (existsSync(BASELINE)) {
    try {
      base = JSON.parse(readFileSync(BASELINE, "utf8"));
    } catch {
      console.error(`\naviso: ${BASELINE} ilegible; se ignora la comparación`);
    }
  }

  let regresiones = 0;
  let lentos = 0;
  let mejoras = 0;
  if (base) {
    console.log(`\nlínea base: evals/baseline.json (creada ${base.creado}, axiom ${base.axiom}, ${Object.keys(base.casos ?? {}).length} casos)`);
    for (const r of resultados) {
      if (r.omitido) continue;
      const b = base.casos?.[r.id];
      if (!b) {
        console.log(`  + ${r.id}: caso nuevo (sin línea base)`);
        continue;
      }
      if (b.ok && !r.ok) {
        regresiones++;
        console.log(`  ✖ REGRESIÓN ${r.id}: estaba ok, ahora falla`);
      } else if (!b.ok && r.ok) {
        mejoras++;
        console.log(`  ✔ mejora ${r.id}: estaba fallando, ahora ok`);
      } else if (b.ok === r.ok && typeof b.ms === "number" && r.ms > b.ms * 2 && r.ms - b.ms > 200) {
        lentos++;
        console.log(`  △ latencia ${r.id}: ${b.ms} → ${r.ms} ms (x2 y >200 ms; solo aviso)`);
      }
    }
    const nuevos = resultados.filter((r) => !r.omitido && !base.casos?.[r.id]).length;
    console.log(`comparación: ${regresiones} regresión(es) · ${mejoras} mejora(s) · ${lentos} aviso(s) de latencia · ${nuevos} caso(s) nuevo(s)`);
  } else {
    console.log("\nsin línea base: ejecuta `npm run evals -- --write-baseline` para crear evals/baseline.json");
  }

  if (escribirBaseline) {
    if (fallidos.length > 0) {
      console.error(`\nno se escribió la línea base: ${fallidos.length} caso(s) fallando (una línea base roja normaliza el fallo)`);
    } else {
      const entrada = {
        creado: new Date().toISOString(),
        axiom: JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).version,
        casos: Object.fromEntries(resultados.filter((r) => !r.omitido).map((r) => [r.id, { ok: r.ok, ms: r.ms }])),
        resumen: { total, ok: total - fallidos.length, omitidos: omitidos.length },
      };
      mkdirSync(dirname(BASELINE), { recursive: true });
      writeFileSync(BASELINE, JSON.stringify(entrada, null, 2) + "\n");
      console.log(`\nlínea base escrita: evals/baseline.json (${Object.keys(entrada.casos).length} casos)`);
    }
  }

  console.log(
    `\nRESULTADO ${fallidos.length === 0 ? "OK" : "FALLA"}: ${total - fallidos.length}/${total} casos` +
      (omitidos.length ? ` (${omitidos.length} omitido(s): ${omitidos.map((o) => o.id).join(", ")})` : "") +
      ` · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  process.exit(fallidos.length > 0 || regresiones > 0 ? 1 : 0);
}

await main();
