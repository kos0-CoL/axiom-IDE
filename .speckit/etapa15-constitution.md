# Spec: etapa15-constitution

## Contexto
No hay principios persistentes: `EXPERIENCE.md` es bitácora de lecciones,
no manda. Esta etapa copia lo verificable de `github/spec-kit` (plantilla
`constitution.md`, SemVer de gobernanza, lectura bajo demanda en
specify/plan/implement): `.specify/memory/constitution.md` con principios
numerados en romanos, `Rationale`, `Governance` y línea
`Version: MAJOR.MINOR.PATCH | Ratified: YYYY-MM-DD | Last Amended:
YYYY-MM-DD`. Añadir→MINOR, enmendar/quitar→MAJOR, `Ratified` se conserva.
El plan y el build del chat la reciben como contexto/restricción; `ask`
queda fuera (solo lectura, igual que spec-kit no la impone en todo).

## Criterios de aceptación
- [X] src/constitution.ts (leer/fijar/enmendar/quitar + bloque para prompts)
- [X] src/cli.ts (axiom constitution …)
- [X] src/sessions.ts (promptPara acepta constitucion en plan/build)
- [X] src/web.ts (plan y build anteponen la constitución vigente)
- [X] test/constitution.test.ts
- [X] scripts/demo-constitution.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Primera redacción 1.0.0 con Ratified; añadir sube MINOR, enmendar o
  quitar sube MAJOR; Ratified nunca cambia, Last Amended sí.
- Entradas inválidas (vacías, duplicadas, romano inexistente, límites)
  fallan cerrado sin tocar el archivo; quitar renumera I..N.
- Sin constitución el prompt sale como hoy (bloque vacío, sin red ni error).
- Tests en verde + `tsc` limpio.
