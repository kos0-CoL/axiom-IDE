// Run log durable — eventos persistidos por run (los mismos del SSE).
// JSONL por run: { run_id, seq, type, ruta?, mensaje?, estado? } + checkpoint
// de spec. Reanudar reutiliza `file_success` ya persistidos; lo incierto se
// reintenta con la misma clave de idempotencia (at-least-once + efectos
// idempotentes; nunca exactly-once).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TipoEventoRun = "status" | "file_start" | "file_success" | "error" | "complete";

export interface EventoRun {
  run_id: string;
  seq: number;
  type: TipoEventoRun;
  ruta?: string;
  mensaje?: string;
  estado?: string;
  ts: string;
}

export function dirRuns(root: string): string {
  return join(root, ".runs");
}

export function runIdParaSpec(specRel: string): string {
  return specRel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run";
}

function rutaLog(root: string, runId: string): string {
  return join(dirRuns(root), `${runId}.jsonl`);
}

function rutaCheckpoint(root: string, runId: string): string {
  return join(dirRuns(root), `${runId}.spec.md`);
}

export function siguienteSeq(root: string, runId: string): number {
  return leerEventos(root, runId).length;
}

export function anexarEvento(root: string, runId: string, ev: Omit<EventoRun, "run_id" | "seq" | "ts">): EventoRun {
  mkdirSync(dirRuns(root), { recursive: true });
  const completo: EventoRun = { ...ev, run_id: runId, seq: siguienteSeq(root, runId), ts: new Date().toISOString() };
  appendFileSync(rutaLog(root, runId), JSON.stringify(completo) + "\n", "utf8");
  return completo;
}

export function leerEventos(root: string, runId: string): EventoRun[] {
  const p = rutaLog(root, runId);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as EventoRun];
      } catch {
        return [];
      }
    });
}

/** Archivos ya escritos según el log (file_success persistido). */
export function archivosCompletados(root: string, runId: string): string[] {
  const vistos = new Set<string>();
  for (const e of leerEventos(root, runId)) {
    if (e.type === "file_success" && e.ruta) vistos.add(e.ruta);
  }
  return [...vistos];
}

export function guardarCheckpoint(root: string, runId: string, spec: string): void {
  mkdirSync(dirRuns(root), { recursive: true });
  writeFileSync(rutaCheckpoint(root, runId), spec, "utf8");
}

export function leerCheckpoint(root: string, runId: string): string | undefined {
  const p = rutaCheckpoint(root, runId);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}
