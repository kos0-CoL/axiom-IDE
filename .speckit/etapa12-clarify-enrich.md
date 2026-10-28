# Spec: etapa12-clarify-enrich

## Contexto
Faltan dos comportamientos reales: (a) nadie pregunta al usuario ante
ambigüedad — `clarify` solo existe como palabra en un template; (b) el
enrich no alimenta ningún prompt productivo. Esta etapa: `axiom clarify`
entrevista una por una las marcas `[NEEDS CLARIFICATION]` de una spec
(formato spec-kit: pregunta + por qué importa + respuesta corta, máx 5,
persiste `## Clarifications` y sustituye la marca), y el modo Plan del chat
antepone el contexto de `enriquecerConBusqueda` cuando el broker lo permite
(best-effort: sin key/aprobación sigue como hoy). Además adopta de la
investigación: pedir `highlights` a EXA y preferirlos al texto crudo.
Reutiliza `enriquecerConBusqueda`, `promptPara`+spawn del handler
`api/chat/enviar`, `guardarPropuesta` y el patrón `cmd`/`cli.ts`.

## Criterios de aceptación
- [X] src/modules/clarify/index.ts
- [X] src/commands.ts (cmdClarify) + src/cli.ts (ruta clarify)
- [X] src/modules/buscar/index.ts (highlights + enriquecerPromptPlan)
- [X] src/web.ts (enrich en modo Plan)
- [X] test/clarify.test.ts + test/buscar-enrich.test.ts (4+1 casos nuevos)
- [X] scripts/demo-clarify.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- `axiom clarify <spec>` pregunta cada marca, acepta respuesta/“saltar”,
  persiste `## Clarifications` con fecha y quita la marca; sin marcas informa
  y no toca nada; a la 5ª corta aunque queden.
- Modo Plan con enrich permitido: el prompt lleva el bloque de referencias;
  pendiente/denegado: sigue sin él y lo anota.
- Auditoría de stubs: ningún export nuevo devuelve vacío sin motivo
  testeado. Tests en verde + `tsc` limpio.
