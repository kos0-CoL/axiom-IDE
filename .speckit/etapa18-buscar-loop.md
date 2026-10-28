# Spec: etapa18-buscar-loop

## Contexto
El tool-loop ofrece `leer` y `delega`; `buscar` quedó fuera. Esta etapa lo
añade como tercera herramienta real: el modelo pide
```tool {"tool":"buscar","consulta":"..."} y el runner autoriza en el broker
(una vez por llamada, con BUSCAR_CONTRACT openWorld) y ejecuta
`buscarExterno` (EXA server-side, highlights, topes ya probados). Sin key
o fallo de red el error vuelve como dato, no tumba el loop. `ask` (lo
normal: openWorld es riesgo alto) aborta con el id de aprobación, igual
que las demás tools.

## Criterios de aceptación
- [X] src/modules/agents/tool-loop.ts (buscar como tercera tool)
- [X] src/modules/agents/ejecucion.ts (ejecutor real + falsos.buscar)
- [X] test/tool-loop.test.ts (casos nuevos)
- [X] scripts/demo-tool-loop.mjs (turno con buscar)

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Solo se ofrece si el agente la declara (no-denegada); el prompt no la
  lista en caso contrario.
- Una autorización del broker por llamada (la del loop); el ejecutor llama
  al `buscarExterno` crudo, sin doble gate.
- Sin EXA_API_KEY: error como dato, el loop sigue.
- Tests en verde + `tsc` limpio.
