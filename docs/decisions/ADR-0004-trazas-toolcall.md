# ADR-0004 — Trazas de tool call locales (AXM-066), sin OTel aún

Fecha: 2026-10-27
Estado: aceptado
Relación: cierra el gap "Observabilidad / tracing" ⚠️ de ADR-0002 (E3 AXM-066 [P1]).

## Contexto

El criterio de AXM-066 es exigible y verificable: **cada tool call deja traza con
IO resumido**. La auditoría marcaba el eje como ⚠️ porque `status --trace` y
`handoff_log` respondían la cadena de una tarea, pero no qué herramienta corrió,
con qué decisión y con qué entrada/salida. E5 preveía OTel/Langfuse como
*opcional*; E3 los marca P1 solo el criterio de la traza, no el export.

## Decisión

Traza **local-first en SQLite** (`trace_log`), sin dependencias nuevas:

1. **Punto único de escritura:** `broker.check()` — por donde pasa toda
   autorización (CLI `axiom check`, `run --agente` vía `autorizarUso`,
   handoff, telegram) — y `consumirAprobacion()` para el uso real de una
   aprobación (sin esa fila, `status --trace` vería la solicitud pero no el uso).
2. **IO resumido + sha del completo:** cada fila guarda un resumen acotado a
   500 caracteres (con `…(+N B)` de lo omitido) y el **sha256 del IO completo**:
   trazable byte a byte sin crecimiento descontrolado. Retención: últimas 500
   (mismo criterio que `uso_log`).
3. **Best-effort:** una traza que no se escribe jamás rompe la decisión que la
   produjo (mismo principio que "la memoria nunca rompe el verify").
4. **Consulta:** `axiom status --trace <tarea>` añade `trazas=N` y lista las
   trazas cuyo `contexto` nombra la tarea (p. ej. `run <spec>/<tarea>`);
   `axiom status --trace` sin id muestra las últimas 10 globales. La misma
   consulta sirve la web: `GET /api/trazas` (openapi) y la vista **Trazas** del
   panel reutilizan `listTrazas` + `lineaTraza`, así que CLI y panel no
   divergen ni en la query ni en el formato.

## Consecuencias

- El criterio de AXM-066 es verificable desde CLI: qué tool, quién, qué decidió,
  cuánto tardó y el IO, en una línea por llamada.
- **Fuera de alcance, deliberadamente:** export OTel/Langfuse (el stack entero
  sigue siendo opcional en E5; añadirlo no cambia el criterio) y compaction de
  memoria (gap aparte de ADR-0002).
- Cubierto por `test/trazas.test.ts` (5 tests), `test/trazas-api.test.ts`
  (GET /api/trazas + vista del panel) y en `npm run evals` por los casos
  `trazas-toolcall` (CLI) y `api-trazas` (servidor real: endpoint + vista +
  filtro y límites) — suite de 18 casos en 5 grupos, los 18 presentes en la
  línea base actual; sin proveedor LLM el grupo trayectoria se omite justificado.
