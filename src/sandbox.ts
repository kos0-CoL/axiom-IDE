// D-full — sandbox Docker endurecido (docker-patterns).
// source RO -> copia tmpfs writable, non-root, read-only, cap_drop ALL, no-net default.
//
// Además de los límites del proceso, el contenedor lleva techo de memoria y CPU
// (un `while` de compilación no puede comerse la máquina), nombre propio y label,
// y SIEMPRE se elimina al terminar la corrida: `execFile` mata al cliente
// `docker` cuando vence el timeout, no al contenedor, así que sin este `rm -f` un
// comando colgado deja un contenedor vivo hasta que el proceso interno acabe.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface SandboxOpts {
  image?: string;
  workdir?: string;
  network?: "none" | "bridge";
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Techo de memoria del contenedor (p. ej. "512m"). Default 512m. */
  memory?: string;
  /** CPUs asignadas (p. ej. "1"). Default 1. */
  cpus?: string;
}

const PINNED = "node:22.12-alpine3.20";
const ALLOWED_IMAGES = new Set([PINNED, "node:22-alpine"]);
const MEMORIA_DEFECTO = "512m";
const CPUS_DEFECTO = "1";
/** Código convencional de `timeout(1)`: el comando no terminó en el plazo. */
export const CODIGO_TIMEOUT = 124;

export function imagenPermitida(image?: string): string | undefined {
  const img = image ?? PINNED;
  if (!ALLOWED_IMAGES.has(img)) return `imagen no permitida: ${img} (pinned: ${[...ALLOWED_IMAGES].join(", ")})`;
  return undefined;
}

// Los topes viajan a `docker run` como texto: se validan acá para que un valor
// raro no se convierta en un flag extra (p. ej. `--memory 1g --privileged`).
export function memoriaValida(m?: string): string | undefined {
  const v = m ?? MEMORIA_DEFECTO;
  return /^[1-9]\d{0,4}[mg]$/.test(v) ? undefined : `memoria inválida: ${v} (formato 512m o 1g)`;
}
export function cpusValidas(c?: string): string | undefined {
  const v = c ?? CPUS_DEFECTO;
  return /^[1-9]\d?$/.test(v) ? undefined : `cpus inválidas: ${v} (entero 1-99)`;
}

export function nombreContenedor(): string {
  return `axiom-${randomUUID().slice(0, 8)}`;
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  /** El plazo venció y el proceso hijo se mató. */
  timeout: boolean;
}

function run(cmd: string, args: string[], timeoutMs = 30000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
      // `killed` lo pone Node cuando el plazo del `timeout` mató al hijo; una
      // señal externa (SIGTERM de afuera) no es un timeout y conserva su código.
      const timeout = Boolean(err?.killed);
      // Un timeout no tiene err.code (queda null): devolverlo como 0 convertiría
      // un comando colgado en un éxito de verificación.
      // Una señal sin código numérico (p. ej. SIGKILL del OOM-killer del host) no
      // es éxito: se mapea al código de shell 128+señal antes de caer a 0.
      const code = timeout ? CODIGO_TIMEOUT
        : typeof err?.code === "number" ? err.code
        : err?.signal === "SIGKILL" ? 137
        : err?.signal === "SIGTERM" ? 143
        : err?.code === "ENOENT" ? 127
        : 0;
      resolve({ stdout: String(stdout ?? ""), stderr: String(err?.message ?? stderr ?? ""), code, timeout });
    });
  });
}

/** Argumentos de `docker run` (exportado: los flags son contrato, se testean). */
export function argumentosSandbox(root: string, userCmd: string[], opts: SandboxOpts, nombre: string): string[] {
  const envArgs: string[] = [];
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) envArgs.push("--env", `${k}=${v}`);
  }
  return [
    "run", "--rm",
    "--name", nombre,
    "--label", "axiom.sandbox=1",
    ...envArgs,
    "--user", "1000:1000",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--network", "none",
    "--pids-limit", "128",
    "--memory", opts.memory ?? MEMORIA_DEFECTO,
    "--memory-swap", opts.memory ?? MEMORIA_DEFECTO,
    "--cpus", opts.cpus ?? CPUS_DEFECTO,
    "--stop-timeout", "10",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", "/workspace:rw,noexec,nosuid,uid=1000,gid=1000,mode=700",
    "-v", `${root}:/src:ro`,
    "-w", "/workspace",
    opts.image ?? PINNED,
    "sh", "-c", `cp -a /src/. /workspace/ 2>/dev/null; ${userCmd.join(" ")}`,
  ];
}

export async function sandboxRun(root: string, userCmd: string[], opts: SandboxOpts = {}): Promise<{ code: number; out: string }> {
  const image = opts.image ?? PINNED;
  const mal = imagenPermitida(image);
  if (mal) return { code: 2, out: mal };
  const malMem = memoriaValida(opts.memory);
  if (malMem) return { code: 2, out: malMem };
  const malCpu = cpusValidas(opts.cpus);
  if (malCpu) return { code: 2, out: malCpu };
  if (opts.network && opts.network !== "none") return { code: 2, out: "red externa exige aprobación ALTA + perfil networked explícito" };
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (!/^AXIOM_[A-Z0-9_]+$/.test(k)) return { code: 2, out: `variable de entorno no permitida: ${k}` };
      if (v.length > 64 || /[\s"'`$\\]/.test(v)) return { code: 2, out: `valor de entorno no permitido para ${k}` };
    }
  }
  const nombre = nombreContenedor();
  const timeoutMs = opts.timeoutMs ?? 30000;
  const args = argumentosSandbox(root, userCmd, { ...opts, image }, nombre);
  const r = await run("docker", args, timeoutMs);
  // Best-effort y siempre: si el cliente murió (timeout, Ctrl-C, OOM del host),
  // el contenedor puede seguir vivo. `rm -f` es idempotente y no falla la corrida.
  const limpieza = await run("docker", ["rm", "-f", nombre], 10000);
  const salida = (r.stdout + r.stderr).slice(0, 4000);
  if (r.timeout) {
    return {
      code: CODIGO_TIMEOUT,
      out: `${salida}${salida ? "\n" : ""}timeout ${timeoutMs}ms: contenedor ${nombre} detenido${limpieza.timeout ? " (la limpieza también expiró, revisá `docker ps`)" : ""}`.slice(0, 4000),
    };
  }
  return { code: r.code, out: salida };
}

export function sandboxSpec(): string {
  return `sandbox D-full: image pinned ${PINNED}, user 1000, read-only, cap_drop ALL, no-new-privs, net none, pids 128, memory ${MEMORIA_DEFECTO}, cpus ${CPUS_DEFECTO}, stop-timeout 10s, tmpfs /tmp+/workspace(noexec), source RO->copia writable, env solo AXIOM_* via --env, contenedor nombrado y eliminado al terminar (timeout = ${CODIGO_TIMEOUT})`;
}
