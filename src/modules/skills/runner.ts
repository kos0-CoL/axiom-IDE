// Runner de scripts de skill — determinista y acotado.
// Garantías: cwd fijado a la raíz del skill, timeout del supervisor,
// --dry-run obligatorio para lo destructivo, y secretos nunca expuestos
// (el entorno heredado se filtra; solo PATH + allowlist explícita).
// No es un sandbox de contenedor: es aislamiento de proceso + límites,
// documentado como tal en docs/skills-formato.md.
import { ENV, valorEnv } from "../../env.js";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, normalize, relative, resolve } from "node:path";

export interface OpcionesScript {
  timeoutMs?: number;
  dryRun?: boolean;
  args?: string[];
  /** Variables extra permitidas (nombre → valor). Nada más entra. */
  envPermitido?: Record<string, string>;
  maxBytesSalida?: number;
}

export interface ResultadoScript {
  ok: boolean;
  salida: string;
  error?: string;
  ms: number;
  sha256: string;
  dryRun: boolean;
}

const TIMEOUT_DEFECTO = 15000;
const MAX_SALIDA = 8000;

// rm -rf, mkfs, dd, DROP/DELETE sin WHERE, chmod 777 /, shutdown…: si el
// script los contiene, solo corre con dryRun:true (y aun así no ejecuta).
const DESTRUCTIVO = /(rm\s+-rf|mkfs|:\(\)\s*\{|shutdown|reboot|DROP\s+TABLE|DELETE\s+FROM|chmod\s+(-R\s+)?777\s+\/)/i;

export function esDestructivo(contenido: string): boolean {
  return DESTRUCTIVO.test(contenido);
}

/** Resuelve un script dentro de skills/<id>/ sin escapes (fail closed). */
export function resolverScriptSkill(root: string, skillId: string, scriptRel: string): string {
  const base = normalize(resolve(root, "skills", skillId));
  const abs = normalize(resolve(base, scriptRel));
  const rel = relative(base, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${"/"}`)) {
    throw new Error(`script fuera del skill: ${scriptRel}`);
  }
  return abs;
}

function entornoFiltrado(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  const ruta = valorEnv(ENV.PATH);
  const home = valorEnv(ENV.HOME);
  if (ruta) env.PATH = ruta;
  if (home) env.HOME = home;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (/KEY|SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL/i.test(k)) continue;
      env[k] = v;
    }
  }
  return env;
}

export function ejecutarScriptSkill(
  root: string,
  skillId: string,
  scriptRel: string,
  opts: OpcionesScript = {},
): ResultadoScript {
  const t0 = Date.now();
  const abs = resolverScriptSkill(root, skillId, scriptRel);
  if (!existsSync(abs)) {
    return { ok: false, salida: "", error: `script inexistente: skills/${skillId}/${scriptRel}`, ms: 0, sha256: "", dryRun: false };
  }
  let contenido: string;
  try {
    contenido = readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, salida: "", error: `ilegible: ${e instanceof Error ? e.message : e}`, ms: 0, sha256: "", dryRun: false };
  }
  const sha256 = createHash("sha256").update(contenido).digest("hex");
  const destructivo = esDestructivo(contenido);
  if (destructivo && opts.dryRun !== true) {
    return { ok: false, salida: "", error: "script destructivo: exige dryRun:true (--dry-run)", ms: Date.now() - t0, sha256, dryRun: true };
  }
  if (destructivo) {
    return { ok: true, salida: "[dry-run] script destructivo no ejecutado", ms: Date.now() - t0, sha256, dryRun: true };
  }
  const ext = basename(abs).split(".").pop() ?? "";
  const interprete = ext === "mjs" || ext === "js" ? process.execPath : "sh";
  const r = spawnSync(interprete, interprete === "sh" ? [abs, ...(opts.args ?? [])] : [abs, ...(opts.args ?? [])], {
    cwd: join(root, "skills", skillId),
    env: entornoFiltrado(opts.envPermitido),
    timeout: opts.timeoutMs ?? TIMEOUT_DEFECTO,
    encoding: "utf8",
    maxBuffer: (opts.maxBytesSalida ?? MAX_SALIDA) * 4,
  });
  const limite = opts.maxBytesSalida ?? MAX_SALIDA;
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(0, limite);
  if (r.error) {
    return { ok: false, salida, error: `fallo de ejecución: ${r.error.message}`, ms: Date.now() - t0, sha256, dryRun: false };
  }
  if ((r.status ?? 0) !== 0) {
    return { ok: false, salida, error: `exit ${r.status ?? "?"}`, ms: Date.now() - t0, sha256, dryRun: false };
  }
  return { ok: true, salida, ms: Date.now() - t0, sha256, dryRun: false };
}
