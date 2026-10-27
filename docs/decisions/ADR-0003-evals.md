# ADR-0003 — Suite de evals del harness con línea base ejecutable

Fecha: 2026-10-27
Estado: aceptado
Relación: cierra el gap ⚠️ "Evaluación (evals)" de ADR-0002 (supera su punto 4, que lo dejaba fuera de alcance de MVP-0).

## Contexto

El checklist de awesome-harness-engineering exige que los evals se escriban antes
del cambio y que **nada se adopte sin comparación previa contra la línea base**
(skill `evaluacion` de Axiom). Axiom tenía la instrucción pero no la ejecución:
no había forma de saber, al tocar el harness, si algo se rompió más allá de los tests.

## Decisión

Suite ejecutable `scripts/evals.mjs` (`npm run evals`) que evalúa **el harness, no
un modelo**, en 4 grupos (16 casos):

1. **estático** — build (tsc), boundaries, seeds, webjs (sintaxis del `<script>` de
   la página + marcadores), superficie de módulos, openapi, tokens.
2. **contratos** — cada módulo con `datosModulo(root)`: JSON acotado ≤100 KB,
   `estadoTexto` no vacío si lo exporta (la convención la exige module-builder para
   módulos generados; el núcleo no lo llama).
3. **fail-closed** — verify con tarea inexistente, juez fallido, archivo fuera de
   allowlist, módulo browser apagado, página de error del navegador y timeout
   de red (URL que cuelga ⇒ parte de timeout + ajuste pass→fail con evidencia).
   Se ejecuta en un proyecto temporal real vía CLI.
4. **e2e** — servidor `axiom serve` + `POST /api/verify` (200/400) contra el puerto libre, y
   `trazas-toolcall` (check deja traza allow+deny y `status --trace` la consulta).

Línea base: `evals/baseline.json` (versionable), escrita con
`npm run evals -- --write-baseline` **solo si los 16 casos pasan** (una línea base
roja normalizaría el fallo).

Reglas de comparación:
- **Regresión** = caso ok en la línea base que falla ahora → run en rojo (exit 1).
- **Latencia** solo avisa (x2 y >200 ms): la latencia es ruidosa, la corrección no.
- **Omitido** (p. ej. sin motor de navegador, o `--no-build`) se justifica en el
  informe y no cuenta como fallo — el criterio del propio checklist.
- Casos nuevos quedan marcados como "sin línea base" hasta la siguiente escritura.

## Consecuencias

- El flujo "evalúa antes y después de tocar el harness" es operativo en un comando
  (~8 s); el informe distingue regresiones, mejoras y avisos de latencia.
- `evals/baseline.json` se commitea: la comparación viaja con el repo.
- Siguen **fuera, justificados**: evals de trayectoria con LLM (requieren proveedor
  configurado y runs repetidos para línea base; hoy cero en el repo). Cuando exista,
  añadir un grupo `trayectoria` con métricas de llamadas/tokens/latencia por run.
- Un caso nuevo se declara aquí (o en su PR) junto a su justificación.
