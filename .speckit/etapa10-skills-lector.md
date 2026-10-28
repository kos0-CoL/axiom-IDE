# Spec: etapa10-skills-lector

## Contexto
`src/modules/skills/frontmatter.ts` y `runner.ts` no los usa el producto: el
lector sigue con su parser viejo y no hay entrada para correr scripts. Esta
etapa los cablea: `leerArchivo` acepta el formato estándar (frontmatter
`name/description`, fallback al viejo), `guardarSkill` escribe estándar, y
`axiom skills run <id> <script> [--dry-run]` ejecuta vía runner. Reutiliza
`src/modules/skills/index.ts`, `frontmatter.ts`, `runner.ts` y el patrón
`cmd`/`cli.ts`.

## Criterios de aceptación
- [X] src/modules/skills/index.ts (frontmatter + scripts)
- [X] src/commands.ts (cmdSkillsRun) + src/cli.ts (ruta run)
- [X] test/skills-lector.test.ts
- [X] scripts/demo-skills-run-cli.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Una skill guardada en formato estándar se lee con su descripción y cuerpo;
  las viejas se siguen leyendo sin cambios.
- `axiom skills run <id> <script>` ejecuta con timeout/entorno filtrado;
  scripts destructivos exigen `--dry-run`.
- Tests en verde + `tsc` limpio.
