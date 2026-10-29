# Auditoría — los tres pilares de arnés

Fecha: 2026-10-28
Método: lectura del código en `src/` y de los ADR; cada afirmación cita archivo y línea. Nada se da por
cierto porque el README lo diga: si el README y el código discrepan, manda el código y se anota.

## Veredicto en una tabla

| Pilar | Estado | Qué existe hoy | Qué falta |
|---|---|---|---|
| 1. Abstracción de modelos | **Parcial** | `SpawnResult` normaliza texto y uso para 6 proveedores; modelo por agente | Tool calls unificados (no hay `tools` nativo); routing por complejidad; fallback entre modelos |
| 2. Sandboxing | **Parcial** | Docker endurecido para `verify --cmd` y `comp`; timeouts y techos en todo el loop | Shell de agentes (no existe); memoria/CPU en el contenedor; limpieza ante timeout; scripts de skill corren en el host |
| 3. Telemetría | **Parcial-alto** | `trace_log` por tool call, `uso_log`+`consumo` de tokens, run log JSONL por archivo | Costo monetario; tokens de cache; el «pensamiento» del turno; id de correlación; export |

Ninguno de los tres está ausente. Los tres están implementados a medias, y en los tres la mitad que falta
es la que hace la diferencia entre «funciona» y «se puede auditar y abaratar».

---

## Pilar 1 — Capa de abstracción de modelos

### 1.1 Normalización de salidas: existe para texto, no para herramientas

La interfaz común existe y es la correcta: `SpawnResult { ok, text, error, ms, proveedor, model, truncada, uso }`
en [litellm.ts:12](../src/modules/adapters/litellm.ts#L12), con `UsoSpawn` en la línea 5. Todos los drivers
devuelven esa forma:

- OpenAI / OpenRouter / LiteLLM → `openai_compat.ts` (chat/completions).
- Anthropic y Google → ramas propias en `adapters/index.ts:186` y `:217`, con su propio parseo de `usage`.
- Ollama → `ollama.ts`.
- DeepSeek y cualquier gateway compatible entran por `openai_compat` sin código nuevo.

Lo que **no** existe es la normalización de *tool calls*. El cuerpo que se envía no tiene `tools` ni
`tool_choice`: [openai_compat.ts:31-33](../src/modules/adapters/openai_compat.ts#L31) manda
`{ model, messages: [{ role: "user", content: prompt }] }`; Anthropic manda un único `user` sin `tools`
(`adapters/index.ts:197`); Google manda `contents: [{ parts: [{ text }] }]` sin `tools` (`:227`).

Las herramientas se invocan **por prompting**, y el propio código lo declara:
«Los adapters no tienen function-calling nativo, así que el loop es por prompting»
([tool-loop.ts:3-5](../src/modules/agents/tool-loop.ts#L3)). El runner busca bloques ` ```tool ` con una regex
(`BLOQUE_TOOL` en `:63`, `extraerLlamadas` en `:94`) y valida cada llamada a mano (`esLlamadaUtil` en `:65`).

Consecuencia medible: una llamada a herramienta cuesta los tokens de un bloque de texto, un JSON malformado
consume un turno entero (el loop lo trata como «quiso llamar y no pudo», `tool-loop.ts:161-168`) y no hay
forma de exigir una llamada (`tool_choice`) porque no hay función que la reciba.

### 1.2 Enrutamiento: el mecanismo existe, la política no

Sí hay modelo por agente: `modelo` en el schema (`agents/config.ts:25`, default `hereda-proveedor`), resuelto por
`modeloDeAgente` ([ejecucion.ts:170-183](../src/modules/agents/ejecucion.ts#L170)) y usado en los dos caminos de
spawn (`orchestrator/agent-tool.ts:122` y `ejecucion.ts:282`).

Pero **ningún seed lo usa**: los diez agentes del roster nacen con `hereda-proveedor`
(`agents/seed.ts:44`, `:57`, `:70`, …). Y no hay nada que clasifique complejidad: un grep de
`complejidad|clasific|fallback` en `src/` no devuelve una sola línea de lógica de routing (solo nombres de
proveedores y el catálogo de modelos). Tampoco hay cadena de fallback: si el modelo asignado falla o expira,
el spawn devuelve `ok:false` y el loop aborta — no prueba otro modelo.

Es decir: la pieza de configuración está, la política de asignación está toda en la cabeza de quien edita
`agents.config.json`.

---

## Pilar 2 — Aislamiento y entorno de ejecución

### 2.1 Contenedores: sí, pero para verificar, no para trabajar

`src/sandbox.ts` es un sandbox Docker real y bien elegido ([sandbox.ts:43-57](../src/sandbox.ts#L43)):
`--user 1000:1000`, `--read-only`, `--cap-drop ALL`, `--no-new-privileges`, `--network none`,
`--pids-limit 128`, `/tmp` y `/workspace` en tmpfs `noexec`, fuente montada `:ro` y copiada a `/workspace`,
imagen fijada (`node:22.12-alpine3.20`) y allowlist de imágenes. El entorno solo acepta variables `AXIOM_*`
validadas (`:34-42`).

Se usa en dos lugares: `verify --cmd` ([commands.ts:693](../src/commands.ts#L693)) y la comparación A/B de `comp`
(`commands.ts:761-763`). **No** se usa en el camino de trabajo del agente.

### 2.2 El agente no tiene terminal — y eso hoy es implícito, no declarado

`TOOLS_LOOP` es `["leer", "delega", "buscar", "navegar"]`
([ejecucion.ts:187](../src/modules/agents/ejecucion.ts#L187)) y `herramientasLoop` solo ofrece esas cuatro
(`:205-208`). `declaracion.ts:16` mapea `terminal → ejecutar`, y media docena de seeds declaran
`{ tool: "ejecutar", acceso: "ask" }` (`seed.ts:93`, `:106`, `:155`…), pero `ejecutar` nunca entra a `TOOLS_LOOP`.
La política global puede habilitar `terminal` (`policy.ts:28` lo trata como riesgo alto) sin que nada lo ejecute.

El comportamiento es fail-closed —bien— pero la configuración miente: un agente con `ejecutar: ask` no puede
ejecutar nada y nada lo advierte. Ese es un hallazgo de auditoría por sí mismo.

### 2.3 Ejecución real fuera de Docker

- **Scripts de skill**: `spawnSync` de `sh` o `node` **en el host** (`skills/runner.ts:96-104`), con cwd fijado
  al directorio del skill, entorno filtrado a `PATH`/`HOME` (y descarta cualquier nombre con `KEY|SECRET|TOKEN`),
  `timeout: 15000`, `maxBuffer` 32 KB y salida recortada a 8 KB. Lo destructivo solo corre con `dryRun`
  (`runner.ts:91-95`). El comentario de cabecera es honesto: «No es un sandbox de contenedor»
  (`runner.ts:5`).
- **Navegador**: Chromium real como proceso hijo, con tope de 30 acciones, 10 minutos por sesión, timeout por
  acción y allowlist de dominios (`browser/sesion.ts:43-51`), y `--no-sandbox` opcional (`:389`).
- **Git**: un único `execSync("git rev-parse")` para el manifiesto (`server/manifiesto.ts:33`).

Ningún otro punto del código lanza procesos: el grep de `child_process|execFile|spawn(` no encuentra nada más.

### 2.4 Guardrails: tiempo e iteraciones sí; memoria no

Existen y son estrictos:

| Límite | Dónde | Valor |
|---|---|---|
| Timeout por llamada LLM (inactividad, se rearma con cada trozo) | `openai_compat.ts:18-25` | 30 s default, configurable 100 ms–600 s |
| Turnos del loop | `tool-loop.ts:56-58` | 4 turnos, 3 tools por turno, 6 totales |
| Techo de política | `policy.ts:2-3`, reserva 20 % | rondas / tokens / calls |
| Acciones de navegador | `browser/sesion.ts:43-51` | 30 acciones, 10 min |
| Timeout de sandbox | `sandbox.ts:22` | 30 s |
| Timeout de script de skill | `skills/runner.ts:96` | 15 s |

Faltan dos cosas concretas:

1. **Memoria y CPU del contenedor**: los args de `sandbox.ts:43-57` no incluyen `--memory` ni `--cpus`. Un
   bucle de compilación puede comerse la RAM del host. `--pids-limit 128` frena fork-bombs, no OOM.
2. **Limpieza ante timeout**: `execFile` mata al *cliente* `docker` al vencer `timeout` (`:22`), no al
   contenedor. Como `docker run` no lleva `--name`/label, si el cliente muere el contenedor sigue hasta que
   el proceso interno termine. No hay `docker rm -f` en ningún `finally`. Es una fuga silenciosa de
   contenedores que nadie ve hasta que el disco o los pids se llenan.

---

## Pilar 3 — Telemetría, evaluación y logs agénticos

### 3.1 Trazabilidad de pasos: la parte fuerte

`trace_log` existe desde ADR-0004 ([store.ts:16](../src/store.ts#L16)) y tiene la forma correcta:
`ts, origen, tool, agente, decision, riesgo, motivo, approval_id, entrada, salida, sha_io, contexto, ok, ms`.
Se escribe desde un **punto único**, el broker ([broker.ts:86](../src/broker.ts#L86), `:118`, `:303`), así que
toda autorización —CLI `check`, `run --agente`, handoff, Telegram— deja fila. El IO se guarda resumido a 500
caracteres con `sha256` del completo (`store.ts:128-134`), y se consulta por CLI (`status --trace`) y por
`GET /api/trazas` ([web.ts:1805](../src/web.ts#L1805)).

`run-log.ts` añade la traza **por run** en JSONL (`.runs/<id>.jsonl`) con `status → file_start → file_success →
error → complete` y el checkpoint del spec, que es lo que hace reanudable el build.

### 3.2 Tokens: medidos cuando el proveedor los da, estimados cuando no

- `UsoSpawn { prompt, respuesta, total, fuente: "medido"|"estimado" }` (`litellm.ts:5`).
- Anthropic lee `input_tokens`/`output_tokens` (`adapters/index.ts:207`); Google lee
  `usageMetadata.*TokenCount` (`:238`); OpenAI-compatible lee `prompt_tokens`/`completion_tokens`, también en
  streaming con `stream_options.include_usage` (`openai_compat.ts:32`, `:58-70`); Ollama estima.
- Se acumula por spawn (`addConsumo`, `store.ts:47`), se registra en `uso_log` (`:66`, últimas 50 filas) y por
  turno del loop (`ejecucion.ts:279`, `tool-loop.ts:159`).
- El chat guarda `proveedor, model, skill, ms, tokens` por mensaje (`store.ts:16`).

### 3.3 Los cuatro huecos que impiden hablar de «contabilidad»

1. **No hay costo, solo tokens.** No existe tabla de precios ni campo de moneda en ningún sitio: el grep de
   `costo|coste|usd|precio|price` solo encuentra prosa en las descripciones de skills. Sin precio por modelo no
   se puede decir cuánto costó una corrida — y sin eso, «optimizar latencia/costo» es a ciegas.
2. **Faltan los tokens de cache.** OpenAI expone `prompt_tokens_details.cached_tokens`, Anthropic
   `cache_read_input_tokens`/`cache_creation_input_tokens`, Google `cachedContentTokenCount`. Ninguno se lee:
   en `openai_compat.ts:67` y `adapters/index.ts:207` solo se piden prompt/completion. Un prompt cacheado se
   factura con un orden de magnitud de diferencia, así que el número actual sobreestima el costo real de forma
   sistemática en sesiones largas.
3. **No existe el «pensamiento».** La traza empieza en la *decisión* del broker; un turno de LLM sin
   herramienta no deja fila en `trace_log`, solo una de `uso_log` sin agente, sin modelo y sin mensaje. La
   cadena pedida — mensaje → pensamiento → tool → resultado → respuesta — está cortada en dos mitades que no
   comparten identificador.
4. **No hay id de correlación.** `contexto` es texto libre (`"run <spec>/<tarea>"`), no un `run_id`/`turn_id`.
   Unir una traza con su mensaje de chat o con su archivo del run log es *string matching*.

Extra documental: ADR-0005 se contradice — el punto 1 dice que `trace_log` es auditoría y «nunca se poda», y
el punto 2 le asigna retención de 500. El código poda 500 (`store.ts:152`), así que gana el punto 2; conviene
corregir el texto.

### 3.4 Export: ausente por decisión, no por olvido

ADR-0004 deja OTel/Langfuse fuera de alcance a propósito. Es defendible: sin volumen, un backend de spans es
infra que nadie mira. Pero conviene que el formato local sea exportable (id de traza + atributos planos) para
poder enchufar un backend después sin reescribir nada.

---

## Paso 2 — Viabilidad, costos y bloqueantes

### Pilar 1

| Cambio | Viabilidad | Bloqueante | Tamaño |
|---|---|---|---|
| `llamadas?: ToolCall[]` en `SpawnResult` | Alta | Ninguno: campo opcional, ningún llamador se rompe | 1 archivo de tipos + tests |
| Tool calls nativos en `openai_compat` | Alta | `stream: true` obliga a acumular `delta.tool_calls` por índice y cerrar con `finish_reason` | ~120 líneas |
| Tool calls nativos en Anthropic | Media | Hoy el body es **un solo mensaje de usuario**; devolver resultados exige `messages[]` con `tool_result`. Es un cambio de firma, no solo de body | ~150 líneas |
| Tool calls nativos en Google | Media | Igual: `functionDeclarations` + `parts.functionCall/functionResponse`, y `contents` pasa a ser conversación | ~150 líneas |
| Ollama | Baja (soporte desparejo por modelo) | Los tags viejos ignoran `tools` | ~60 líneas |
| Routing por complejidad | Media | No hay clasificador; un heurístico mal calibrado degrada calidad sin avisar | ~80 líneas + evals |
| Cadena de fallback ante error/timeout | Alta | Ninguno; `spawn` ya devuelve un resultado tipado | ~40 líneas |

Recomendación de orden: **fallback antes que clasificador**. Un fallback se mide (¿cuántos fallos?); un
clasificador se cree. Y el protocolo de bloques ` ```tool ` debe quedar como *fallback* permanente, no
borrarse: es lo que hoy hace funcionar a Ollama y a cualquier gateway que ignore `tools`.

Sobre `tool_choice`: solo tiene sentido en el lazo de agente y solo en el primer turno (`required`), pasando a
`auto` en los siguientes. En el chat libre y en el modo Plan obliga a llamar algo en un «hola», y como el chat
no tiene runner que ejecute la llamada, produciría tool calls fantasma.

### Pilar 2

| Cambio | Viabilidad | Bloqueante |
|---|---|---|
| `--memory`, `--cpus`, `--stop-timeout` | Trivial | Ninguno |
| `--name`/label + `docker rm -f` en `finally` | Trivial | Ninguno; requiere distinguir timeout de salida normal |
| Aviso al cargar config si un agente declara `ejecutar` sin implementación | Trivial | Ninguno |
| Shell de agente **dentro** de Docker | **Baja hoy** | El sandbox copia `/src` (ro) a `/workspace` (tmpfs) y lo descarta al terminar: sirve para verificar, no para editar. Para un agente que edita haría falta overlay persistente o devolver un diff y aplicarlo con aprobación |
| rlimit/watchdog para procesos del host (skills, navegador) | Media | `spawnSync` con `timeout` ya acota; un cgroup necesita systemd/docker |

Conclusión honesta: el sandbox actual es el correcto para su uso (verificación inmutable) y no es la base para
un «agente que trabaja con terminal». Eso es un subsistema nuevo, no un flag.

### Pilar 3

Ningún bloqueante; todo es aditivo y sin dependencias nuevas:

| Cambio | Cómo | Riesgo |
|---|---|---|
| Tokens de cache | Campos opcionales `cacheLectura?`, `cacheEscritura?` en `UsoSpawn`, leídos por proveedor | Ninguno (compat) |
| Costo | Tabla `pricing.json` (modelo → USD por millón, prompt/cache/output) y `costo_usd` en `uso_log` | Bajo; precios desactualizados → número malo, no roto |
| Turno como span | Tabla `turnos(run_id, turno, agente, modelo, prompt_sha, tokens, cache, ms, tools, ok)` | Bajo; migración `ALTER TABLE` como ya se hace en `store.ts:29` |
| Correlación | `run_id`/`turn_id` en `trace_log` y en `uso_log` (nullable) | Bajo |
| Export | Serializar a OTLP/HTTP JSON a mano (20 líneas), sin SDK | Bajo, opcional |

Sobre servicios externos: consulté el catálogo de integraciones disponibles y no hay backend de observabilidad
LLM (ni Langfuse, ni LangSmith, ni equivalente). No recomiendo agregar uno: con `trace_log` + `turnos` +
`run-log` ya está el 100 % de los datos, y el export OTLP deja la puerta abierta sin acoplar el repo a un
servicio que hoy nadie miraría.

---

## Paso 3 — Diseño de lo que falta

### 3.1 Tipos base (aditivos, sin romper `SpawnResult`)

```ts
// adapters/toolcall.ts — forma única para los cuatro protocolos.
export interface LlamadaTool {
  id: string;                 // id del proveedor o sintético (`t1`)
  nombre: string;             // nombre normalizado, el mismo de TOOLS_LOOP
  argumentos: unknown;        // ya parseado; inválido ⇒ undefined + motivo
}

export type MotivoFin = "stop" | "tool_calls" | "length" | "error";

export interface SpawnResult {
  // …campos actuales sin cambios…
  llamadas?: LlamadaTool[];   // nuevo: ausente ⇒ el modelo respondió texto
  motivoFin?: MotivoFin;
}
```

Regla de normalización: un adapter **nunca** decide políticas; devuelve `llamadas` tal cual y el
`correrLoop` sigue siendo el único que autoriza. El parseo de bloques ` ```tool ` se conserva como estrategia
`prompt` para los proveedores sin soporte, elegida por config y no por detección mágica.

### 3.2 Turno como unidad de traza

```
chat_messages / run_log ──run_id──▶ turnos ──turn_id──▶ trace_log
                                     └─ tokens: prompt | cache_lectura | cache_escritura | respuesta | costo_usd
```

Hoy `trace_log` cuelga de `contexto` (texto). Con `turn_id` en ambas tablas, `axiom status --trace` y el panel
pueden mostrar la cadena completa de un turno: mensaje, modelo, tokens, cada tool con su decisión y el texto
final.

### 3.3 Plan por fases, con criterio de aceptación

| Fase | Qué | Criterio de aceptación |
|---|---|---|
| F1 | `--memory 512m --cpus 1 --stop-timeout 10`, `--name axiom-<uuid>`, `docker rm -f` en `finally` cuando vence el timeout | test: `sandboxRun` con comando que duerme > timeout deja `docker ps` sin el contenedor |
| F2 | Aviso de configuración: `ejecutar`/`terminal` declarado en un agente sin estar en `TOOLS_LOOP` | `axiom check` (o `agents validate`) imprime el aviso y no falla hard |
| F3 | Tokens de cache + `pricing.json` + `costo_usd` en `uso_log` | test con stub de cada proveedor: un `usage` con cache produce `cacheLectura > 0` y costo menor que sin cache |
| F4 | Tabla `turnos` + `turn_id`/`run_id` en `trace_log`; escritura desde `correrLoop` y desde el chat | `status --trace <run>` muestra la cadena mensaje → turno → tools |
| F5 | `llamadas?` en `SpawnResult` + tool calls nativos en `openai_compat` detrás de `adapters toolcalls native|prompt` | con stub SSE que emite `tool_calls` partidos, el loop ejecuta la tool **una** vez y el uso registrado lo refleja |
| F6 | Anthropic/Google nativos | mismo test con sus formatos; el protocolo `prompt` sigue pasando |
| F7 | Fallback de modelo ante `ok:false`/timeout, configurable por agente | test: primer modelo devuelve `ok:false`, el segundo responde y la traza nombra ambos |

Orden recomendado: **F1, F2, F3** son de bajo riesgo y alto retorno (seguridad y costo medible). **F4** es la
que convierte la telemetría en auditoría real. **F5-F7** son el rediseño del camino de herramientas y no
deberían empezar antes de tener F3, porque sin costo por turno no hay forma de demostrar que el cambio mejora
algo.

### 3.4 Lo que deliberadamente no propongo

- Borrar el protocolo de bloques ` ```tool `: es el único que funciona con modelos sin function calling.
- Meter un vector de routing «inteligente» antes de tener datos por turno: sin costo y sin tasa de acierto por
  modelo, cualquier clasificador es una corazonada.
- Adoptar un SDK de tracing: el formato local ya es exportable; sumar dependencia hoy agrega riesgo sin
  cambiar ningún criterio verificable.
