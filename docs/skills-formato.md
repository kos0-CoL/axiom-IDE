# Formato de skills (estándar Agent Skills, compatible hacia atrás)

Un skill es `skills/<id>/`:

- `SKILL.md` con frontmatter + cuerpo (estándar):
  ```md
  ---
  name: mi-skill
  description: qué enseña, una línea
  compatibility: axiom>=0.9 (opcional)
  ---

  Instrucciones que recibe el agente…
  ```
- `scripts/` (opcional): scripts deterministas ejecutables por el runner.
- `references/` y `assets/` (opcional): material de consulta, no ejecutable.

Compatibilidad: se siguen aceptando SKILL.md viejos (formato Axiom
`# SKILL:` / `Objetivo:` o texto libre). El lector nuevo no rompe nada.

## Carga progresiva

1. El selector solo ve `name` + `description` (una línea).
2. Al activar el skill se lee el cuerpo.
3. Solo si la tarea lo pide se ejecuta `scripts/<x>` vía runner.

## Runner (`src/modules/skills/runner.ts`)

- `cwd` = raíz del skill; el path no puede escapar (`resolverScriptSkill`).
- Timeout del supervisor (defecto 15 s).
- Scripts destructivos (`rm -rf`, `DROP TABLE`, …) exigen `dryRun:true` y
  aun así no se ejecutan: devuelven `[dry-run]`.
- Entorno filtrado: solo `PATH`/`HOME` + `envPermitido` explícito; cualquier
  variable `*KEY*/*SECRET*/*TOKEN*/*PASSWORD*` se ignora aunque se pida.
- El resultado registra el `sha256` del script ejecutado (trazabilidad).

Esto es **aislamiento de proceso + límites, no un contenedor**: para
ejecución no confiable hace falta sandbox real (fuera del alcance).

## Regla de secretos

Nunca se listan valores, solo presencia: `OPENROUTER_API_KEY=presente`
sí, el valor jamás. El runner tampoco vuelca el entorno al log.
