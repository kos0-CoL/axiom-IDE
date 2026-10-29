# Axiom IDE — E5 Arquitectura conceptual

**Fecha:** 2026-10-20
**Base:** v0.2 §§4-6 + E3 + E4 + UI-SPEC
**Estado:** Propuesta revisable, sin código.

## 1. Componentes (TS + Node)

```
cli/ → broker/ → policy/ → adapters/{langgraph,mcp,litellm,ollama} → sandbox/{local|docker}
  ↓         ↓         ↓
store(sqlite+MD)  traces(OTel/Langfuse opt)  ui-tui + telegram-transporte
```

- `contracts`: `Agent{id,kind:orchestrator|node|ephemeral,model,scope}`, `Tool{name,ZodIn,ZodOut,risks}`, `Policy{global,project}`, `Evidence{cmd,output_hash,verdict}`, `Budget{asignado,reservado,consumido}`, `Approval{id,riesgo,quien,cuando}`.
- `adapters`: LangGraph para DAG+checkpoints/pause; MCP stdio local; LiteLLM gateway opcional; Ollama local. Interfaz común `AgentAdapter.spawn(task, budget)` para cambiar proveedor sin tocar specs.
- `broker.check(tool,scope,policy)` → `allow|deny|ask(id)`. Único punto de decisión. Loguea IO resumido.
- `sandbox.spawn(spec)` con drivers intercambiables; MVP `docker` según E4 §5.
- `store`: SQLite tablas `requisitos,historias,specs_versiones,tareas,deps,codigo,tests,evidencias,decisiones,consumo,bloqueos,aprobaciones,componentes` + MD `specs/active/<id>/` + `docs/decisions/ADR-*`. API `trace(tarea_id)` recorre grafo completo.
- `ui-tui` y `telegram` leen mismo store, no tienen estado propio.

## 2. Flujos de datos

1. `MD inicial → specify → clarify? → plan → checklist? → tasks → analyze? → implement(jail) → verify(evidencia) → accept(humano si ALTO)`.
2. Tool call: `agente → broker.check → [allow: sandbox → store evidencia | ask: cola aprobación TUI+Telegram → revalida → ejecuta | deny: audit]`.
3. Bloqueo: `fallo → clasifica dependientes → aísla → continúa independientes → informe ronda`.
4. Promoción: `temporal(archiva) → propone local (evalúa vs estable) → propone global (evalúa+compat+aprobación)` con rollback.

## 3. Estado persistente y trazabilidad

SQLite es fuente de verdad operativa; MD es legible/auditable. `archivar≠borrar`, `recuperar≠vigente` con `versión,fecha,relaciones,estado:provisional|validado|obsoleto|rechazado`.
`axiom status --trace` responde: requisito→spec:ver→tarea→diff→test→evidencia hash→decisión→consumo→bloqueo.

## 4. Contratos mínimos (Zod, sin código aún)

`Tool{ name, description, input:Zod, output:Zod?, annotations:{readOnly,destructive,idempotent,openWorld} }`
`PolicyCheck{ tool, scope:{workspace,red}, policyVersion } → {allow|deny|ask,id?}`
`Evidence{ task_id, spec_ver, cmd, exit, output_sha256, verdict:pass|fail }`
`BudgetReserve{ unit_id, p50,p90, reserved_verify:20% }`

Siguiente: E6 plan granular por fases A-D con aceptación.
