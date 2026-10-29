# Costos por turno

Cada llamada al modelo registra tokens, tokens de cache y, si hay precio declarado, costo en USD.
Este documento fija el formato y la fórmula; lo que no hay es una tabla de precios incorporada.

## Por qué no hay precios de fábrica

Las tarifas cambian por modelo, por tramo de cache y por proveedor. Un número viejo presentado como
medido es peor que un vacío: el harness registraría un costo falso con la misma confianza que uno
real. Sin `pricing.json`, los tokens se miden igual y `costo_usd` queda en `NULL`.

## `pricing.json`

En la raíz del proyecto, USD por **1 000 000** de tokens:

```json
{
  "openai/gpt-4o-mini":     { "prompt": 0.15, "cacheLectura": 0.075, "respuesta": 0.60 },
  "claude-3-5-sonnet":      { "prompt": 3,    "cacheLectura": 0.30, "cacheEscritura": 3.75, "respuesta": 15 },
  "google/gemini-2.0-flash":{ "prompt": 0.10, "cacheLectura": 0.025, "respuesta": 0.40 }
}
```

- Clave `proveedor/modelo` o `modelo` a secas. Se busca exacto con proveedor, exacto sin proveedor y,
  si no, por **prefijo más largo**: `gpt-4o-mini` cubre `gpt-4o-mini-2024-07-18`.
- `prompt` y `respuesta` son obligatorios y no negativos. `cacheLectura` y `cacheEscritura` son
  opcionales: si faltan, esos tokens se cobran al precio de `prompt` (no se asume descuento).
- Una tabla inválida se ignora **entera**: no se aplica media configuración.

## Tokens de cache por proveedor

`uso.prompt` es siempre la entrada **total facturable**, con el cache incluido. El desglose queda en
`cacheLectura` / `cacheEscritura`:

| Proveedor | Campo leído | Convención |
|---|---|---|
| OpenAI / OpenRouter / LiteLLM | `prompt_tokens_details.cached_tokens` | subconjunto de `prompt_tokens` |
| Anthropic | `cache_read_input_tokens`, `cache_creation_input_tokens` | aditivos a `input_tokens`; se normalizan sumándolos a `prompt` |
| Google | `cachedContentTokenCount` | subconjunto de `promptTokenCount` |
| Ollama | — | sin cache; el uso se estima |

OpenAI incluye `include_usage` en streaming, así que el último evento trae la medición completa (no se
suman trozos). Anthropic no tenía cache leído y su `prompt` subcontaba la entrada: ahora suma los tres
campos, y por eso el techo de tokens ve el gasto real.

## Fórmula

```
fresco   = prompt − cacheLectura − cacheEscritura        (nunca < 0)
costo    = (fresco·precio.prompt + cacheLectura·precio.cacheLectura
          + cacheEscritura·precio.cacheEscritura + respuesta·precio.respuesta) / 1 000 000
```

Se redondea a 9 decimales: una llamada chica cuesta fracciones de centavo y redondear a 6
convertiría `0,0000795` en `0,00008`.

## Dónde queda

| Tabla | Grano | Campos |
|---|---|---|
| `uso_log` | una fila por spawn/turno (retención 50) | `proveedor`, `modelo`, `cache_lectura`, `cache_escritura`, `costo_usd` |
| `chat_messages` | una fila por mensaje del chat | `tokens`, `costo_usd` |
| `consumo` | acumulado por unidad (global) | `tokens`, `calls`, `costo` |

El acumulado no se re-deriva: cambiar `pricing.json` no reescribe lo ya gastado. `axiom status` y
`axiom adapters datos` muestran el costo acumulado y el de los últimos usos; el panel web recibe los
mismos campos desde `datosOrquestacion`.

## Sandbox: recursos y limpieza

Independiente del costo, pero del mismo endurecimiento: `sandboxRun` (verify `--cmd`, `comp`) corre
con `--memory 512m --memory-swap 512m --cpus 1 --pids-limit 128 --network none --read-only`,
contenedor nombrado y `docker rm -f` **siempre** al terminar. Un timeout devuelve 124 y lo dice en la
salida; antes devolvía 0, así que un comando colgado podía sostener una evidencia falsa.
`axiom sandbox spec` imprime la política vigente.
