# ADR-0010 — Tool calls nativos en el adapter OpenAI-compatible

## Estado

Aceptado. Detrás de flag; sin impacto en los caminos existentes.

## Contexto

Hoy las herramientas se invocan por prompting: el loop manda instrucciones en texto,
busca bloques ````tool JSON` con `extraerLlamadas` (`src/modules/agents/tool-loop.ts`)
y valida cada una a mano. No hay `tools` ni `tool_choice` en los cuerpos que los
adapters envían, porque ningún driver los prepara (`src/modules/adapters/openai_compat.ts`,
Anthropic y Google también sin `tools`).

Consecuencias medibles:

- Una llamada a herramienta cuesta los tokens del bloque de texto y la JSON malformada
  consume un turno entero (el loop lo trata como «quiso llamar y no pudo»).
- No hay forma de exigir una llamada (`tool_choice: "any"`) porque no hay función que la
  reciba.
- El parsing regex depende del formato textual del modelo; un modelo que emita
  ````tool (...)` de otra forma o elimine la firma rompe el loop sin avisar.

## Decisión

1. El driver `spawnOpenAICompat` recibe un parámetro abierto opcional (`SpawnAbierto`:
   `toolDefiniciones?`, `toolChoice?`) y, cuando se lo pasan, añade `tools` y
   `tool_choice` al cuerpo de la API. Sin el parámetro el comportamiento actual no cambia.
2. El resultado incluye `toolCalls?: ToolCallNativo[]` cuando el modo está abierto y el
   modelo devuelve `tool_calls` (campos `name` y `arguments`).
3. El streaming vuelve a recibir un temporizador: cada Δε recibido lo rearma; un modelo
   que escribe vivo y lento no muera por el reloj total (que era el motivo de los
   «timeout 120000ms» en modelos lentos).
4. El streaming también recoge `tool_calls` por delta, indexado por `index`, para no
   descartar una llamada emitida en stream.
5. La capa pública expone `spawnConTool(root, task, herramientas, override)` que
   delega a `spawn` pasándole `abierto`. Anthropic, Google y Ollama todavía no envían
   `tools` por esta ruta; devuelven `toolCalls` vacía. Cuando ese soporte exista, se
   añade en su driver, no en este.

## Alternativas consideradas

- **Solo streaming sin acumulador de tool_calls por index**: descartar el delta de
  `tool_calls` en stream. Rechazado: perdería la primera mitad de una llamada larga.
- **Otro driver nativo por provider**: abrir Anthropic/Google/Ollama en paralelo ahora.
  Rechazado: el trabajo actual es solo OpenAI-compatible; los otros son opt-in futuro.
- **Solo `tool_calls` en non-stream**: ignorar streaming en el tema. Rechazado: el
  streaming ya lleva `include_usage`; tirar la parte de herramientas del stream es una
  regresión.

## Antes y después (contrato)

- Antes: `invokeModel`/el loop mandaba un `user` único sin `tools`; el parser regex
  recuperaba las llamadas.
- Después: cuando el llamador pasa `herramientas`, el body lleva `tools` y
  `tool_choice`; la respuesta incluye `toolCalls` cuando el modelo las emite; el mismo
  parser regex sigue siendo una capa disponible (no se borra) por si un proveedor
  devuelve texto sin tool calls nativos. El loop puede decidir qué fuente usar.

## Riesgos

- **Proveedor sin tool calling real**: el cuerpo se envía y el modelo puede ignorarlos.
  Mitigación: `SpawnAbierto` es opcional; sin él no hay cambio.
- **Streaming y tool_calls simultáneos**: un modelo puede responder con contenido y
  herramientas intercaladas; acumulamos ambas partes. Mitigación: `toolCalls` y `text`
  son independientes; el loop decide.
- **Fallos de formato en tool_calls no recogidas**: filtros defensivos en la extracción
  de `tool_calls` evitan crashes por JSON inesperado; si el modelo devuelve algo raro,
  se pierde la llamada pero no se rompe la respuesta.
