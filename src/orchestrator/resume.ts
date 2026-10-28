// Resume — reanudar un build pausado sin empezar de cero.
// Sincroniza la spec con el run-log (todo file_success persistido queda
// [X]) y luego corre el AgentOrchestrator normal, que por FIFO solo toma lo
// pendiente. Los archivos ya escritos no se regeneran: el log es la verdad
// de lo completado y la escritura sigue siendo idempotente.
import { readFileSync, writeFileSync } from "node:fs";
import { AgentOrchestrator, type DepsOrquestador, type ResultadoBuild } from "./orchestrator.js";
import { anexarEvento, archivosCompletados, guardarCheckpoint, runIdParaSpec } from "../server/run-log.js";
import { marcarHecha } from "../spec/checklist.js";

export interface ResultadoResume extends ResultadoBuild {
  runId: string;
  reutilizados: string[];
}

export async function reanudarBuild(
  root: string,
  specRel: string,
  deps: DepsOrquestador,
  opts: { runId?: string } = {},
): Promise<ResultadoResume> {
  const runId = opts.runId ?? runIdParaSpec(specRel);
  let spec: string;
  try {
    spec = readFileSync(`${root}/${specRel}`, "utf8");
  } catch {
    throw new Error(`spec no encontrada: ${specRel} (fail closed: sin spec no hay resume)`);
  }
  // Sincroniza: lo que el log dice completado debe estar [X] en la spec.
  const hechos = archivosCompletados(root, runId);
  let sincronizada = spec;
  for (const ruta of hechos) {
    sincronizada = marcarHecha(sincronizada, ruta).markdown;
  }
  if (sincronizada !== spec) writeFileSync(`${root}/${specRel}`, sincronizada, "utf8");
  guardarCheckpoint(root, runId, sincronizada);
  const emitirOrig = deps.emitir;
  const orquestador = new AgentOrchestrator(root, specRel, {
    ...deps,
    emitir: (e) => {
      try {
        anexarEvento(root, runId, { type: e.type, ruta: e.ruta, mensaje: e.mensaje, estado: e.estado });
        if (e.type === "file_success" || e.type === "complete") {
          try {
            guardarCheckpoint(root, runId, readFileSync(`${root}/${specRel}`, "utf8"));
          } catch { /* best effort */ }
        }
      } catch { /* el log nunca tumba el build */ }
      emitirOrig?.(e);
    },
  });
  const r = await orquestador.ejecutar();
  return { ...r, runId, reutilizados: hechos };
}
