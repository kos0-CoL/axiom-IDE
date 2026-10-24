# Axiom A1 — PRODUCT + TECH

## PRODUCT (qué hace A1)
- `axiom init` en dir vacío crea `.specify/feature.json`, `axiom.json`, `policies.global.json`, `project.json`, `specs/active/`, `docs/decisions/`, `axiom.db` con schema v1.
- `axiom status` muestra proyecto, spec activa, conteos tareas por estado, presupuesto consumido.
- `axiom status --trace <tarea>` recorre cadena (en A1: tarea → spec ver, evidencia si existe).
- `axiom validate-spec` falla si tarea sin `spec_id:ver` o sin Given/When/Then, o si spec aprobada mutada sin nueva versión.

## TECH (cómo, mínimo)
- Node 24, TS, `zod` para contratos, `node:sqlite` (sin nativa) para store.
- Contratos en `src/contracts.ts`, store en `src/store.ts`, CLI en `src/cli.ts` (sin framework CLI, parse manual).
- Schema SQLite v1: `meta(k,v)`, `specs(id,ver,title,path,status)`, `tasks(id,spec_id,spec_ver,title,scenario,estado,owner)`, `evidences(task_id,cmd,exit,sha256,verdict,created_at)`, `decisions(id,title,status)`, `consumo(unit,tokens,calls)`, `bloqueos(id,task_id,causa)`.
- `init` es idempotente y no sobrescribe spec aprobada.
- Tests: `node --test` en `test/*.test.js` compilado o directo TS via tsx? Para A1 mínimo: build tsc + node --test dist.
