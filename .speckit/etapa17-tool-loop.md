# Spec: etapa17-tool-loop

## Contexto
`ejecutarConRoster` y el paso delegado de `ejecutarTareaGrafo` hacen UN
solo `spawn`: el especialista no puede leer un archivo ni delegar a mitad
de razonamiento. Esta etapa les da loop ReAct por prompting (sin
function-calling nativo en los adapters): el prompt ofrece herramientas,
el runner parsea bloques ```tool JSON, autoriza cada llamada en el
broker, la ejecuta de verdad, devuelve el resultado como dato y repite
hasta que el modelo responde sin bloques (ese texto es el trabajo final).
Herramientas v1: `leer` (fs real, sandbox al root, tope 20 KB) y
`delega` (especialista real de una pasada). `buscar` queda fuera (exige
EXA + aprobación mid-loop; se añade cuando el loop pida red).

## Criterios de aceptación
- [X] src/modules/agents/tool-loop.ts (motor puro con deps inyectadas)
- [X] src/modules/agents/ejecucion.ts (leerArchivoSandbox + ejecutarAgenteConTools + uso en el paso delegado)
- [X] src/orchestrator/agent-tool.ts (ejecutarConRoster con loop opt-out)
- [X] test/tool-loop.test.ts
- [X] scripts/demo-tool-loop.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Sin bloques tool en la respuesta: UN spawn, texto intacto (compatible).
- `leer` devuelve contenido real acotado; fuera del root o inexistente =
  error como dato, no throw del loop.
- Cada llamada se autoriza (deny/no-declarada/ask-sin-aprobación aborta
  con el motivo del broker); tope de turnos aborta sin alucinar trabajo.
- Presupuesto: maxTurnos 4 / 3 por turno / 6 totales por defecto; cada
  spawn registra su consumo igual que hoy.
- `buscar` NO se ofrece en v1; el prompt solo lista lo disponible.
- Tests en verde + `tsc` limpio.
