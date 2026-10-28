# Spec: etapa13-stream-principal

## Contexto
`/api/build/stream` solo existe en `crearServidorBuild`, un servidor aparte
que nadie levanta; `axiom serve` no lo expone. Esta etapa monta la misma ruta
en el servidor principal (`startWeb`) con el proveedor configurado
(`generarCodigoLLM` real), refactorizando el handler para compartirlo sin
duplicar: `manejarBuildStream(root, req, res, generarCodigo)` en
`src/server/build-events.ts`, usado por ambos servidores. Reutiliza run-log,
`reanudarBuild`, `?resume=1` y `?run=` ya probados.

## Criterios de aceptación
- [X] src/server/build-events.ts (handler compartido)
- [X] src/web.ts (ruta GET /api/build/stream)
- [X] test/build-stream-web.test.ts
- [X] scripts/demo-build-stream-web.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- `startWeb` expone `GET /api/build/stream?spec=…[&resume=1]` con SSE en el
  orden status→…→complete/pausa y run-log persistido; sin duplicar lógica.
- `crearServidorBuild` sigue funcionando igual (delega en el handler).
- Sin clave de proveedor no hay red: el build pausa con error claro.
- Tests en verde + `tsc` limpio.
