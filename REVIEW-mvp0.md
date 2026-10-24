# Review MVP-0 — doble eje (Standards vs Spec)

**Fecha:** 2026-10-20 — Sin git (no hay fixed point); revisión manual contra AGENTS.md + E3. Build 0 + boundaries OK verificados.

## Standards (¿sigue las normas del repo?)

- AGENTS <150 líneas, comandos probados, boundaries declarados: **pass**.
- `cli.ts` composition root con lógica de más: **juicio** — posible Divergent Change a futuro (aceptable en MVP-0, extraer `commands/` en B-web).
- Imports relativos con `.js`, `strict`, sin `any` salvo filas SQLite: **pass** (Primitive Obsession justificadas por etapa).
- Sin secretos en código, sin `node_modules/dist/*.db` en repo (gitignore): **pass**.
- Peor Standards: `cmdRun` mezcla techo+evidencia+informe (Feature Envy leve de policy/store). No bloquea.

## Spec (¿hace lo pedido en E3/E6?)

- AXM-001 init, 002 flujo, 004 Gherkin, 005 verification hash: **pass** (verificado /tmp).
- AXM-010 estados, 011 bloqueo+informe, 013 3 rondas (ronda 1 real): **parcial** — rondas 2-3 no reintentan solas.
- AXM-020 global>proyecto + negativo, 022 techo, 024 expiración: **pass**.
- AXM-023 reserva 20%: **parcial** — chequeada, sin ingesta real.
- AXM-030/031 vistas mismo store, 040 Telegram canal, 050-051 componentes+rollback: **pass** texto/transporte.
- Fuera de alcance respetado (sin editor, sin marketplace público, sin vector): **pass**.
- Peor Spec: rondas 2-3 automáticas ausentes.

## Veredicto

MVP-0 funcional aceptado con 2 parciales conocidos (rondas 2-3, ingesta consumo). Nada que re-rankee: Standards no tapa Spec ni viceversa. Siguiente: B-web o v0.3 Maestro.
