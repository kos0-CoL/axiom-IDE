# Spec: etapa4-propose-probe-compose

## Contexto
Ante un fallo hoy se reintenta lo mismo hasta pausar. Falta el ciclo
Harness² en pequeño: proponer 2 variantes (de prompt o de skill), probarlas
contra el validator (probe barato) y componer la ganadora, registrando la
lección en EXPERIENCE.md con su evidencia. Presupuesto fijo de variantes
por fallo para no quemar tokens. Reutiliza `src/nodes/*`,
`src/experience.ts` y `src/orchestrator/`.

## Criterios de aceptación
- [ ] src/orchestrator/variantes.ts
- [ ] test/propose-probe-compose.test.ts
- [ ] scripts/demo-variantes.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Ante fallo de validación: propone 2 variantes, las prueba, compone la que
  pasa y sigue el build; si ninguna pasa, pausa como hoy.
- La lección queda en EXPERIENCE.md con evidencia (qué variante ganó y por
  qué), integrable a `agents experience/propuestas`.
- Demo con LLM stubbed: una tarea que falla con el prompt base pasa con una
  variante. Tests en verde + `tsc` limpio.
