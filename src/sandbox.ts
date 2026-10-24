// D-full — sandbox Docker endurecido (docker-patterns).
// source RO -> copia tmpfs writable, non-root, read-only, cap_drop ALL, no-net default.
import { execFile } from "node:child_process";

export interface SandboxOpts {
  image?: string;
  workdir?: string;
  network?: "none" | "bridge";
  timeoutMs?: number;
  env?: Record<string, string>;
}

const PINNED = "node:22.12-alpine3.20";
const ALLOWED_IMAGES = new Set([PINNED, "node:22-alpine"]);

export function imagenPermitida(image?: string): string | undefined {
  const img = image ?? PINNED;
  if (!ALLOWED_IMAGES.has(img)) return `imagen no permitida: ${img} (pinned: ${[...ALLOWED_IMAGES].join(", ")})`;
  return undefined;
}

function run(cmd: string, args: string[], timeoutMs = 30000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
      resolve({ stdout: String(stdout ?? ""), stderr: String(err?.message ?? stderr ?? ""), code: err?.code ?? 0 });
    });
  });
}

export async function sandboxRun(root: string, userCmd: string[], opts: SandboxOpts = {}): Promise<{ code: number; out: string }> {
  const image = opts.image ?? PINNED;
  const mal = imagenPermitida(image);
  if (mal) return { code: 2, out: mal };
  if (opts.network && opts.network !== "none") return { code: 2, out: "red externa exige aprobación ALTA + perfil networked explícito" };
  const envArgs: string[] = [];
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (!/^AXIOM_[A-Z0-9_]+$/.test(k)) return { code: 2, out: `variable de entorno no permitida: ${k}` };
      if (v.length > 64 || /[\s"'`$\\]/.test(v)) return { code: 2, out: `valor de entorno no permitido para ${k}` };
      envArgs.push("--env", `${k}=${v}`);
    }
  }
  const args = [
    "run", "--rm",
    ...envArgs,
    "--user", "1000:1000",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--network", "none",
    "--pids-limit", "128",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", "/workspace:rw,noexec,nosuid,uid=1000,gid=1000,mode=700",
    "-v", `${root}:/src:ro`,
    "-w", "/workspace",
    image,
    "sh", "-c", `cp -a /src/. /workspace/ 2>/dev/null; ${userCmd.join(" ")}`,
  ];
  const r = await run("docker", args, opts.timeoutMs ?? 30000);
  return { code: r.code, out: (r.stdout + r.stderr).slice(0, 4000) };
}

export function sandboxSpec(): string {
  return `sandbox D-full: image pinned ${PINNED}, user 1000, read-only, cap_drop ALL, no-new-privs, net none, pids 128, tmpfs /tmp+/workspace(noexec), source RO->copia writable, env solo AXIOM_* via --env`;
}
