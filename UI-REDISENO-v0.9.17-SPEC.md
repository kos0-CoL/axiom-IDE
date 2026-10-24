# Axiom Web — SPEC de rediseño IDE (v0.9.17, solo spec, sin código)

**Fecha:** 2026-10-21 — Responde a revisión del usuario: aspecto horrible, chat no-IDE, orquestación vacía, aprobaciones confusas, configuración confusa, tooltips rotos, toggle TG aparentemente roto.
**Método:** síntesis de 3 investigaciones (chat IDEs IA, lenguaje visual IDEs, aprobaciones/orquestación). Referencias al final.
**Regla:** nada de este documento cambia código hasta su aprobación. Fases al final.

## 0. Respuestas directas a las preguntas del usuario (antes del diseño)

- **¿Por qué tuve que pedirte el chat id?** El bot no sabe quién eres: Telegram identifica cada conversación solo con un número (`chat id`). La allowlist es la lista de números autorizados a decidir. Sin tu número, el canal deniega todo (fail closed). **Fix en este spec (§5): botón "Detectar mi chat"** que lee `getUpdates` y propone autorizarte con un clic — nunca más pedirlo a mano.
- **¿Qué es "secreto webhook"?** Contraseña opcional entre Telegram y tu servidor: solo sirve si usas modo webhook (Telegram te avisa en una URL pública). Si usas polling (`telegram bot`) o el Lab, **no lo necesitas** — déjalo vacío. El spec lo etiqueta así y lo oculta tras "avanzado".
- **¿Por qué el toggle TG parecía no funcionar?** Dos causas reales: (a) la etiqueta se actualizaba solo tras recarga de datos — si la petición tardaba, mentía; (b) el servidor demo vive en `/tmp` y **cada reinicio borra su estado**, incluido `enabled=true`. Fix: UI optimista + relectura (§5) y avisar que la demo es volátil; el proyecto real conserva todo.
- **¿Qué significa "consola broker: allow|deny|ask — sin evidencia no hay verde"?** Jerga interna, hay que eliminarla (§4): pasa a llamarse **Actividad** y cada línea explica en lenguaje humano qué pasó ("Publicar pidió permiso → esperando tu decisión") con leyenda permanente.

## 1. Dirección visual nueva: workbench IDE, no terminal

Se retira la estética CRT (fondo negro puro, todo mayúsculas mono, bordes blancos gruesos). Se adopta workbench:

- **Layout fijo:** barra de actividad estrecha (48px, iconos: Chat, Orquestación, Trabajo, Aprobaciones, Agentes, Configuración) + sidebar (240px, contexto: proyecto/sesiones) + zona central (editor/chat) + panel inferior colapsable (Actividad) + barra de estado (24px: proveedor, modelo, TG on/off, techo).
- **Paleta (tokens, inspirada Tokyo Night/Catppuccin Mocha):** `--app-bg #181a20`, `--sidebar-bg #1c1f27`, `--editor-bg #20232b`, `--panel-bg #1b1e25`, `--line #303540`, `--text #d7dae0`, `--muted #9299a6`, `--accent #7aa2f7`, `--success #9ece6a`, `--warning #e0af68`, `--error #f7768e`. Un solo acento (azul) para foco/navegación; rojo/verde solo semánticos.
- **Tipografía:** UI en sans (`Inter`, fallback sistema), 13px; código/IDs en mono (`JetBrains Mono`). **Fin de TODO-MAYÚSCULAS** en chrome: sentence case ("Orquestación", "Guardar", "Enviar"). El mono-uppercase queda solo para IDs y telemetría.
- **Forma:** radio 6px en campos/botones/paneles, bordes 1px sutiles, sin scanlines ni grano. Densidad: filas 28px, respiro en sidebar.
- **Responsive:** <900px la sidebar pasa a cajón; el chat manda.

## 2. Chat estilo ChatGPT/Cursor (la vista principal)

- **Abrir proyecto para chatear:** selector de proyecto en sidebar (el `root` actual + recientes). Sin proyecto abierto no hay chat (como Cline: sin workspace no hay dónde actuar). Cambiar de proyecto cambia de store y de sesiones.
- **Sesiones por proyecto:** lista en sidebar (título auto = primeras palabras), botón "Nuevo chat", historial persistente **en SQLite** (tablas nuevas `chat_sessions`, `chat_messages`; la charla deja de "vivir solo en la página"). Reanudar restaura contexto. Eliminar archiva, no borra.
- **Input con modos al lado de Enviar:** `[Build|Plan|Ask] [Skills] [Enviar]`.
  - **Ask:** pregunta/responde, solo lectura (el proveedor actual; sin herramientas).
  - **Plan:** investiga y propone plan revisable en el propio chat (pasos numerados + botón "Pasar a Build").
  - **Build:** ejecuta contra el proveedor con budget (hoy `adapters.spawn`; herramientas reales = fase posterior, se marca "vista previa" donde aplique).
  - **Skills:** desplegable con las skills del módulo agentes (plan, broker, implementar, verify, review, evidence, policy, sandbox); filtra el modo (p. ej. Build+verify).
- **Modelo visible:** pill `proveedor / modelo` + filtro todos/recomendados/free ya existente; el cambio de modelo a mitad de sesión se marca en el transcript ("cambiaste a X").
- **Mensajes:** burbujas diferenciadas usuario/asistente, markdown básico, código en bloque mono con copiar, errores en rojo humano ("El proveedor está apagado — elígelo en Configuración"), latencia y truncado como metadato discreto, no como cabecera.

## 3. Orquestación: datos reales o estado vacío honesto

La vista actual muestra 3 cajas (2 con texto, 1 gris sin render). Se reemplaza por:

- **Tarjeta Techo:** rondas/tokens/calls + barra plana consumido/reserva; texto humano ("te queda X para esta sesión").
- **Tarjeta Tareas:** conteo por estado desde el store real; clic en un estado filtra Trabajo. Si no hay specs: vacío honesto ("Sin specs — corre `axiom spec …`") con el comando copiable, no un gris mudo.
- **Tarjeta Agentes (el diagrama):** el grafo real del módulo agents como **lista jerárquica** orquestador → nodos → especializados + aristas como subtítulos ("delega a…", "escala a…"), cada agente con estado (activo/pausado), modelo ("hereda del proveedor" explicado: usan el LLM configurado) y skills como chips. **Timeline de eventos** debajo (aprobaciones/decisiones recientes = lo que hoy es la consola). DAG gráfico canvas = fase posterior, no MVP del rediseño.
- Nada de "módulos REALES" inventados: cada tarjeta indica su fuente (`agents.config.json`, SQLite) y qué es manual vs automático.

## 4. Aprobaciones: tarjeta de revisión, sin Telegram Lab dentro

- **El Lab se muda** a la sección del módulo Telegram en Configuración (es herramienta de prueba del canal, no una aprobación).
- **Tarjeta por aprobación pendiente:** herramienta + riesgo + **efecto previsto en humano** ("Publicar → red externa, irreversible") + quién la pide + expira en X + alcance ("solo esta vez, no siempre") + botones **[Aprobar] [Rechazar] [Ver detalle]**. Nada de IDs crudos como título (el ID queda en metadato copiable).
- **Historial:** decididas con quién/cuándo/resultado (ya auditado en SQLite, hoy invisible).
- **Aprobaciones por email/webhook** (patrón CrewAI): fuera de alcance; se deja el endpoint.

## 5. Configuración por módulos (reorganizada)

Un módulo = una tarjeta con: qué es (1 línea humana), estado (pill), controles mínimos, "avanzado" colapsado.

- **Proveedor LLM:** como hoy + API KEY con tooltip funcional (ver §6) + filtro + modelos. Añadir nota de alcance: "la key queda en este servidor".
- **Canal Telegram:** **interruptor grande** Activado/Pausado (optimista + relectura; explica qué pausa: "el bot deja de obedecer; tu token y lista se conservan"). Campos: BOT TOKEN (password, con instructivo), SECRETO WEBHOOK (en "avanzado", etiquetado "solo si usas webhook público; con polling o Lab déjalo vacío"), allowlist con botón **"Detectar mi chat"** (lee `getUpdates`, propone el número, un clic autoriza) + expiración. El resto del módulo no se toca (ya es así; se rotula: "gestionado por Axiom").
- **Agentes:** grafo + añadir/pausar/skills/enlazar (como hoy) + explicación de roles (orquestador decide, nodos ejecutan, especializados custodian, subagentes tareas laterales).
- **Secretos:** presencia + botón "olvidar" por clave (borra del servidor). Aviso demo-volátil.

## 6. Tooltips que funcionen

El `title` nativo falla en táctil y no se ve. Patrón: icono `?` focuseable junto a cada campo; al foco/clic muestra popover (texto del instructivo + enlace oficial), cierra con Esc/clic fuera. Contenido inicial: dónde conseguir cada key (OpenAI/Anthropic/Google/OpenRouter/LiteLLM/Ollama-local-sin-key), cómo crear el bot (@BotFather → /newbot), qué es el secreto webhook, qué es el chat id.

## 7. Fases (aplicar solo tras aprobar este spec)

- **F1 (visual): ✅ aplicada v0.9.17-f1** — tokens + workbench + sentence case + barra estado, lógica intacta. Criterio cumplido: `validate-tokens` OK, check-webjs en verde, página servida verificada (estructura + 6 APIs 200).
- **F2 (chat): ✅ aplicada v0.9.17-f2** — proyecto + sesiones SQLite + modos Ask/Plan/Build + skills + historial. Criterio cumplido: crear/renombrar/reanudar persiste tras reinicio (verificado con servidor real).
- **F3 (orquestación/aprobaciones): ✅ aplicada v0.9.17-f3** — tarjetas con datos reales + vacíos honestos + Lab movido + historial de decisiones. Criterio cumplido: matriz actualizada en ESTADO-MVP0, pendiente real aprobada vía web con timeline verificado.
- **F4 (config): ✅ aplicada v0.9.17-f4** — tooltips popover + Detectar-mi-chat + olvidar-secretos + toggle optimista. Criterio cumplido: alta del bot solo con UI verificada por endpoints (guardar token, detectar con guía humana, activar, olvidar).
- **F5 (docs): ✅ aplicada v0.9.17** — UI-SPEC §10 + E3 AXM-067–070 + Maestro enmienda menor 2026-10-21.

## Referencias

- Chat IDEs: Cursor Agent/Plan/Ask (https://cursor.com/docs/agent/overview, https://cursor.com/docs/agent/plan-mode); VS Code Copilot chat/sesiones/harness (https://code.visualstudio.com/docs/chat/chat-overview, https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions, https://code.visualstudio.com/docs/agents/run/agent-harnesses); Cascade Code/Chat (https://docs.windsurf.com/windsurf/cascade); Cline Plan&Act + tasks (https://docs.cline.bot/core-workflows/plan-and-act, https://docs.cline.bot/core-workflows/task-management, https://github.com/cline/cline).
- Visual: VS Code workbench (https://code.visualstudio.com/docs/editing/getting-started/userinterface); Zed apariencia/temas (https://zed.dev/docs/appearance, https://zed.dev/docs/themes); Catppuccin (https://github.com/catppuccin/vscode); Tokyo Night (https://github.com/tokyo-night/tokyo-night-vscode-theme); VS Code theme colors (https://code.visualstudio.com/api/references/theme-color).
- Aprobaciones/orquestación: OpenAI Agents HITL (https://openai.github.io/openai-agents-python/human_in_the_loop/); LangGraph interrupts (https://docs.langchain.com/oss/javascript/langgraph/interrupts); CrewAI HITL (https://docs-platform.crewai.com/platform/en/features/flow-hitl-management); AutoGen HITL (https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html); Devin permisos (https://docs.devin.ai/desktop/devin-local).
