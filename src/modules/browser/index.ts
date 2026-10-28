// Módulo browser — fachada delgada sobre un motor de navegador headless.
// Motor: browser.config.json (executablePath) > caché de Playwright
// (~/.cache/ms-playwright o PLAYWRIGHT_BROWSERS_PATH) > binarios del sistema.
// Captura: screenshot PNG o DOM renderizado como evidencia en .axiom/browser/.
// Sin dependencias npm nuevas: binario + child_process. Fail soft en detección,
// fail closed en ejecución (sin motor no captura, lo dice y no inventa).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { LlamadaTrazable } from "../../broker.js";
import { listarSesiones } from "./sesion.js";

export const NOMBRE = "browser";

export interface MotorBrowser {
  nombre: string;
  ruta: string;
  origen: string;
}

export interface CapturaBrowser {
  id: string;
  modo: "png" | "dom";
  archivo: string;
  url: string;
  bytes: number;
  fecha: string;
}

export interface ResultadoCaptura {
  ok: boolean;
  ruta?: string;
  bytes?: number;
  motor?: string;
  error?: string;
  // Si el navegador mostró su propia página de error (DNS, conexión, TLS…),
  // el código detectado. Captura "exitosa" de una página de error NO es
  // evidencia de que la URL cargó: verify lo usa para ajustar el veredicto.
  errorPagina?: string;
  // Timeout de red: el motor superó timeoutMs sin terminar (URL que cuelga
  // sin responder). Hay artefacto (se escribe el parte de timeout), pero la
  // carga tampoco es evidencia: verify lo trata como pass→fail, no como
  // «captura fallida».
  timeoutMs?: number;
}

interface ConfigBrowser {
  executablePath?: string;
  timeoutMs?: number;
  noSandbox?: boolean;
}

const TIMEOUT_DEFAULT = 20_000;
const CARPETA = [".axiom", "browser"] as const;

export function leerConfig(root: string): ConfigBrowser {
  try {
    const j = JSON.parse(readFileSync(join(root, "browser.config.json"), "utf8")) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const c = j as Record<string, unknown>;
    const out: ConfigBrowser = {};
    if (typeof c.executablePath === "string" && c.executablePath.trim()) out.executablePath = c.executablePath.trim();
    if (typeof c.timeoutMs === "number" && Number.isInteger(c.timeoutMs) && c.timeoutMs >= 1000 && c.timeoutMs <= 120000) out.timeoutMs = c.timeoutMs;
    if (typeof c.noSandbox === "boolean") out.noSandbox = c.noSandbox;
    return out;
  } catch {
    return {};
  }
}

// Binarios conocidos dentro de una instalación de Chromium/Chrome.
const RUTAS_RELATIVAS_CHROMIUM = [
  join("chrome-linux", "chrome"),
  join("chrome-linux", "headless_shell"),
  join("chrome-headless-shell-linux64", "chrome-headless-shell"),
  join("chrome-linux", "chrome.exe"),
];

function primeraRutaExistente(base: string, relativas: string[]): string | undefined {
  for (const r of relativas) {
    const p = join(base, r);
    try {
      if (existsSync(p)) return p;
    } catch {
      /* siguiente */
    }
  }
  return undefined;
}

// Caché de Playwright: dirs chromium-* (más reciente primero) y headless shells.
function candidatosPlaywright(): { nombre: string; ruta: string }[] {
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
      ? process.env.PLAYWRIGHT_BROWSERS_PATH
      : undefined,
    join(homedir(), ".cache", "ms-playwright"),
  ].filter((b): b is string => Boolean(b));
  const out: { nombre: string; ruta: string }[] = [];
  for (const base of bases) {
    try {
      if (!existsSync(base)) continue;
      const dirs = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^chromium(_headless_shell)?-\d+$/.test(d.name))
        .map((d) => d.name)
        .sort()
        .reverse(); // numérico: el sufijo -NNNN crece con la versión
      for (const d of dirs) {
        const ruta = primeraRutaExistente(join(base, d), RUTAS_RELATIVAS_CHROMIUM);
        if (ruta) out.push({ nombre: `playwright:${d}`, ruta });
      }
    } catch {
      /* mejor esfuerzo */
    }
  }
  return out;
}

const BINARIOS_SISTEMA = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function detectarMotor(root: string): MotorBrowser | undefined {
  const cfg = leerConfig(root);
  if (cfg.executablePath) {
    try {
      if (existsSync(cfg.executablePath)) return { nombre: "config", ruta: cfg.executablePath, origen: "browser.config.json" };
    } catch {
      /* sigue con auto-detección */
    }
  }
  const pw = candidatosPlaywright();
  if (pw[0]) return { nombre: pw[0].nombre, ruta: pw[0].ruta, origen: "caché de Playwright" };
  for (const p of BINARIOS_SISTEMA) {
    try {
      if (existsSync(p)) return { nombre: "sistema", ruta: p, origen: "binario del sistema" };
    } catch {
      /* siguiente */
    }
  }
  return undefined;
}

// Paquetes npm de navegador instalados en el proyecto (solo informativo).
function paquetesInstalados(root: string): string[] {
  const conocidos = ["playwright", "playwright-core", "puppeteer", "puppeteer-core"];
  return conocidos.filter((p) => {
    try {
      return existsSync(join(root, "node_modules", p));
    } catch {
      return false;
    }
  });
}

// Página de error del navegador: headless Chrome vuelca un cascarón vacío
// (`<html><head></head><body></body></html>`) cuando la carga falla (chrome-error://
// no se vuelca), o interstitials con código ERR_*. Devuelve el código detectado.
// Un body vacío con marcado real (doctype, lang, meta) NO se considera error.
export function detectarErrorPagina(html: string): string | undefined {
  const limpio = html.trim();
  if (!limpio) return "DOM vacío";
  if (/^<html><head><\/head><body><\/body><\/html>$/i.test(limpio)) return "chrome-error (dom sin contenido)";
  const codigo = /\b(ERR_[A-Z_]{3,})\b/.exec(limpio);
  if (codigo) return codigo[1];
  return undefined;
}

function dirCapturas(root: string): string {
  return join(root, ...CARPETA);
}

export function listarCapturas(root: string): CapturaBrowser[] {
  const dir = dirCapturas(root);
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /\.(png|html)$/.test(f) && !f.startsWith("."))
      .map((f) => {
        const st = statSync(join(dir, f));
        const esDom = f.endsWith(".html");
        // formato del id: <timestamp>_<modo>_<host> (puesto por capturar())
        const idCaptura = f.replace(/\.(png|html)$/, "");
        const modoId = /^\d{4}-\d{2}-\d{2}T[^_]+_(png|dom)_(.+)$/.exec(idCaptura);
        const host = modoId?.[2] ?? "";
        return {
          id: idCaptura,
          // el modo va en el id: un parte de timeout de una captura png se
          // escribe como .html y no debe listarse como dom.
          modo: (modoId ? modoId[1] : esDom ? "dom" : "png") as "png" | "dom",
          archivo: f,
          url: host ? `https://${host}` : "",
          bytes: st.size,
          fecha: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 20);
  } catch {
    return [];
  }
}

// Fachada de captura: abre el motor headless de forma aislada y guarda la
// evidencia en `<destino>/<timestamp>.<png|html>` (destino por defecto:
// .axiom/browser/; verify la pasa a specs/active/<spec>/ para que el artefacto
// quede junto a verification-<tarea>.md y dentro del allowlist). Nunca lanza
// excepción: devuelve { ok, ruta } o { ok:false, error } para que el llamador decida.
export function capturar(root: string, url: string, modo: "png" | "dom" = "png", destino?: string): ResultadoCaptura {
  if (!/^https?:\/\/[^\s]+$/i.test(url.trim())) return { ok: false, error: `url inválida (se espera http/https): ${url}` };
  const cfg = leerConfig(root);
  const motor = detectarMotor(root);
  if (!motor) {
    return {
      ok: false,
      error: "sin motor de navegador: instala la caché de Playwright (`npx playwright install chromium`), un Chromium del sistema o declara executablePath en browser.config.json",
    };
  }
  const dir = destino && destino.trim() ? destino : dirCapturas(root);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `no se pudo crear ${dir}: ${e instanceof Error ? e.message : String(e)}` };
  }
  let host = "";
  try {
    host = new URL(url.trim()).hostname.replace(/[^a-z0-9.-]/gi, "").slice(0, 40);
  } catch {
    host = "";
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}_${modo}${host ? `_${host}` : ""}`;
  const archivo = join(dir, `${id}.${modo === "dom" ? "html" : "png"}`);
  const perfil = join(tmpdir(), `axiom-browser-${id}`);
  const args = [
    "--headless",
    `--user-data-dir=${perfil}`,
    "--hide-scrollbars",
    "--window-size=1280,800",
    "--virtual-time-budget=5000",
  ];
  if (cfg.noSandbox) args.push("--no-sandbox");
  // Siempre dump-dom (además del png): es la única forma de ver si el navegador
  // mostró su página de error; screenshot + dump-dom funcionan en un solo spawn.
  args.push("--dump-dom");
  if (modo === "png") args.push(`--screenshot=${archivo}`);
  args.push(url.trim());
  const limiteMs = cfg.timeoutMs ?? TIMEOUT_DEFAULT;
  const t0 = Date.now();
  const r = spawnSync(motor.ruta, args, {
    encoding: "utf8",
    timeout: limiteMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const transcurrido = Date.now() - t0;
  try {
    rmSync(perfil, { recursive: true, force: true });
  } catch {
    /* el perfil temporal es prescindible */
  }
  // Timeout de red (spawnSync mata al motor con ETIMEDOUT): la URL colgó sin
  // responder. No es «captura fallida»: hay parte de timeout como evidencia y
  // verify ajusta el veredicto a fail. Solo ETIMEDOUT: un error real de
  // ejecución (ENOENT, etc.) sigue siendo fail closed sin artefacto.
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    const artefacto = join(dir, `${id}.html`);
    const parte = `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>Timeout de red</title></head>\n<body>\n<h1>Timeout de red</h1>\n<p>El motor de navegador no terminó de cargar la URL antes del límite.</p>\n<ul>\n<li>url: ${url.trim().replace(/[<>&"]/g, "")}</li>\n<li>motor: ${motor.nombre} (${motor.origen})</li>\n<li>límite: ${limiteMs} ms · transcurrido: ${transcurrido} ms</li>\n<li>fecha: ${new Date().toISOString()}</li>\n</ul>\n<p>La carga de la URL NO está verificada con esta evidencia.</p>\n</body></html>\n`;
    try {
      writeFileSync(artefacto, parte, "utf8");
    } catch (e) {
      return { ok: false, error: `timeout de red y sin artefacto en ${artefacto}: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, ruta: artefacto, bytes: Buffer.byteLength(parte), motor: motor.nombre, timeoutMs: transcurrido };
  }
  if (r.error) return { ok: false, error: `no se pudo ejecutar ${motor.ruta}: ${r.error.message}` };
  if (r.status !== 0) {
    const detalle = (r.stderr ?? "").trim().split("\n").slice(-3).join(" · ");
    const causa = r.status === null ? `señal ${r.signal ?? "desconocida"}` : `código ${r.status}`;
    const pista = /No usable sandbox|user namespaces/i.test(detalle)
      ? " — habilita noSandbox en browser.config.json (requerido en Ubuntu 23.10+ con AppArmor)"
      : "";
    return { ok: false, error: `el motor terminó con ${causa}${detalle ? `: ${detalle}` : ""}${pista}` };
  }
  if (modo === "dom") {
    const html = r.stdout ?? "";
    if (!html.trim()) return { ok: false, error: "el motor devolvió un DOM vacío" };
    try {
      writeFileSync(archivo, html, "utf8");
    } catch (e) {
      return { ok: false, error: `no se pudo escribir ${archivo}: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    try {
      if (!existsSync(archivo) || statSync(archivo).size === 0) {
        return { ok: false, error: "el motor no produjo captura (¿página inaccesible o timeout?)" };
      }
    } catch {
      return { ok: false, error: "el motor no produjo captura" };
    }
  }
  let bytes = 0;
  try {
    bytes = statSync(archivo).size;
  } catch {
    /* ya verificado arriba */
  }
  return { ok: true, ruta: archivo, bytes, motor: motor.nombre, errorPagina: detectarErrorPagina(r.stdout ?? "") };
}

export function datosModulo(root: string): {
  titulo: string;
  motor: { disponible: boolean; nombre: string; ruta: string; origen: string };
  paquetes: string[];
  items: { id: string; nota: string }[];
  capturas: CapturaBrowser[];
  sesiones: ReturnType<typeof listarSesiones>;
  fuente: string;
} {
  const motor = detectarMotor(root);
  const capturas = listarCapturas(root);
  // Sesiones conducibles (ADR-0006): viven en memoria de este proceso; si el
  // panel no puede verlas (proceso distinto) se lista vacío, sin inventar.
  const sesiones = listarSesiones();
  return {
    titulo: "Capturas de navegador (evidencia)",
    motor: motor
      ? { disponible: true, nombre: motor.nombre, ruta: motor.ruta, origen: motor.origen }
      : { disponible: false, nombre: "—", ruta: "—", origen: "no detectado" },
    paquetes: paquetesInstalados(root),
    items: capturas.map((c) => ({ id: c.id, nota: `${c.modo} · ${c.bytes} B · ${c.fecha}` })),
    capturas,
    sesiones,
    fuente: motor
      ? `Motor: ${motor.nombre} (${motor.origen}) · capturas en ${CARPETA.join("/")}/ · usa \`axiom browser <url>\` para capturar`
      : "Sin motor: instala la caché de Playwright (`npx playwright install chromium`) o declara executablePath en browser.config.json",
  };
}

// --- Sesiones conducibles (ADR-0006): misma autoridad que la CLI/web ---
export type { TipoAccion, RespuestaAccion } from "./sesion.js";
export { ACCIONES, esAccion } from "./sesion.js";
export { listarSesiones as sesionesVivas };

// Fachada única de las acciones de sesión: CLI, web y agente pasan por aquí
// para que la validación, la decisión del broker y los límites duros sean los
// mismos y las trazas lleven el origen de quien llamó.
export async function ejecutarSesion(
  root: string,
  a: import("./sesion.js").TipoAccion,
  args: Record<string, unknown>,
  llamada?: LlamadaTrazable,
): Promise<{ ok: boolean; code: number; msg: string; datos?: Record<string, unknown> }> {
  const { ejecutar } = await import("./sesion.js");
  return ejecutar(root, a, args, llamada ?? {});
}

export function estadoBrowser(root: string): string {
  const motor = detectarMotor(root);
  const n = listarCapturas(root).length;
  if (!motor) {
    return `browser: sin motor de navegador (npx playwright install chromium, o executablePath en browser.config.json) · ${n} captura(s) previa(s)`;
  }
  return `browser: motor ${motor.nombre} [${motor.origen}] · ${n} captura(s) en ${CARPETA.join("/")}/ · uso: axiom browser <url> [--dom]`;
}

export function estadoTexto(): string {
  return "browser: fachada de navegador headless (captura PNG/DOM como evidencia)";
}
