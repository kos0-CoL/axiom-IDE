# Spec: etapa6-entrada-real

## Contexto
El pipeline Speckit no lo llama ningún camino del producto: `AgentOrchestrator`,
`generarCodigoLLM` y `crearServidorBuild` solo los usan tests/demos. Además el
servidor SSE no escribe el run-log y no acepta resume. Esta etapa le da entrada
real: CLI `axiom build [spec] [--resume]` y `GET /api/build/stream?resume=1`,
con cada evento persistido en `.runs/`. Reutiliza `src/orchestrator/resume.ts`,
`src/server/run-log.ts`, `src/nodes/coder-llm.ts` y el patrón `cmdRun`/`flagStr`
de `src/commands.ts` + `src/cli.ts`.

## Criterios de aceptación
- [X] src/server/build-events.ts (run-log + ?resume=1)
- [X] src/commands.ts (cmdBuild)
- [X] src/cli.ts (ruta build)
- [X] test/build-entrada-real.test.ts
- [X] scripts/demo-build-resume-http.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- El servidor anexa cada evento emitido al run-log y guarda checkpoint en
  `file_success`/`complete`; `?resume=1` reanuda sin reescribir lo ya hecho.
- `axiom build [spec] [--resume]` corre el build con `generarCodigoLLM` y
  pinta eventos por stdout; `--resume` retoma un build pausado.
- Tests en verde + `tsc` limpio.
