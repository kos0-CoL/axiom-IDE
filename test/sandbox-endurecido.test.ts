// El sandbox se usa en `verify --cmd` y en `comp`: dos caminos donde un exit
// falso positivo invalida la evidencia. Estos tests fijan los flags de recursos y
// que un timeout no se lea como éxito ni deje el contenedor vivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODIGO_TIMEOUT, argumentosSandbox, cpusValidas, memoriaValida, sandboxRun } from "../dist/sandbox.js";

function temp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("los args de docker llevan recursos, nombre y label", () => {
  const args = argumentosSandbox("/tmp/proyecto", ["echo", "hola"], {}, "axiom-demo");
  const valor = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  assert.equal(valor("--memory"), "512m");
  assert.equal(valor("--memory-swap"), "512m", "sin swap extra el techo de memoria es real");
  assert.equal(valor("--cpus"), "1");
  assert.equal(valor("--pids-limit"), "128");
  assert.equal(valor("--network"), "none");
  assert.equal(valor("--name"), "axiom-demo");
  assert.equal(valor("--label"), "axiom.sandbox=1");
  assert.equal(valor("--stop-timeout"), "10");
  assert.ok(args.includes("--read-only") && args.includes("--cap-drop"));
  assert.equal(args[args.length - 1], "cp -a /src/. /workspace/ 2>/dev/null; echo hola");

  const propios = argumentosSandbox("/tmp/x", ["true"], { memory: "1g", cpus: "2", image: "node:22-alpine" }, "axiom-otro");
  assert.equal(propios[propios.indexOf("--memory") + 1], "1g");
  assert.equal(propios[propios.indexOf("--cpus") + 1], "2");
  assert.ok(propios.includes("node:22-alpine"));
});

test("memoria y CPU se validan: un valor raro no se vuelve otro flag", () => {
  assert.equal(memoriaValida(undefined), undefined);
  assert.equal(memoriaValida("1g"), undefined);
  assert.match(memoriaValida("1g --privileged") ?? "", /memoria inválida/);
  assert.match(memoriaValida("0m") ?? "", /memoria inválida/);
  assert.equal(cpusValidas(undefined), undefined);
  assert.equal(cpusValidas("4"), undefined);
  assert.match(cpusValidas("0") ?? "", /cpus inválidas/);
  assert.match(cpusValidas("1.5") ?? "", /cpus inválidas/);
});

test("un timeout devuelve 124 y elimina el contenedor", { skip: process.platform === "win32" }, async () => {
  const bin = temp("axiom-docker-bin-");
  const root = temp("axiom-docker-root-");
  const log = join(bin, "llamadas.log");
  const fake = join(bin, "docker");
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = "rm" ]; then exit 0; fi\nif [ "$1" = "run" ]; then sleep 5; exit 0; fi\nexit 0\n`);
  chmodSync(fake, 0o755);
  const pathPrevio = process.env.PATH;
  process.env.PATH = `${bin}:${pathPrevio ?? ""}`;
  try {
    const r = await sandboxRun(root, ["colgado"], { timeoutMs: 150 });
    assert.equal(r.code, CODIGO_TIMEOUT, "un comando colgado no puede reportarse como exit 0");
    assert.match(r.out, /timeout 150ms/);
    const llamadas = readFileSync(log, "utf8").trim().split("\n");
    assert.ok(llamadas.some((l) => l.startsWith("run ")), "se invocó docker run");
    assert.ok(llamadas.some((l) => l.startsWith("rm -f axiom-")), "el contenedor se elimina aunque el cliente muera");
  } finally {
    process.env.PATH = pathPrevio;
    rmSync(bin, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("una salida normal conserva su código y también limpia", { skip: process.platform === "win32" }, async () => {
  const bin = temp("axiom-docker-ok-");
  const root = temp("axiom-docker-root-");
  const log = join(bin, "llamadas.log");
  const fake = join(bin, "docker");
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = "run" ]; then echo "todo bien"; fi\nexit 0\n`);
  chmodSync(fake, 0o755);
  const pathPrevio = process.env.PATH;
  process.env.PATH = `${bin}:${pathPrevio ?? ""}`;
  try {
    const r = await sandboxRun(root, ["npm", "test"], { timeoutMs: 5000 });
    assert.equal(r.code, 0);
    assert.match(r.out, /todo bien/);
    const llamadas = readFileSync(log, "utf8").trim().split("\n");
    assert.ok(llamadas.some((l) => l.startsWith("rm -f axiom-")));
  } finally {
    process.env.PATH = pathPrevio;
    rmSync(bin, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("la memoria y las CPUs declaradas también se validan antes de docker", async () => {
  const root = temp("axiom-docker-val-");
  try {
    const r = await sandboxRun(root, ["true"], { memory: "mucho" });
    assert.equal(r.code, 2);
    assert.match(r.out, /memoria inválida/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
