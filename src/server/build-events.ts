// API de streaming — endpoint SSE que corre el build y emite el progreso.
// Sin dependencias nuevas: node:http puro (la firma (req, res) se porta tal
// cual a un controlador Express). Eventos: status | file_start |
// file_success | error | complete, con ruta y logs del orquestador.
// Cada evento se anexa al run-log (.runs/<run>.jsonl) con checkpoint en
// file_success/complete; `?resume=1` reanuda un build pausado sin reescribir
// lo ya hecho (vía reanudarBuild). `?run=` fija el id; si no, deriva de spec.
// El handler es compartido: lo usan el servidor dedicado
// (crearServidorBuild) y el principal (startWeb en web.ts) sin duplicar.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AgentOrchestrator, type EventoBuild } from "../orchestrator/orchestrator.js";
import { reanudarBuild } from "../orchestrator/resume.js";
import { anexarEvento, guardarCheckpoint, runIdParaSpec } from "./run-log.js";

export interface OpcionesBuildServer {
  root: string;
  puerto: number;
  generarCodigo: (ruta: string, spec: string) => Promise<string> | string;
}

function enviar(res: ServerResponse, evento: EventoBuild): void {
  res.write(`data: ${JSON.stringify(evento)}\n\n`);
}

/** Handler compartido GET /api/build/stream (dedicado y principal). */
export function manejarBuildStream(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
  generarCodigo: (ruta: string, spec: string) => Promise<string> | string,
): void {
  const url = new URL(req.url ?? "/", "http://local");
  const spec = url.searchParams.get("spec") || ".speckit/build.md";
  const runId = url.searchParams.get("run") || runIdParaSpec(spec);
  const resume = url.searchParams.get("resume") === "1";
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const emitir = (e: EventoBuild): void => {
    try {
      anexarEvento(root, runId, { type: e.type, ruta: e.ruta, mensaje: e.mensaje, estado: e.estado });
      if (e.type === "file_success" || e.type === "complete") {
        try {
          guardarCheckpoint(root, runId, readFileSync(`${root}/${spec}`, "utf8"));
        } catch {
          /* la spec puede no existir aún: el checkpoint espera al primer éxito */
        }
      }
    } catch {
      /* el log nunca tumba el build */
    }
    enviar(res, e);
  };
  emitir({ type: "status", mensaje: `build ${resume ? "reanudado" : "iniciado"}: ${spec} (run ${runId})` });
  const corrida = resume
    ? reanudarBuild(root, spec, { generarCodigo, emitir }, { runId })
    : new AgentOrchestrator(root, spec, { generarCodigo, emitir }).ejecutar();
  void Promise.resolve(corrida)
    .catch((e: unknown) => {
      emitir({
        type: "error",
        mensaje: `excepción del build: ${e instanceof Error ? e.message : e}`,
      });
    })
    .finally(() => res.end());
}

export function crearServidorBuild(opciones: OpcionesBuildServer): Server {
  const { root, puerto, generarCodigo } = opciones;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "GET" && url.pathname === "/api/build/stream") {
      manejarBuildStream(root, req, res, generarCodigo);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "no encontrado (usa GET /api/build/stream?spec=.speckit/build.md[&resume=1])" }));
  });
  server.listen(puerto);
  return server;
}
