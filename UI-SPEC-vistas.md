# Axiom IDE — UI Spec vistas (Opción 1)

**Fecha:** 2026-10-20
**Base:** ENTREGABLE-2-MVP §Fase B + skills frontend-design, tailwind-design-system, design-system, industrial-brutalist-ui
**Estado:** Spec revisable, sin código.

## 1. Dirección visual elegida

Arquetipo: **Tactical Telemetry CRT** (modo oscuro único, sin mezclar con light).
- Substrato `#0A0A0A`, fósforo `#EAEAEA`, acento único rojo aviación `#FF2A2A` solo para bloqueos/fallos críticos. Verde `#4AF626` solo para un indicador `VERIFICADO`.
- Macro: Inter Black / Archivo Black, uppercase, tracking -0.04em, leading 0.9, `clamp(3rem,8vw,10rem)` solo para título AXIOM.
- Micro: JetBrains Mono 11-13px, uppercase, tracking 0.08em para metadata, IDs, consumo.
- Grid visible: `display:grid; gap:1px` con fondo contrastado para líneas finas. `border-radius:0` en todo. ASCII framing `[ SPEC ]`, `>>>`, `+` en intersecciones. Scanlines sutiles + grano SVG global, sin gradientes ni sombras suaves.
- Tokens 3 capas (design-system): primitive → semantic → component en `@theme` Tailwind v4. Nada de hex crudo en componentes. Validar con `validate-tokens`.

Lo memorable único: el **grafo trazable** es el héroe, no cards genéricas. Todo lo demás quieto y disciplinado.

## 2. Layout global

```
+---------------------------------------------------------------+
| AXIOM [PROYECTO:X]  +  run-id  rama  modelo  presupuesto  hora |
+---------------+-------------------------------+---------------+
| ORQUESTACIÓN  | TRABAJO (spec activa)         | DETALLE /     |
| nodos         | spec>plan>tasks>verification  | EVIDENCIA     |
| grafo DAG     | lista tareas con estados      | logs/tests    |
| aprobaciones  | bloqueos aislados             | diff          |
+---------------+-------------------------------+---------------+
| CONSOLA broker: allow|deny|ask  +  consumo tokens/llamadas/rondas |
+---------------------------------------------------------------+
```

Tres columnas ancladas a grid, reglas `<hr>` full-width entre unidades. Responsive: colapsa a 1 columna (trabajo primero) en <900px. Foco teclado visible, `prefers-reduced-motion` desactiva scanline animado.

## 3. Vista Orquestación (qué muestra, qué hace)

Muestra:
- Grafo DAG: orquestador → nodos especialistas → agentes temporales. Aristas = delegación/comunicación con `rev`, coste, latencia.
- Tabla telemetry mono: `AGENT | MODELO | ESTADO | TOKENS | CALLS | RONDA 1/3 | EVIDENCIA`.
- Cola aprobaciones: `ID | RIESGO bajo/medio/alto | ACCIÓN | SOLICITA | [APROBAR] [RECHAZAR] [CAMBIOS]`.
- Presupuesto: barras planas (sin gradiente) `asignado / reservado / consumido / disponible proveedor`.

Hace:
- Pausar/reanudar nodo, reintentar ronda (justificando estrategia distinta), escalar a humano.
- Click en arista → filtra vista Trabajo a tareas vinculadas.
- Toda acción pasa por broker, se loguea en consola inferior.

No hace (fuera MVP): editar código inline, reconfigurar modelos por drag-drop, marketplace público.

## 4. Vista Trabajo (qué muestra, qué hace)

Cabecera: `[ SPEC ACTIVE/xxx-slug ]  spec v3 | plan v2 | tasks 12/18 | estado: VERIFICADO parcial`.
Cuerpo:
- Columna tareas: `ID | escenario Gherkin | estado implementado/verificado/aceptado/bloqueado | dueño | evidencia link`. Bloqueo en rojo `#FF2A2A` con `/// BLOQUEADO — depende API-auth`, resto sigue operable.
- `verification.md` render: comando ejecutado + salida recortada + hash + veredicto. Ausencia pruebas = banner rojo, nunca verde.
- ADRs vinculados, decisiones con procedencia.

Hace: avanzar spec→plan→tasks solo con gates SpecKit (`clarify/checklist/analyze` opcionales), marcar verificado solo con evidencia, proponer promoción temporal→local→global (no auto-activa).

## 5. Telegram como espejo (no permiso)

Comandos: `/start /status /bloqueos /consumo`. Notificación: `🚨 [ALTO] publish requiere aprobación — ID a1b2 — [Aprobar] [Rechazar]`. Callback lleva ID correlación → broker valida política global>proyecto. Sin respuesta ≠ aprobación.

## 6. Criterios aceptación UI

1. Sin evidencia no hay verde; `VERIFICADO` solo con test hash visible.
2. Bloqueo aísla dependientes visualmente, resto clicable.
3. Tokens: cero hex fuera de `@theme`, validado.
4. Teclado + lector: roles, foco, mono legible 11px mínimo.
5. Dos vistas comparten mismo store SQLite, sin divergencia.

## 9. Navegación + Configuración por módulos (implementado v0.9.16, sin cambio de spec)

- Cabecera: nav Chat/Orquestación/Trabajo/Aprobaciones/Configuración + toggle `TG: on/off` (pausa el canal sin borrar config).
- Vista Orquestación: techo/tareas + diagrama de agentes (orquestador → nodos → especializados, skills).
- Configuración — módulos, solo local: Proveedor LLM (7 proveedores, API KEY con tooltip de dónde conseguirla, filtro todos/recomendados/free, Cargar modelos, base/timeout/maxchars), Canal Telegram (interruptor, token+secreto con tooltips, allowlist, expiración; el módulo no es configurable más allá), Agentes (grafo + add/pause/skill/link), Secretos (presencia booleana, `.axiom-secrets.json` 0600 gitignored).
- Seguridad: ningún secreto viaja al navegador; los valores solo entran por POST y quedan en el servidor (env o archivo 0600).

Siguiente: validar este spec → E3 requisitos IDs → mock TUI en Fase B.

## F3. Orquestación y aprobaciones en tarjetas (aplicado v0.9.17-f3, lógica intacta)

- Orquestación: tarjeta Techo (rondas/tokens/calls + consumo real de SQLite), tarjeta Tareas (conteo por estado desde el store; clic filtra Trabajo), tarjeta Agentes (lista jerárquica orquestador → nodos → especializados + relaciones en humano, fuente `agents.config.json`, modelo "hereda del proveedor"), Actividad reciente (timeline de decisiones con quién/cuándo). Vacíos honestos con fuente y comando copiable.
- Aprobaciones: tarjeta por pendiente (herramienta + riesgo, efecto previsto en humano, quién vía broker, expira, alcance "solo esta vez", [Aprobar] [Rechazar] [Ver detalle]) + Historial (decididas con quién/cuándo/resultado). Lab movido a Configuración como herramienta de prueba del canal. Consola renombrada a Actividad con leyenda permanente.
- Sin endpoints nuevos: mismos `/api/orquestacion` (ampliado con `consumo`, `created_at`, `decided_by/at`), `/api/trabajo`, `/api/agents`, `/api/decide`.

## F4. Configuración usable sin terminal (aplicado v0.9.17-f4)

- Tooltips `?` con popover (Esc/clic fuera) en claves, token, secreto webhook y chat id; el `title` nativo se retira de esos campos.
- Detectar-mi-chat: `GET /api/telegram/detectar` lee `getUpdates` y propone autorizar con un clic; sin token o sin mensajes guía en humano.
- Olvidar-secretos: botón por clave presente (`POST /api/secrets/olvidar`); las claves del entorno no se pueden borrar desde la web y lo dice.
- Toggle Telegram optimista (pinta al instante, relee y revierte si falla) + botón de acción con verbo ("Pausar canal" / "Activar canal"); nota de alcance de la key y aviso demo-volátil.

## F1. Workbench visual (aplicado v0.9.17-f1, lógica intacta)

- Tokens: grises azulados + acento (fin del negro puro y del scanline CRT); cero hex fuera de `:root`.
- Chrome: barra de actividad (vistas), sidebar (proyecto + sesiones, placeholder honesto hasta F2), barra de estado (proveedor/modelo, Telegram, techo) alimentada por endpoints existentes.
- Sentence case en toda la UI; `>>>` y TODO-MAYÚSCULAS eliminados.
- Arreglos de chrome: toggle Telegram con etiqueta real (`Telegram: on/off`) y refresco tras pulsar; `id=consola` duplicado eliminado.
- Sin cambios de lógica: mismos endpoints, mismos contratos, sin SQLite aún (F2).

## 7. Telegram Lab (implementado v0.9.12, sin cambio de spec)

Panel `[ TELEGRAM LAB ]` de ancho completo bajo el grid: formulario CHAT + COMANDO (`/status /bloqueos /consumo /start`) + ARG que invoca el mismo `POST /api/telegram/webhook` que Telegram, y botones TG-aprobar/TG-rechazar por aprobación pendiente que ejercitan `callback_data approve:<id>/reject:<id>`. Sin token no hay envío Bot API; el estado del broker se decide igual y el log lo indica. Sin rutas API nuevas, sin deps, tokens 3 capas intactos.

## 8. Chat + Configuración (implementado v0.9.15, sin cambio de spec)

- `[ CHAT ]`: charla directa con el proveedor activo (`POST /api/adapters/spawn` con budget). Sin rondas ni broker, sin historial persistente (la charla vive en la página). El pill muestra `proveedor/model` en verde salvo `off`.

## F2. Chat con sesiones (aplicado v0.9.17-f2, ver SPEC de rediseño)

- Sidebar: proyecto visible (`GET /api/proyecto`; cada root guarda sus sesiones en su propio SQLite) + lista de sesiones (título auto = primeras palabras, renombrar, archivar, reanudar restaura historial).
- Input con modos Ask/Plan/Build + Skills (leídas del grafo real de agents) + Enviar; modelo visible y cambio de modelo marcado en el transcript.
- Persistencia: tablas `chat_sessions` / `chat_messages` en `axiom.db`; crear/renombrar/reanudar sobrevive al reinicio del servidor.
- Markdown básico en respuestas (negrita, `código`, bloques con botón Copiar) con escaping previo (sin HTML crudo del proveedor).
- `[ CONFIGURACION ] — solo local`, dos columnas: Proveedor LLM (select off|ollama|litellm + model/base/timeout/maxchars → `POST /api/adapters/config`; cambiar no toca specs) y Canal Telegram (pills de presencia BOT/SECRETO — nunca valores —, chips de allowlist con quitar, Autorizar, expiración).
- Seguridad: token y secreto solo por env del servidor (`AXIOM_TELEGRAM_BOT_TOKEN`, `AXIOM_TELEGRAM_WEBHOOK_SECRET`, `AXIOM_LITELLM_KEY`); la web jamás los pide ni los muestra, solo presencia booleana.

## 10. Balance del rediseño F1–F4 (aplicado v0.9.17, lógica intacta)

- F1 quitó la estética CRT (negro puro, mayúsculas, scanlines) y puso un workbench real: actividad, sidebar, estado, sentence case.
- F2 convirtió la charla en sesiones persistentes por proyecto (modos Ask/Plan/Build + skills reales + markdown con copiar).
- F3 convirtió orquestación y aprobaciones en tarjetas explicadas (efecto previsto, expira, alcance, historial) y mudó el Lab a Configuración.
- F4 hizo la configuración usable sin terminal (popovers, Detectar-mi-chat, olvidar-secretos, toggle optimista).
- Regla respetada en las cuatro: ningún cambio de lógica de negocio; mismos endpoints y contratos (ampliados solo con `consumo`, `created_at`, `decided_by/at` y 9 rutas documentadas en openapi.json).
- Criterios de aceptación actualizados: el chat persiste tras reinicio (§F2), la pendiente real se aprueba vía web con timeline (§F3), el alta del bot se completa solo con UI (§F4).

## F6. Nuevo proyecto (aplicado v0.9.18)

- Sidebar: botón `Nuevo proyecto` bajo el root que abre ventana modal (crear con nombre+base, usar ruta del servidor, recientes); la carpeta del proyecto —con agentes, specs y SQLite— nace o se adopta ahí.
- Cambio de root sin reiniciar (`POST /api/proyecto/crear|usar`); refresco de todas las vistas sin recargar la página; sesiones aisladas por proyecto; `usar` inicializa lo faltante sin pisar archivos.
- Criterio: crear/usar/cambiar + aislamiento de sesiones + negativos verificados contra servidor real (15/15).

## F7. Módulos (aplicado v0.9.19)

- Configuración → sección Módulos: chips con nombre, versión y estado on/off (+ marca esqueleto), botón Apagar/Encender (apagar pide confirmación), crear esqueleto por nombre; la lista se recarga sin recargar la página.
- Apagar un módulo cierra sus rutas web (409 `módulo deshabilitado`) y su CLI (sale 2 con cómo reencenderlo); el resto del IDE sigue intacto.
- Criterio: Telegram apagado con 409 verificado en sus 4 rutas + adapters intacto + esqueleto creado y listado, contra servidor real (16/16).

## F8. Agentes con definición (aplicado v0.9.20)

- Tarjeta Agentes: formulario Handoff (de, a, tarea) + historial auditado (decisión + aprobación) + hint de `agents define` para detalles (instrucciones, herramientas, presupuesto).
- El chat compone el prompt con instrucciones del orquestador e historial acotado marcado no-confiable; el grafo muestra herramientas y presupuesto cuando existen.
- Criterio: define/handoff en sus 3 decisiones + negativos + contexto acotado, contra servidor real (13/13).

## F9. Ejecución registrada (aplicado v0.9.21)

- Trabajo: botón Dry-run por spec que previsualiza el run (huella, techo, tareas, pendientes, consumo previsto) sin gastar; el resultado aparece bajo el título de la vista.
- El trace (`status --trace`) distingue `juez-fallido=sí (no es fail del trabajo)`; el informe de ronda y `verification.md` llevan juez y fecha.
- Criterio: dry-run/real/huella/negativos + juez-fallido sin consumo ni cambio de estado, contra servidor real (10/10).

## F10. Staging con allowlist (aplicado v0.9.22)

- Trabajo: cada tarea muestra `archivos=N` (chip en web, `archivos=N` en TUI, entero en `/api/trabajo`); `verify --archivos "a,b"` declara artefactos validados contra la allowlist (`project.json:allow`).
- El run (real y dry-run) avisa `staging: limpio|N fuera de allowlist (…)`; lo fuera de allow no bloquea el run, solo se informa (el bloqueo es en verify).
- Criterio: dentro de allow firma con archivos=N; fuera se rehúsa (exit 2) sin evidencia; raíz suelta aparece en el aviso.

## F11a. Allowlist editable (aplicado v0.9.23)

- Configuración → sección Staging allowlist: chips con quitar (pide confirmación), añadir por patrón y restablecer al defecto; el subtítulo informa `N patrones · M fuera: …` o `staging limpio`.
- Criterio: añadir `notas/**` permite verificar `notas/a.txt`; quitarlo lo rechaza; `..`/duplicado → 400; verificado contra servidor real.

## F11b. Consumo real (aplicado v0.9.24)

- Sin cambios de layout: el techo de Orquestación y `status --trace` ya leían `consumo` real; ahora el número es medido, no declarado a mano.
- El chat muestra el proveedor/modelo; el detalle de tokens vive en la respuesta (`uso`) y en el log del servidor.
- Criterio: 3 spawns contra usage 10+5 → `tokens=45 calls=3`; `off` no suma; verificado contra servidor real.

## F11d. Usos visibles (aplicado v0.9.25)

- Orquestación: línea `Últimos usos: +30tok(medido) …` bajo el consumo (o `sin spawns todavía`); el trace y `telegram consumo` resumen los últimos 3.
- Criterio: dos spawns medidos aparecen en TUI, web, API, trace y Telegram; verificado contra servidor real.

## F12. Run con agente (aplicado v0.9.26)

- Trabajo: botón **Run (agente)** por spec (con confirmación) al lado de Dry-run; ejecuta `POST /api/run {agente:true}` y refresca las vistas. Dry-run con `--agente` anuncia cuántos spawns haría.
- El artefacto (`trabajo-<task>.md`, juez=agente) queda en `specs/active` (allowlist) y aparece como `archivos=N` en Trabajo.
- Criterio: proveedor falso pass/fail/sin-JSON/off — los 4 casos verificados contra servidor real (verificado, bloqueado, juez-fallido sin cambio, sin consumo).
