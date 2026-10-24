# AGENTS.md — Axiom harness (MVP-0)

Comandos probados (Bun 1.4+):
- `bun install && bun run build`
- `bun src/cli.ts --root <dir> init|spec|plan|tasks|verify|run|check|approve|reject|cycle|comp|telegram|adapters|module|ui|status|validate-spec|serve|validate-tokens|validate-openapi (flags: --rondas, --tokens, --calls, --cmd, --image, --timeout, --dry-run, --detalle, --archivos)`
- `node scripts/check-boundaries.mjs`

Reglas:
- Global > proyecto; sin respuesta ≠ aprobación; Telegram es canal.
- Sin evidencia (cmd+sha+veredicto) no hay verificado/aceptado.
- Boundaries en `scripts/check-boundaries.mjs`; cli.ts es composition root.
- Specs en `specs/active/<id>/spec|plan|tasks|verification-*.md`; ADRs en `docs/decisions/`.
- No commitear `node_modules/`, `dist/`, `*.db`. No secretos en capas/imágenes.
- Doble eje en PR: Standards vs Spec, sin re-rankear.
