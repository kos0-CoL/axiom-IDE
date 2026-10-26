# Axiom IDE

**Axiom no es un harness que simplemente ejecuta agentes: es un entorno de desarrollo dirigido por especificación donde cada decisión, ejecución y aprobación deja evidencia verificable.**

Un harness tradicional envuelve un bucle de LLM (`prompt → spawn → output`) y confía en que el modelo acierte. Axiom añade encima las piezas que faltan para trabajar en serio con agentes:

| Capa | Qué aporta Axiom | Sin esto, un harness... |
|------|------------------|--------------------------|
| **Ciclo SDD** | `spec → plan → tasks → verify → run` con artefactos Markdown por spec | No tiene memoria de qué se pidió ni de qué quedó demostrado |
| **Evidencia con firma** | Cada `verify pass` guarda cmd + hash SHA-256 + juez en `verification-<task>.md` | Un "verde" es solo la palabra del modelo |
| **Broker de políticas** | Decisión `global AND project`, riesgo alto → `ask` (aprobación humana), techo de rondas/tokens/calls con reserva del 20% | El agente decide solo qué herramientas usar |
| **Grafo de orquestación** | Orquestador, nodos, especializados y subagentes con skills, presupuestos y handoffs auditados | Un prompt suelto sin equipo ni límites |
| **Canales** | CLI + Web + **Telegram** como canal de aprobación remota (allowlist fail-closed) | Solo interactúas desde la terminal local |
| **Módulos versionados** | `adapters`, `agents`, `grafos`, `kanban`, `speckit`, `telegram`… apagados por defecto, compat por versión | El core hay que tocarlo para extenderlo |
| **Proveedor conmutable** | Un solo proveedor LLM activo (ollama/litellm/openai/anthropic/google/openrouter) por config; cambiar no toca specs (AXM-062) | El vendor queda incrustado en el código |

> **Regla de la casa:** sin evidencia (cmd + sha + veredicto) no hay verificado/aceptado; sin respuesta no hay aprobación; Telegram es canal, no juez.

## Instalación

```bash
cd axiom
bun install && bun run build
# o con npm:
npm install && npm run build
```

## Ciclo SpecKit (Spec → Plan → Tasks → Verify → Run)

```bash
axiom init
axiom spec mi-feature "Título de la feature"     # define el problema y requisitos
axiom plan mi-feature                            # solución técnica
axiom tasks mi-feature                           # tareas implementables
axiom verify mi-feature-T1 pass                  # pass | fail | error (humano o agente)
axiom run mi-feature --rondas 3 --agente         # ejecuta (gasta presupuesto)
axiom run mi-feature --dry-run --agente          # simula sin gastar
```

## Estado y trazabilidad

```bash
axiom status                     # vista general del proyecto
axiom status --trace <task>      # evidencia, hash, juez, bloqueos
axiom ui                         # TUI: orquestación + trabajo
```

## Verificación y calidad

```bash
axiom check                      # preflight: dependencias, config, techo, SQLite
axiom validate-spec              # specs y tasks contra esquema
axiom validate-openapi           # spec ↔ router (web.ts)
npm run lint:spectral            # lint OpenAPI con Spectral
npm test                         # build + tests (node:test)
```

## Módulos (fail-closed por defecto)

```bash
axiom module list
axiom module on adapters
axiom module off telegram
axiom module vista adapters columna     # solo | columna | barra
axiom module datos adapters
axiom module compat
```

| Módulo | Versión | Descripción | Panel Web |
|--------|---------|-------------|-----------|
| `adapters` | 0.1.0 | Proveedor LLM conmutable (off/ollama/litellm/openai/anthropic/google/openrouter) | texto |
| `agents` | 0.1.0 | Grafo de orquestación: orquestador, nodos, especializados, subagentes, skills | — |
| `grafos` | 0.1.0 | **Intended** (agents.config.json) vs **Executed** (handoffs + evidencias) | grafo |
| `kanban` | 0.1.0 | Tablero de tareas por estado (SQLite `tasks` agrupadas en columnas) | lista |
| `speckit` | 0.1.0 | Convergencia SDD: specs ↔ tasks ↔ evidencias pass | lista |
| `telegram` | 0.3.0 | Canal Telegram: notificaciones y aprobaciones (broker decide) | — |

### Adapters (proveedor LLM)

```bash
axiom adapters config
axiom adapters use openrouter
axiom adapters model "nvidia/nemotron-3-ultra-550b-a55b:free"
axiom adapters url "https://openrouter.ai/api/v1"
axiom adapters timeout 120000
axiom adapters maxchars 8000
axiom adapters spawn "Escribe un test para..."
axiom adapters modelos --filtro free
```

### Agents (grafo de orquestación)

```bash
axiom agents                                   # lista grafo
axiom agents add nodo-code nodo
axiom agents pause nodo-code [activo|pausado]
axiom agents skill nodo-code implementar
axiom agents link orquestador nodo-code delega
axiom agents define nodo-code instrucciones "Tu rol es..."
axiom agents define nodo-code herramienta "fs=allow"
axiom agents define nodo-code presupuesto "50000:200"
axiom agents handoff orquestador nodo-code "Implementar T1"
axiom agents handoffs
```

### Grafos y speckit

```bash
axiom grafos ver                # diseño vs realidad observada
axiom speckit converge           # specs ↔ tasks ↔ evidencias
```

### Telegram (canal de aprobaciones)

```bash
axiom telegram                  # estado
axiom telegram allow <chat-id>  # allowlist fail-closed
axiom telegram unallow <chat-id>
axiom telegram expira 30
axiom telegram on|off
axiom telegram notify publish
axiom telegram approve <approval-id>
axiom telegram reject <approval-id>
axiom telegram bloqueos
axiom telegram consumo
```

## Web (interfaz completa)

```bash
axiom serve 8787
```

La web no es una consola más: es el panel de control del harness. Incluye chat con modos **ASK / PLAN / BUILD / SKILL / MÓDULO**, grafos en vivo, techo y consumo, aprobaciones con un clic, configuración de módulos y proveedor, staging allowlist y la vista **Intended vs Executed** del grafo de agentes.

### Endpoints principales

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/` | GET | UI completa (chat, orquestación, trabajo, ajustes) |
| `/api/orquestacion` | GET | Techo, tareas, aprobaciones, usos |
| `/api/trabajo` | GET | Specs con tareas y estados |
| `/api/adapters/config` | GET/POST | Config LLM |
| `/api/adapters/spawn` | POST | Spawn de tarea LLM |
| `/api/adapters/modelos` | GET | Modelos disponibles |
| `/api/telegram/config` | GET/POST | Config Telegram |
| `/api/telegram/detectar` | POST | Detecta chat autorizado |
| `/api/agents` | GET | Grafo de agentes |
| `/api/agents/handoff` | POST | Delegación con broker |
| `/api/agents/experience` | GET | Lecciones aprendidas |
| `/api/agents/snapshot` | GET | Snapshot de run |
| `/api/secrets` | POST | Guarda secrets (atómico) |
| `/api/decide` | POST | Broker decide (approve/reject) |
| `/api/modulos` | GET/POST | Lista/activa módulos |
| `/api/modulos/datos` | GET | Datos de un módulo |
| `/api/modulos/propuestas/generar` | POST | Genera propuesta de módulo con el LLM |
| `/api/modulos/propuestas/validar` | POST | Revalida una propuesta persistida |
| `/api/modulos/propuestas/aprobar` | POST | Instala tras confirmación humana (apagado) |
| `/api/run` | POST | Ejecuta run (con agente) |
| `/api/chat/enviar` | POST | Mensaje de chat (el LLM responde) |
| `/api/plan/aprobar` | POST | Aprueba/rechaza propuesta |
| `/api/staging` | GET | Archivos fuera de allowlist |

La spec completa vive en [`openapi.json`](openapi.json); `axiom validate-openapi` comprueba que el spec y el router (`web.ts`) no se desincronicen.

## Creador de módulos desde el chat (modo MÓDULO)

Axiom puede **generarse a sí mismo piezas nuevas** sin tocar el core:

1. Activas la tarjeta **MÓDULO** en el chat y describes la necesidad.
2. El servidor busca referencias reales (Exa) y el proveedor LLM propone código dentro de un contrato puro `datosModulo(root)` — sin I/O, sin efectos laterales.
3. Un validador AST compila y ejecuta el contrato en un worker aislado; solo persiste lo que pasa (payload con checksum SHA-256).
4. Tú revalidas y apruebas explícitamente; el módulo se instala **apagado** y solo se enciende desde Ajustes → Módulos.

Falla cerrado en cada paso: sin proveedor no genera, sin validación no persiste, sin confirmación no instala, apagado no sirve.

## Secrets (locales, nunca en repo)

```bash
# .axiom-secrets.json (gitignored, 0600)
# OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY
# AXIOM_LITELLM_KEY, AXIOM_TELEGRAM_BOT_TOKEN, AXIOM_TELEGRAM_WEBHOOK_SECRET
```

La web solo muestra presencia ("guardada" / "ausente"); los valores nunca se reenvían al cliente.

## Políticas y techo (broker)

- **Global** (`policies.global.json`): herramientas + techo global (rondas, tokens, calls).
- **Proyecto** (`project.json`): herramientas + presupuesto por proyecto.
- **Decisión efectiva** = `global AND project` (ausencia = deny por defecto).
- **Riesgo alto** (terminal, publish, network) → `ask`: requiere aprobación humana, aquí o por Telegram.
- **Techo**: la reserva del 20% es para verificación; al agotarse, el orquestador se detiene (fail closed).

## Estructura de archivos

```
axiom/
├── .axiom-secrets.json        # Secrets locales (gitignored)
├── specs/active/<id>/         # Por spec
│   ├── spec.md                # Spec + Gherkin
│   ├── plan.md                # Plan técnico
│   ├── tasks.md               # Tasks
│   ├── verification-<task>.md # Evidencia + hash SHA-256
│   └── informe-ronda-<n>.md   # Informe de ronda
├── docs/decisions/            # ADRs
├── policies.global.json       # Políticas globales
├── project.json               # Config proyecto
├── modules.json               # Estado módulos
├── agents.config.json         # Grafo agentes
├── adapters.config.json       # Config LLM
├── telegram.config.json       # Config Telegram
├── openapi.json               # Spec del servidor web
├── axiom.db                   # SQLite (gitignored)
└── dist/                      # Build output (gitignored)
```

## Flujo típico con agente

```bash
# 1. Setup
axiom init
axiom adapters use openrouter
axiom module on adapters agents telegram grafos speckit

# 2. Especificar
axiom spec auth "Sistema de autenticación"
# Edita specs/active/auth/spec.md con requisitos y Gherkin

# 3. Plan y tareas
axiom plan auth
axiom tasks auth

# 4. Ejecutar con el grafo de agentes
axiom run auth --agente --rondas 3

# 5. Revisar evidencia (el agente no se aprueba a sí mismo)
axiom status --trace auth-T1
axiom verify auth-T1 pass

# 6. Convergencia
axiom speckit converge
axiom grafos ver
```

## Validación continua

```bash
npm run build && npm test && node dist/cli.js validate-openapi && npm run lint:spectral
```

## Por qué "IDE" y no "harness"

Porque el ciclo completo —especificar, planificar, ejecutar, verificar, aprobar— **ocurre dentro de la misma herramienta, con las mismas reglas, sin salir a un chat paralelo ni confiar en la palabra del modelo**. El harness es la parte que habla con el LLM; el IDE es todo lo demás: specs como fuente de verdad, evidencia firmada, presupuesto con techo, equipo de agentes grafiado, aprobaciones con gate humano (web o Telegram) y extensiones versionadas que se apagan solas si algo va mal.
