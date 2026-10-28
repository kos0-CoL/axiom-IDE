# Spec: etapa7-variantes-en-orquestador

## Contexto
Hoy el orquestador valida → cuenta fallo → pausa tras 3; `probarVariantes` y
`componerAnteFallo` existen sueltos y nadie los llama. Esta etapa los mete en
el bucle: ante un fallo de validación prueba 2 variantes (reintento del coder
+ saneado local barato) y compone la ganadora sin contar fallo; solo pausa si
ninguna pasa, con la lección en EXPERIENCE.md. Reutiliza
`src/orchestrator/variantes.ts`, `src/nodes/validator.ts` y el contador de
fallos seguidos de `src/orchestrator/orchestrator.ts`.

## Criterios de aceptación
- [X] src/orchestrator/variantes.ts (versión async)
- [X] src/orchestrator/orchestrator.ts (variantes ante fallo de validación)
- [X] test/variantes-orquestador.test.ts
- [X] scripts/demo-build-variantes.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Un código que falla con cháchara pero se salva saneado se escribe y marca
  sin contar fallo; si ninguna variante pasa, pausa como hoy.
- La lección queda en EXPERIENCE.md con evidencia de probes.
- Tests en verde + `tsc` limpio.
