# Spec: etapa5-artefactos

## Contexto
Los scripts generados en un run hoy no se distinguen del código confiable.
Falta separarlos: fuentes versionadas vs artefactos de build con manifiesto
(versión, commit, sha256, tests), workspace por run, y promoción a skill
reutilizable solo con revisión. Reutiliza `src/server/filesystem.ts`,
`src/modules/skills/*` y lo construido en etapa 1.

## Criterios de aceptación
- [ ] src/server/manifiesto.ts
- [ ] test/artefactos.test.ts
- [ ] scripts/demo-manifiesto.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Todo script ejecutado en un run queda con hash/origen/inputs registrados
  en su workspace; el manifiesto incluye versión, commit, sha256 por archivo
  y resultado de tests.
- Un script generado no puede promoverse a skill sin revisión + tests
  (fail closed).
- Demo: build que genera un script, lo registra y bloquea su promoción sin
  revisión. Tests en verde + `tsc` limpio.
