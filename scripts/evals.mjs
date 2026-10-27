// evals — suite de evaluación del harness con línea base ejecutable (ADR-0003).
// Mide el harness, no un modelo: construcción, contratos de módulos, fail-closed
// del verify y el endpoint web. Cada caso produce un veredicto y una latencia.
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
