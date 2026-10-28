# Spec: etapa16-clarify-propone

## Contexto
`axiom clarify` solo lee marcas `[NEEDS CLARIFICATION]`; si la spec no las
trae, no pregunta nada aunque sea ambigua. Esta etapa le da detección
propia: sin marcas, el clarificador pide al proveedor (UNA llamada vía
`preguntar` inyectada, producción `spawn`) que liste las ambigüedades en
las categorías spec-kit (alcance, roles, datos, integraciones, UX,
seguridad, despliegue), y las entrevista igual que las marcas (formato
Question + Why it matters + Short, máx 5, persiste `## Clarifications`).
Reutiliza `formatearPregunta`, `aplicarRespuesta`, `MAX_PREGUNTAS` y el
loop readline de `cmdClarify`.

## Criterios de aceptación
- [X] src/modules/clarify/index.ts (proponerPreguntas + marca sintética)
- [X] src/commands.ts (cmdClarify propone sin marcas; construirClarify intacto)
- [X] test/clarify.test.ts (casos nuevos)
- [X] scripts/demo-clarify.mjs (muestra proponer sin red)

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Sin marcas y con proveedor: propone, entrevista y persiste igual que
  marcas (respuestas/«saltar»/corte en 5).
- Proveedor sin respuesta válida (vacío, no-JSON, sin preguntas útiles) o
  sin proveedor: informa y no toca nada (fail closed).
- Preguntas propuestas malformadas (vacías, >200 caracteres, duplicadas)
  se filtran; nunca más de 5.
- Tests en verde + `tsc` limpio.
