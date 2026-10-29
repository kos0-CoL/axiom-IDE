# AGENTS.md — Axiom harness (MVP-0)

Comandos probados (Node 24 + npm; es el gestor que usa el CI):
- `npm install && npm run build`
- `node dist/cli.js --root <dir> init|spec|plan|tasks|verify|run|check|approve|reject|cycle|comp|telegram|adapters|module|ui|status|validate-spec|serve|browser|grafos|memory|validate-tokens|validate-openapi (flags: --rondas, --tokens, --calls, --cmd, --image, --timeout, --dry-run, --detalle, --archivos, --url, --dom, --keep)`; durante el desarrollo, `npm run dev -- --root <dir> …` corre el mismo CLI desde `src/`
- `node scripts/check-webjs.mjs` (o `npm run check:webjs`): valida el `<script>` inline de la página servida con `vm.Script` + marcadores; `tsc` no ve una comilla de más dentro de ese string. Corre dentro de `npm test`, después del build.
- `node scripts/check-boundaries.mjs`
- `npm run evals` (suite con línea base: compara contra `evals/baseline.json`; `-- --write-baseline` la reescribe solo si todo pasa, `-- --no-build` usa dist actual). Regresión = caso ok en base que ahora falla.

Reglas:
- Global > proyecto; sin respuesta ≠ aprobación; Telegram es canal.
- Sin evidencia (cmd+sha+veredicto) no hay verificado/aceptado.
- Boundaries en `scripts/check-boundaries.mjs`; cli.ts es composition root.
- Specs en `specs/active/<id>/spec|plan|tasks|verification-*.md`; ADRs en `docs/decisions/`.
- Modelo por agente: `axiom agents define <id> modelo <id-del-modelo|hereda-proveedor>`; el spawn lo usa y `hereda-proveedor` cae al modelo global.
- Skills por proyecto: `skills/<id>/SKILL.md` sobreescribe el catálogo y es lo que recibe el prompt; `axiom skills` lista, ver/editar en Ajustes → Skills, `axiom skills borrar <id>` quita el override.
- No commitear `node_modules/`, `dist/`, `*.db`. No secretos en capas/imágenes.
- Doble eje en PR: Standards vs Spec, sin re-rankear.
