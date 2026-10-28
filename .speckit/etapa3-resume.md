# Spec: etapa3-resume

## Contexto
Un build pausado hoy se empieza de cero. Falta reanudación durable: log de
eventos por run (los mismos del SSE) + checkpoint de spec, reutilizando
resultados ya persistidos y reintentando lo incierto con la misma clave de
idempotencia (at-least-once + efectos idempotentes; nunca exactly-once).
Reutiliza `src/server/build-events.ts`, `src/orchestrator/` y `src/store.ts`.

## Criterios de aceptación
- [X] src/server/run-log.ts
- [X] src/orchestrator/resume.ts
- [X] test/resume.test.ts
- [X] scripts/demo-resume.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Cada evento lleva `run_id`, `seq` y payload reproducible; el log es JSONL
  por run y el checkpoint guarda spec + versión del workflow.
- `--resume` (o `?resume=1`) termina un build pausado a mitad sin repetir
  archivos ya escritos; lo incierto se reintenta con la misma clave.
- Demo: pausar a mitad por 3 fallos y reanudar hasta `complete`. Tests en
  verde + `tsc` limpio.
