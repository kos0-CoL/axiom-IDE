# Axiom IDE — E6 Plan de implementación

**Fecha:** 2026-10-20
**Base:** E2+E3+E4+E5 + UI-SPEC
**Estado:** Propuesta revisable, sin código.

## Fase A — harness CLI (S1-2) [AXM-001..005,010..014,020..024,060..063]
- A1 contratos Zod + `axiom init/status/validate-spec` + SQLite schema. Acept: init en vacío sale 0, trace vacío OK.
- A2 preset axiom SpecKit (overrides estados + verification) + `spec/plan/tasks/run/verify`. Acept: flujo MD→verify con 3 rondas e informe.
- A3 broker+policy+techos + test negativo global>proyecto. Acept: proyecto no elude global, ciclos paran en 3 idénticos.

## Fase B — vistas (S2-3) [AXM-030,031,064,065]
- B1 store→TUI 2 vistas mismo SQLite + consola broker. Acept: §6 UI-SPEC 1-5, sin verde sin hash.
- B2 CI `markdownlint+lychee+Spectral+validate-spec` + boundaries. Acept: PR fuera-boundary falla.

## Fase C — Telegram (S3) [AXM-024,040,066]
- C1 bot `/status /bloqueos /consumo` + aprobar/rechazar con ID → broker revalida. Acept: audit quién/cuándo/ID, timeout=deny.

## Fase D — componentes (S3-4) [AXM-032,033,050..052]
- D1 scopes temporal/local/global + eval aislada Docker vs estable + rollback. Acept: rollback demo a estable, fábrica+en uso protegidas.

## Salida MVP-0 (8 criterios E2 §5)
init OK, flujo con informe, bloqueo aísla, sin evidencia=no aceptado, jail checklist, Telegram correlacionado, test negativo, rollback demo.

Riesgos: LangGraph vs CrewAI (spike 1 día), LiteLLM Enterprise (revisar licencia), Microsandbox beta (posponer a post-MVP).
Siguiente tras aprobar E6: TECH por fase → código A1.
