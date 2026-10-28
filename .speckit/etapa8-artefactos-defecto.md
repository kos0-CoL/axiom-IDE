# Spec: etapa8-artefactos-defecto

## Contexto
`src/server/manifiesto.ts` es biblioteca sin llamadas productivas: ningún
build registra artefactos. Esta etapa lo mete por defecto en el orquestador:
cada `file_success` registra el archivo (sha256 + origen) y al cerrar el run
escribe el manifiesto. Reutiliza `src/server/manifiesto.ts`,
`runIdParaSpec` y el bucle de `src/orchestrator/orchestrator.ts`.

## Criterios de aceptación
- [X] src/orchestrator/orchestrator.ts (registro + manifiesto por run)
- [X] test/artefactos-defecto.test.ts
- [X] scripts/demo-build-manifiesto.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Tras un build completo, `.runs/<run>/artefactos/` tiene `registro.jsonl`
  (un sha256 por archivo escrito) y `manifiesto.json` (versión, commit,
  tests `{pasados, fallados}`).
- Un build pausado deja registro parcial sin manifiesto final.
- Tests en verde + `tsc` limpio.
