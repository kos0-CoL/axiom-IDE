# Axiom IDE — Entregable 2: Alcance MVP + Arquitectura + Plan

**Fecha:** 2026-10-20
**Base:** Documento Maestro v0.2 + decisiones 2026-10-20
**Estado:** Propuesta revisable, no autoriza código todavía (según método §17)

## 0. Decisiones fijadas el 2026-10-20 (no volver a preguntar)

- Stack harness: **TypeScript + Node 22.5+ con npm**. SpecKit (Python) se integra como preset/extensión, no se reescribe.
- MVP-0 incluye: harness CLI sin editor + vista orquestación + vista trabajo + Telegram aprobaciones + marketplace/evaluación componentes.
- Aislamiento: **Docker + workspace jail** por defecto.
- Persistencia: **SQLite + archivos MD**.
- LLMs: **multi-API vía LiteLLM + local (Ollama)**.
- Updates: **pinned + evaluación aislada**.

Skills aplicadas en este diseño:
- `implement-specs`: specs en `specs/<ID>/PRODUCT.md + TECH.md`, mismo PR specs+código.
- `mcp-builder`: tools MCP en TS, Zod, stdio local / HTTP stateless, anotaciones readOnly/destructive.
- `docker-patterns`: imágenes pineadas por digest, non-root, read-only, cap_drop ALL, workspace RO + copia a tmpfs, network none por defecto.
- `telegram-bot`: BotFather, comandos /start /status /approve /reject, inline keyboard para aprobar, Telegram = canal no permiso.
- `frontend-design` + `tailwind-design-system`: TUI/web sobria, tokens en `@theme`, una sola idea memorable (grafo trazable).
- `code-review`: doble eje Standards vs Spec en cada PR.
- `orchestration`: DAG supervisado, gates de decisión, coordinator loop (referencia vía `orca skills get orchestration` cuando se use orca-cli).

## 1. Qué reutilizamos (gratis)

**SpecKit** `github/spec-kit` MIT: `constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge`. Artefactos `spec.md/plan.md/tasks.md`, estado en `.specify/feature.json`, precedencia `overrides > presets > extensions > core`.
→ Axiom aporta preset `axiom` (overrides con estados implementado/verificado/aceptado/bloqueado + `verification.md` obligatoria + 3 rondas integración) + extensión (gates, hooks) + integración `generic --commands-dir`.

Resto:
- Orquestación: LangGraph (MIT) — estado, checkpoints, pause/resume. Alternativa CrewAI.
- Tools: MCP TS SDK. Servers oficiales solo referencia, endurecer.
- Sandbox: Docker para MVP (Microsandbox/E2B evaluados después).
- Presupuesto LLM: LiteLLM gateway opcional. Límites propios Axiom para pasos/tools/tiempo/concurrencia.
- Trazas: Langfuse + OTel Collector.
- Memoria: SQLite + MD. sqlite-vec solo si hace falta semántica. Mem0/Letta como subsistema futuro.
- Limpieza grandes: AGENTS.md corto, ADRs MADR, monorepo apps/+packages/, boundaries Nx, Gherkin aceptación vs verificación, CI markdownlint+lychee+Spectral+validador specs.

## 2. MVP-0 por fases (mínimo pero escalable)

**Fase A — harness CLI (semana 1-2)**
- `axiom init|spec|plan|tasks|run|verify|status` envolviendo `specify`.
- `axiom.json` + `policies.global.json` + `project.json`. Global prevalece.
- Broker permisos por operación: allowlist, scope workspace, secretos fuera del agente, log IO.
- Store SQLite: `requisito→tarea→código→test→evidencia→decisión→consumo→bloqueo`.
- Estados diferenciados + `verification.md` con evidencia, no afirmación.

**Fase B — vistas (semana 2-3)**
- TUI (o web mínima Tailwind v4) con dos vistas mismo estado: orquestación (nodos, delegaciones, modelos, consumo) + trabajo (specs, tareas, bloqueos, pruebas).
- Autoaprobación OFF. Sin respuesta ≠ aprobación.

**Fase C — Telegram canal (semana 3)**
- Bot: `/status /bloqueos /consumo`, notificaciones + botones Aprobar/Rechazar/Cambios con ID correlación. Toda aprobación pasa por broker, no solo UI.

**Fase D — componentes versionados (semana 3-4)**
- Scopes temporal/local/global. Crear ≠ activar global. Evaluación aislada Docker, compara calidad/coste/errores, rollback, conserva fábrica + en uso.

**Explícitamente FUERA de MVP-0:** editor código, marketplace público comunitario, auto-optimización estructural del orquestador, multi-proyecto distribuido, vector DB servida.

## 3. Arquitectura mínima

```
axiom/ (TS, Node)
  src/contracts/  Agent, Tool(Zod), Policy, Evidence
  src/adapters/   langgraph.ts, mcp.ts (stdio), litellm.ts (gateway opcional), ollama.ts
  src/broker/     check(tool,scope,policy) → allow|deny|ask
  src/sandbox/    driver docker (jail workspace), interfaz para microvm futura
  src/store/      sqlite (better-sqlite3) + MD specs/active/<id>/
  src/policy/     global>proyecto, contadores separados, techo agregado anti-multiplicación
  src/ui-tui/     orquestación + trabajo
  src/telegram/   solo transporte hacia broker
.specs/ + specs/active/<id>-slug/spec|plan|tasks|verification.md
docs/decisions/ADR-*.md (MADR)
```

Contabilidad rondas (resuelve auditoría §2 v0.2):
`presupuesto_total = min(global, proyecto) ; ronda_integración(1..3) × intentos_agente(n) ≤ techo_agregado`. Paralelismo no multiplica permisos. Detección ciclos (hash error+diff) detiene antes del máximo.

Matriz riesgo→aprobación propuesta:
- bajo (lectura, tests locales jail): auto.
- medio (escribir código aislado, instalar dep pinned): aprobación proyecto o regla auto si habilitada.
- alto (migración, publish, cambio seguridad, red externa, promoción global): aprobación humana explícita (TUI o Telegram con ID).

## 4. Entorno limpio y operable (lo que muchos fallan)

- `AGENTS.md` <150 líneas: comandos probados, mapa, dónde cargar spec.
- Un spec por cambio. Contexto activo = spec actual + archivos tocados + últimos tests. Archivo = ADRs + specs cerradas, con procedencia, nunca auto-verdad.
- Fronteras por CI (Nx boundaries / eslint), no por prompt.
- CI: markdownlint, lychee, Spectral OpenAPI, `axiom validate-spec` (falla si falta ID, criterios observables, link tarea→requisito), tests paquetes afectados.
- Aceptación (Gherkin observable) ≠ verificación (tests+build+evidencia). Agente no juez único → code-review doble eje.

## 5. Criterios salida MVP-0

1. `axiom init` crea proyecto con `.specify/` + preset axiom + SQLite.
2. Flujo MD→spec→plan→tasks→implement→verify con 3 rondas y informe al fallar.
3. Bloqueo aísla dependientes, resto continúa, estado reanuda tras reinicio.
4. Sin pruebas ≠ éxito; tarea no se marca aceptada sin evidencia + aprobación.
5. Docker jail verificado: RO source, tmpfs writable, no-net default, non-root.
6. Telegram aprueba/rechaza con correlación, auditado en SQLite.
7. Límites globales no eludibles desde proyecto (test negativo).
8. Rollback componente demo funciona.

## 6. Plan siguiente (según método v0.2)

E3 Requisitos con IDs + E4 Modelo políticas formal + E5 Arquitectura detallada + E6 Plan implementación granular. Luego TECH.md por fase y recién código Fase A.
