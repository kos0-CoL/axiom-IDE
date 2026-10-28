# Spec: etapa1-skills-standard

## Contexto
Axiom usa un formato casero de skills (directorio + SKILL.md sin frontmatter,
sin scripts/). El estándar Agent Skills pide frontmatter
`name/description/compatibility` + `scripts/` + `references/` + carga
progresiva. Esta etapa lo adopta sin romper lo actual y añade un runner de
scripts con límites. Reutiliza `src/modules/skills/index.ts` (lectura y
guardado) sin tocar el núcleo.

## Criterios de aceptación
- [X] src/modules/skills/frontmatter.ts
- [X] src/modules/skills/runner.ts
- [X] test/skills-standard.test.ts
- [X] scripts/demo-skill-run.mjs
- [X] docs/skills-formato.md

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- El lector acepta skills viejas (sin frontmatter) y nuevas (con frontmatter).
- `runner.ts` ejecuta con timeout del supervisor, cwd en la raíz del skill,
  `--dry-run` obligatorio para lo destructivo, y nunca expone secrets.
- Demo: instala una skill de ejemplo, corre su script y lista presencia de
  keys sin valores. Tests en verde + `tsc` limpio.
