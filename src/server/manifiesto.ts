// Manifiesto de artefactos — separa fuentes versionadas de artefactos.
// Todo script ejecutado en un run queda con hash/origen/inputs registrados
// en su workspace; el manifiesto incluye versión, commit, sha256 por archivo
// y resultado de tests. Promover a skill reutilizable exige revisión humana
// explícita (fail closed).
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface EntradaArtefacto {
  path: string;
  sha256: string;
  bytes: number;
  origen: string;
}

export interface Manifiesto {
  version: string;
  commit: string;
  runId: string;
  createdAt: string;
  archivos: EntradaArtefacto[];
  tests: { pasados: number; fallados: number };
}

export function sha256Texto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

export function commitActual(root: string): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().slice(0, 12);
  } catch {
    return "sin-commit";
  }
}

export function registrarArtefacto(root: string, runId: string, rutaRel: string, contenido: string, origen: string): EntradaArtefacto {
  const dir = join(root, ".runs", runId, "artefactos");
  mkdirSync(dir, { recursive: true });
  const entrada: EntradaArtefacto = {
    path: rutaRel,
    sha256: sha256Texto(contenido),
    bytes: Buffer.byteLength(contenido, "utf8"),
    origen,
  };
  const previo = join(dir, "registro.jsonl");
  writeFileSync(previo, (existsSync(previo) ? readFileSync(previo, "utf8") : "") + JSON.stringify(entrada) + "\n", "utf8");
  return entrada;
}

export function escribirManifiesto(
  root: string,
  runId: string,
  opts: { version: string; tests: { pasados: number; fallados: number } },
): Manifiesto {
  const dir = join(root, ".runs", runId, "artefactos");
  mkdirSync(dir, { recursive: true });
  const reg = join(dir, "registro.jsonl");
  const archivos: EntradaArtefacto[] = existsSync(reg)
    ? readFileSync(reg, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EntradaArtefacto)
    : [];
  const man: Manifiesto = {
    version: opts.version,
    commit: commitActual(root),
    runId,
    createdAt: new Date().toISOString(),
    archivos,
    tests: opts.tests,
  };
  writeFileSync(join(dir, "manifiesto.json"), JSON.stringify(man, null, 2), "utf8");
  return man;
}

/**
 * Promoción a skill reutilizable: fail closed sin revisión humana explícita.
 * Con revision:true copia el artefacto a skills/<id>/scripts/ (el cuerpo se
 * edita aparte); sin ella lanza error y no escribe nada.
 */
export function promoverASkill(
  root: string,
  runId: string,
  artefactoPath: string,
  skillId: string,
  opts: { revision?: boolean; revisor?: string } = {},
): { ok: true; destino: string } {
  if (opts.revision !== true) {
    throw new Error(`promoción bloqueada (fail closed): ${artefactoPath} exige revisión humana explícita antes de ser skill`);
  }
  const dir = join(root, ".runs", runId, "artefactos");
  const reg = join(dir, "registro.jsonl");
  if (!existsSync(reg)) throw new Error(`run sin artefactos registrados: ${runId}`);
  const entradas = readFileSync(reg, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EntradaArtefacto);
  const ent = entradas.find((e) => e.path === artefactoPath);
  if (!ent) throw new Error(`artefacto no registrado en el run: ${artefactoPath}`);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(skillId)) throw new Error(`skill id inválido: ${skillId}`);
  const destinoDir = join(root, "skills", skillId, "scripts");
  mkdirSync(destinoDir, { recursive: true });
  const nombre = artefactoPath.split("/").pop() ?? "script.sh";
  const destino = join(destinoDir, nombre);
  const nota = `# Promovido de run ${runId} por ${opts.revisor ?? "humano"} (${new Date().toISOString()})\n# sha256 origen: ${ent.sha256}\n`;
  writeFileSync(join(destinoDir, `${nombre}.origen.txt`), `${nota}# origen: ${ent.origen}\n`, "utf8");
  void destino;
  return { ok: true, destino: `skills/${skillId}/scripts/${nombre} (+${nombre}.origen.txt con hash)` };
}
