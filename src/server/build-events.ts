// API de streaming — endpoint SSE que corre el build y emite el progreso.
// Sin dependencias nuevas: node:http puro (la firma (req, res) se porta tal
// cual a un controlador Express). Eventos: status | file_start |
// file_success | error | complete, con ruta y logs del orquestador.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AgentOrchestrator, type EventoBuild } from "../orchestrator/orchestrator.js";

export interface OpcionesBuildServer {
  root: string;
  puerto: number;
  generarCodigo: (ruta: string, spec: string) => Promise<string> | string;
}

function enviar(res: ServerResponse, evento: EventoBuild): void {
  res.write(`data: ${JSON.stringify(evento)}\n\n`);
}

export function crearServidorBuild(opciones: OpcionesBuildServer): Server {
  const { root, puerto, generarCodigo } = opciones;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "GET" && url.pathname === "/api/build/stream") {
      const spec = url.searchParams.get("spec") || ".speckit/build.md";
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const orquestador = new AgentOrchestrator(root, spec, {
        generarCodigo,
        emitir: (e) => enviar(res, e),
      });
      enviar(res, { type: "status", mensaje: `build iniciado: ${spec}` });
      void orquestador
        .ejecutar()
        .catch((e: unknown) => {
          enviar(res, {
            type: "error",
            mensaje: `excepción del build: ${e instanceof Error ? e.message : e}`,
          });
        })
        .finally(() => res.end());
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "no encontrado (usa GET /api/build/stream?spec=.speckit/build.md)" }));
  });
  server.listen(puerto);
  return server;
}
