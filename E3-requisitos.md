# Axiom IDE — E3 Requisitos iniciales (completa)

**Fecha:** 2026-10-20
**Base:** Maestro v0.2 + ENTREGABLE-2 + UI-SPEC + decisiones 2026-10-20
**Método:** `to-spec` (síntesis sin entrevista) + `implement-specs` (PRODUCT/TECH por ID). Sin código.
**Stack fijado:** TS + Node 22.5+ con npm, SpecKit preset/extensión, Docker jail, SQLite+MD, LiteLLM+local, pinned+evaluación.

## Problem Statement

Desarrolladores con proyectos grandes pierden entorno operable cuando usan agentes IA: contexto divergente, permisos difusos, reintentos sin techo, specs sobrescritas, verificaciones afirmadas sin evidencia. Necesitan un harness mínimo agnóstico que envuelva SpecKit, imponga estados, presupuestos, aprobaciones y trazabilidad desde el día uno.

## Solution

MVP-0: CLI `axiom` + preset SpecKit `axiom` + broker permisos + store SQLite + TUI 2 vistas + Telegram canal + componentes versionados. Todo cambio relevante pasa por spec versionada y `verification.md` con evidencia; global prevalece sobre proyecto.

## Requisitos funcionales

### RF — Harness y SpecKit
- **AXM-001 [P0]** `axiom init` crea proyecto con `.specify/` + preset axiom + `axiom.json` + SQLite inicializado. Fuente: v0.2 §5 + decisión stack. Criterio: en dir vacío, `init` sale 0 y deja `specs/active/`, `.specify/feature.json`, `axiom.db` con schema migrable.
- **AXM-002 [P0]** Flujo MD→spec→plan→tasks→implement→verify con gates `clarify/checklist/analyze` opcionales por riesgo. Fuente: v0.2 §5. Criterio: spec sin `clarify` en caso ambiguo falla `validate-spec`; caso claro pasa sin obligarlo.
- **AXM-003 [P0]** Specs versionadas inmutables: aprobar crea nueva versión con historial, nunca sobrescribe. Fuente: v0.2 §5. Criterio: editar spec aprobada genera `vN+1` y mantiene `vN` recuperable con procedencia.
- **AXM-004 [P0]** Cada tarea enlaza a versión concreta de spec y escenario Gherkin observable. Criterio: `validate-spec` falla si tarea sin `spec_id:ver` o sin `Given/When/Then`.
- **AXM-005 [P0]** `verification.md` obligatoria con comando+salida+hash. Ausencia pruebas ≠ éxito. Criterio: marcar tarea aceptada sin evidencia es rechazado por broker y TUI muestra banner rojo.

### RF — Estados, bloqueos, recuperación
- **AXM-010 [P0]** Estados `implementado/verificado/aceptado/bloqueado/rechazado` diferenciados; sprint deriva de tareas, no de declaración libre. Criterio: test crea tarea implementada sin tests → no es verificable ni aceptable.
- **AXM-011 [P0]** Bloqueo aísla dependientes y continúa trabajo independiente autorizado, preservando parciales. Criterio: demo con API-auth faltante bloquea integración pero permite 2 tareas independientes en verde parcial.
- **AXM-012 [P0]** Investigación autónoma con hipótesis y pruebas aisladas dentro de límites. Criterio: agente genera ≥2 hipótesis distintas antes de repetir estrategia.
- **AXM-013 [P0]** 3 rondas integración por defecto, configurables; al fallar ronda → informe intentos/soluciones/evidencias. Criterio: 3 fallos paralelos detienen ronda y emiten informe MD.
- **AXM-014 [P1]** Detección ciclos (hash error+diff) detiene antes del máximo. Criterio: 3 resultados idénticos consecutivos escalan sin consumir techo.

### RF — Políticas, permisos, presupuesto
- **AXM-020 [P0]** Jerarquía global>proyecto; proyecto restringe, nunca elude seguridad global. Criterio: test negativo — proyecto que habilita tool deshabilitada globalmente sigue denegado y auditado.
- **AXM-021 [P0]** Permiso por operación (capacidad global + permiso proyecto + check ejecución). Deshabilitar tool bloquea nuevas ops y cancela seguras activas. Criterio: revocar `terminal` mid-run impide nuevo spawn y deja log.
- **AXM-022 [P0]** Contadores separados: reintentos, rondas, concurrencia, llamadas, tokens; techo agregado anti-multiplicación anidada. Fórmula: `min(global,proyecto)` y `rondas×intentos ≤ techo`. Criterio: 3 paralelos × 3 reintentos no excede techo agregado.
- **AXM-023 [P0]** Presupuesto tokens/llamadas por sesión/proyecto, off por defecto; estima con rango antes de spec/historia/sprint; reserva para verificaciones; no inicia unidad infinanciable. Criterio: sin presupuesto para verificación, `run` rehúsa iniciar nueva historia pero permite tarea independiente financiable.
- **AXM-024 [P0]** Autoaprobación OFF; sin respuesta ≠ aprobación; Telegram canal no permiso. Criterio: timeout aprobación deja acción bloqueada, no ejecutada.
- **AXM-025 [P1]** Matriz riesgo: bajo auto (lectura/tests jail), medio regla proyecto, alto humana explícita (migración, publish, seguridad, red externa, promoción global). Criterio: cada tool MCP lleva `readOnly/destructive` y mapea a nivel.

### RF — Orquestación y vistas
- **AXM-030 [P0]** Vista orquestación: DAG nodos/agentes, delegaciones, modelos, consumo. Click arista filtra trabajo. Criterio: ver §6 UI-SPEC criterios 1-5.
- **AXM-031 [P0]** Vista trabajo: requisitos/historias/specs/tareas/dependencias/bloqueos/pruebas/evidencias/decisiones mismo store. Criterio: ambas vistas leen misma SQLite sin divergencia.
- **AXM-032 [P0]** Selección autónoma entre existentes/temporales/alternativas según calidad/coste/latencia/riesgo/evidencia, si política autoriza. Crear ≠ adoptar permanente. Criterio: log muestra scoring y decisión reversible.
- **AXM-033 [P1]** Conflictos por evidencia; nodo evalúa área, orquestador global, producto persistente escala a usuario. Criterio: demo conflicto resuelto por evidencia, no por consenso.

### RF — Telegram
- **AXM-040 [P0]** Bot `/start /status /bloqueos /consumo` + notificaciones con botones Aprobar/Rechazar/Cambios con ID correlación hacia broker. Criterio: aprobar en Telegram audita `quién/cuándo/qué ID` en SQLite; rechazar bloquea dependientes.

### RF — Web F1–F4 (rediseño v0.9.17)
- **AXM-067 [P1]** Sesiones de chat persistentes por proyecto: crear/listar/renombrar/archivar en SQLite (`chat_sessions`/`chat_messages`); reanudar restaura historial con proveedor, modelo, skill y latencia. Fuente: SPEC rediseño F2. Criterio: crear/renombrar/reanudar persiste tras reinicio del servidor.
- **AXM-068 [P1]** Modos de chat Ask/Plan/Build + skills leídas del grafo real de agents; el modo cambia el encargo al proveedor y la skill enfoca la respuesta; cambio de modelo marcado en el transcript; markdown básico con copiar y escaping previo. Fuente: SPEC rediseño F2. Criterio: enviar en cada modo guarda usuario+respuesta y el historial renderiza código con botón Copiar.
- **AXM-069 [P1]** Alta y gestión del canal Telegram solo con UI: guardar token, Detectar-mi-chat (`GET /api/telegram/detectar` vía `getUpdates`, autoriza con un clic), olvidar-secretos por clave (respeta las del entorno), toggle optimista con relectura. Fuente: SPEC rediseño F4. Criterio: alta completa del bot sin terminal (token + detectar + activar).
- **AXM-070 [P1]** Orquestación y aprobaciones explicadas: tarjetas con datos reales o vacíos honestos (techo con consumo, tareas clicables que filtran Trabajo, agentes jerárquicos, timeline), tarjeta por pendiente (efecto previsto en humano, expira, alcance "solo esta vez", detalle) + historial con quién/cuándo. Fuente: SPEC rediseño F3. Criterio: pendiente real aprobada vía web aparece en el timeline con `decided_by`.

### RF — Proyectos F6 (v0.9.18)
- **AXM-071 [P1]** Nuevo proyecto desde la web: botón que abre ventana para elegir la carpeta del proyecto en el servidor (crear nueva con nombre+base, usar ruta existente o recientes); ahí nacen la carpeta de agentes, specs, políticas y su SQLite. Fuente: pedido directo. Criterio: crear deja `specs/active`, `axiom.json`, políticas y `axiom.db` propios.
- **AXM-072 [P1]** Cambio de proyecto sin reiniciar: `POST /api/proyecto/crear|usar` conmutan el root servido; cada root aísla sus sesiones; usar inicializa lo que falte sin pisar archivos del usuario. Fuente: pedido directo. Criterio: sesión creada en A no visible en B y viceversa, verificado contra servidor real.

### RF — Módulos F7 (v0.9.19)
- **AXM-073 [P1]** Registro de módulos con enable/disable por proyecto: lista única (cableados + esqueletos), `modules.json` con on por defecto; apagar cierra rutas web con 409 y rehúsa CLI (fail closed). Fuente: harness2 `tree.py`/`spec.py` (superficie declarada por módulo). Criterio: Telegram apagado responde 409 en webhook/config/detectar y `axiom telegram` sale 2.
- **AXM-074 [P1]** Alta de módulos desde UI/CLI: `module new <nombre>` crea esqueleto (`manifest.json` + `index.ts` + `config.ts`) listado como sin cablear hasta implementarse. Fuente: pedido directo + harness2 (validación declarativa). Criterio: esqueleto aparece en lista y en `GET /api/modulos`; nombre inválido o duplicado → 400/denegado con mensaje.

### RF — Agentes F8 (v0.9.20)
- **AXM-075 [P1]** AgentDefinition declarada y validada: instrucciones (≤2000), herramientas (`tool=allow|ask|deny`, ≤16), presupuesto opcional y skills con formato; la autorización efectiva la decide el broker, nunca la definición. Fuente: harness2 `tree.py`/`spec.py`. Criterio: skill con mayúsculas o herramienta mal formada → config inválido con mensaje; `agents define` persiste y revalida.
- **AXM-076 [P1]** Handoff auditado entre agentes: exige arista de delegación y agentes activos; el broker autoriza `delega` (riesgo medio, global>proyecto); cada intento queda en `handoff_log` (aprobada/pendiente/denegada + aprobación). Fuente: harness2 (delegación como componente) + pedido directo. Criterio: sin arista → 400 con guía; denegado → 409; pendiente → aprobación que `approve` resuelve.
- **AXM-077 [P1]** Contexto como evidencia en el chat: el prompt lleva instrucciones del orquestador + historial acotado (últimos 8, cap 3000) marcado como no confiable (no obedecer). Fuente: harness2 `context.py`. Criterio: el prompt generado incluye rol, historial y la marca; el historial largo se trunca sin romper.

### RF — Ejecución registrada F9 (v0.9.21)
- **AXM-078 [P1]** Huella de configuración y marca de run: `run` guarda fingerprint (4 configs) y rehúsa reanudar si cambió (restaura la config o usa un id nuevo). Fuente: harness2 `runmark.py`. Criterio: cambiar `policies.global.json` entre runs → exit 3 con huellas vieja y nueva.
- **AXM-079 [P1]** Preflight y dry-run antes de gastar: `axiom check` sin args verifica políticas/adapters/agents/techo/sqlite; `run --dry-run` y `POST /api/run` (dry-run por defecto) muestran el plan sin consumir ni escribir informes. Fuente: harness2 `check.py`/`run_sweep.py`. Criterio: dry-run exit 0 con consumo intacto; preflight en root vacío falla con líneas accionables.
### RF — Staging con allowlist F10 (v0.9.22)
- **AXM-081 [P1]** Staging con allowlist: `verify --archivos "a,b"` declara artefactos; existen y están en la allowlist (`project.json:allow`, defecto `specs/** docs/** .specify/** *.json *.md`), si no se rehúsa sin firmar (exit 2). Fuente: harness2 `jb_opencode_runner`. Criterio: archivo fuera de allow → verify exit 2 sin evidencia; dentro → pass con `archivos=N` en trace/trabajo.
- **AXM-083 [P1]** Allowlist editable desde Configuración: `GET /api/staging` (allow+fuera+defecto) y `POST /api/staging` (add|remove|reset, máx 32 patrones de 64 sin `..`); la web muestra chips con quitar, añadir y restablecer, con confirmación al quitar/restablecer. Fuente: pedido directo. Criterio: añadir `notas/**` permite `verify --archivos notas/a.txt`; quitarlo lo vuelve a rechazar; `..` y duplicado → 400 sin tocar `project.json`.

- **AXM-082 [P1]** Aviso de staging en run y archivos visibles: `run`/`--dry-run` añade `staging: limpio|N fuera de allowlist (…)`; Trabajo (TUI/web/API) muestra `archivos=N` por tarea (separación artefactos-vs-veredictos). Criterio: raíz suelta aparece en el aviso; `/api/trabajo` trae `archivos` entero por tarea.

- **AXM-080 [P1]** Informes que separan fallo del juez de resultado malo: `verify <t> error [--detalle]` escribe `verification-<id>-ERROR.md` sin evidencia, sin cambiar estado y sin consumir; `status --trace` muestra `juez-fallido=sí (no es fail del trabajo)`. Fuente: harness2 `report.py`/`selection.py`. Criterio: juez fallido deja tarea en implementado; `fail` posterior la bloquea con evidencia.

### RF — Consumo real F11b (v0.9.24)
- **AXM-084 [P1]** Consumo medido por spawn: cada driver reporta `uso {prompt, respuesta, total, fuente}` (usage del proveedor cuando existe: OpenAI/LiteLLM `usage`, Anthropic `usage`, Google `usageMetadata`, Ollama `prompt_eval_count/eval_count`); si no, estimado honesto ~4 caracteres por token marcado `estimado`. `adapters spawn` (CLI), `POST /api/adapters/spawn` y `POST /api/chat/enviar` acumulan `total`+1 llamada en `consumo` global; fail-closed (`off`/sin key) no consume. Fuente: pedido directo. Criterio: contra proveedor falso con usage 10+5, tres spawns dejan `tokens=45 calls=3` y `off` no suma.

### RF — Usos visibles F11d (v0.9.25)
- **AXM-085 [P1]** Historial de usos visible: cada spawn con uso deja una fila en `uso_log` (últimas 50); Orquestación muestra los últimos (`usos: +30tok(medido) …` en TUI, `Últimos usos:` en web, `usos[]` en `GET /api/orquestacion`), `status --trace` y `telegram consumo` los resumen. Fuente: pedido directo. Criterio: dos spawns contra usage 20+10 dejan `usos` con dos `+30tok(medido)` en TUI/API/trace/telegram.

### RF — Run con agente F12 (v0.9.26)
- **AXM-086 [P1]** Run que trabaja de verdad: `axiom run <id> --agente` (y `POST /api/run` con `agente:true`) ejecuta una ronda de agente — por cada pendiente (tope 4) 2 spawns al proveedor activo: (1) el agente produce el artefacto `specs/active/<spec>/trabajo-<task>.md` (dentro de la allowlist) y (2) un juez emite JSON estricto `{"verdict":"pass"|"fail"}`; el veredicto se firma con `juez=agente` en verification.md y el artefacto como `archivos`. La salida del proveedor es dato, nunca se ejecuta (prompt anti-inject + solo se parsea el veredicto con regex). El `--dry-run` muestra el plan de spawns sin gastar. Fuente: pedido directo (cierre del hueco "run solo cuenta rondas"). Criterio: con proveedor falso, `run --agente` deja 2 pass verificados con `archivos=1` y consumo medido; fail del juez bloquea con evidencia; sin JSON → juez-fallido (sigue implementado); proveedor off → falla sin gastar.

### RF — Componentes y aprendizaje
- **AXM-050 [P0]** Ciclo versionado/evaluación aislada/comparación/adopción/rollback; scopes temporal/local/global independientes; terceros OFF por defecto. Criterio: instalar componente pasa sandbox y compara vs estable antes de activar.
- **AXM-051 [P0]** Limpieza no borra fábrica ni en uso; chequea dependencias antes de borrar otras. Criterio: intento borrar en uso es denegado con aviso.
- **AXM-052 [P1]** Aprendizaje con promoción controlada; promoción componente ≠ promoción conocimiento; núcleo seguridad inmodificable por sometidos. Criterio: propuesta auto-optimización queda en aislamiento hasta aprobación.

## Requisitos no funcionales

- **AXM-060 [P0] Aislamiento:** Docker default: imagen pineada digest, non-root, `read_only`, `cap_drop ALL`, `no-new-privileges`, source RO + copia tmpfs writable, `network none` default, `pids_limit` finito. Criterio: jail demo supera checklist `docker-patterns`.
- **AXM-061 [P0] Persistencia:** SQLite + MD; migraciones versionadas; archivar≠borrar con metadatos versión/fecha/relaciones; recuperar no otorga vigencia. Criterio: reinicio reanuda run-id con parciales intactos.
- **AXM-062 [P0] Agnóstico:** LiteLLM opcional + Ollama local; `generic --commands-dir` para agentes no nativos; una sola integración activa. Criterio: cambiar proveedor vía config sin tocar specs.
- **AXM-063 [P0] Trazabilidad:** grafo requisito→historia→spec:ver→tarea→código→test→evidencia→decisión→consumo→bloqueo consultable. Criterio: `axiom status --trace <tarea>` recorre cadena completa.
- **AXM-064 [P1] Entorno limpio:** `AGENTS.md`<150 líneas, boundaries por CI, CI `markdownlint+lychee+Spectral+validate-spec`. Criterio: PR que cruza boundary falla CI aunque tests pasen.
- **AXM-065 [P1] UI:** Tactical Telemetry oscuro único, tokens `@theme` sin hex crudo, teclado+foco+`reduced-motion`, mono ≥11px. Criterio: `validate-tokens` pasa + checklist §6 UI-SPEC.
- **AXM-066 [P1] Observabilidad:** OTel + Langfuse opcional; consola broker `allow|deny|ask`. Criterio: cada tool call deja traza con IO resumido.

## User Stories (extracto operativo)

1. Como dev principiante, quiero `init` con API key y modelo, para empezar sin configurar políticas.
2. Como dev avanzado, quiero asignar proveedor/modelo por nodo, para optimizar coste/latencia.
3. Como owner, quiero global que ningún proyecto eluda, para garantizar seguridad.
4. Como agente, quiero saber mi presupuesto y rondas restantes, para no iniciar lo infinanciable.
5. Como revisor, quiero ver evidencia hash, no afirmación, para aceptar.
6. Como on-call, quiero aprobar desde Telegram con ID, para desbloquear sin abrir TUI.
7. Como arquitecto, quiero proponer ADR aislado sin mutar oficial, para evaluar sin riesgo.
8. Como owner componentes, quiero rollback a estable, para recuperarme de regresión.

## Implementation Decisions

- Harness TS/Node (npm), contratos Zod: `Agent, Tool, Policy, Evidence, Budget, Approval`.
- MCP stdio local / HTTP stateless remoto; tools con `outputSchema` + `structuredContent` donde aplique.
- Store `better-sqlite3` + MD; `specs/active/<id>-slug/` + `docs/decisions/ADR-*` (MADR).
- Sandbox driver interfaz `local|docker|microvm`; MVP solo `docker` endurecido.
- Orquestación LangGraph primera opción (checkpoints/pause); evaluar CrewAI si equipos opinados encajan mejor.
- Seams de test preferidas: broker `check()`, `validate-spec`, store `trace()`, sandbox `spawn()` — una sola seam nueva por módulo, no más.

## Testing Decisions

- Solo comportamiento externo, no detalles. Módulos: broker, policy, store, sandbox, telegram-transporte, validate-spec.
- Prior art: tests LangGraph pause/resume, MCP inspector `npx @modelcontextprotocol/inspector`, `markdownlint`, `lychee-action`, Spectral.
- Doble eje `code-review`: Standards vs Spec en cada PR, sin re-rankear ejes.

## Out of Scope (MVP-0)

Editor código, marketplace público comunitario, auto-optimización estructural orquestador, multi-proyecto distribuido, vector DB servida, `sqlite-vec` salvo necesidad probada, soporte Windows-containers/macOS-containers como validación (solo CI nativo según `docker-patterns`).

## Further Notes

E4 formalizará E3 AXM-020/022/025 con semántica exacta y techo agregado; E5 contratos y flujos; E6 fases y aceptación. Ningún ID es código todavía.
