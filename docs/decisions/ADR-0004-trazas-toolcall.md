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

## Turnos: id de correlación (2026-10-28)

Una traza dice qué herramienta corrió; no decía **a qué pedido pertenecía**. El
vínculo era `contexto` (texto libre, p. ej. `run <spec>/<tarea>`), que se rompe
con cualquier cambio de formato. Se añadió la tabla `turnos` y la columna
`trace_log.turno_id` (migración por columna, las filas viejas quedan en `''`):

- **Un turno = un pedido.** `nuevoTurnoId()` (`t-xxxxxxxx`) se crea antes de
  llamar al modelo, de modo que un turno fallido también deja fila. Guarda
  sesión, ids de los mensajes de usuario y de respuesta, proveedor/modelo, sha256
  del prompt efectivo (no el prompt), tokens con cache, costo, nº de llamadas al
  modelo y de herramientas, `ok`/`error` y duración.
- **El id viaja a las trazas:** `ejecutarAgenteConTools` lo pasa a
  `autorizarUso` → `broker.check`/`consumirAprobacion`; el chat lo escribe en su
  fila. `trazasDeTurno(root, id)` devuelve la cadena sin matching de texto.
- **Consulta:** `axiom status --trace` lista los últimos 5 turnos con sus trazas
  anidadas (`lineaTurno`); `lineaTraza` añade `turno=<id>` cuando existe.
- **Best-effort igual que la traza:** un turno que no se escribe nunca rompe la
  respuesta que lo produjo. Retención: 500 turnos, la escala de `trace_log`.

## Consecuencias

- El criterio de AXM-066 es verificable desde CLI: qué tool, quién, qué decidió,
  cuánto tardó y el IO, en una línea por llamada; y con qué pedido se
  correlaciona (`turno=`).
- **Fuera de alcance, deliberadamente:** export OTel/Langfuse (el stack entero
  sigue siendo opcional en E5; añadirlo no cambia el criterio) y compaction de
  memoria (gap aparte de ADR-0002).
- Turnos cubiertos por `test/turnos.test.ts` (5 tests: correlación en el
  broker, persistencia y formato, best-effort, migración de `turno_id` y un
  turno real del chat con mensaje/respuesta enlazados).
- Cubierto por `test/trazas.test.ts` (5 tests), `test/trazas-api.test.ts`
  (GET /api/trazas + vista del panel) y en `npm run evals` por los casos
  `trazas-toolcall` (CLI) y `api-trazas` (servidor real: endpoint + vista +
  filtro y límites) — suite de 18 casos en 5 grupos, los 18 presentes en la
  línea base actual; sin proveedor LLM el grupo trayectoria se omite justificado.
