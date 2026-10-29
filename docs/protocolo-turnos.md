# Protocolo de turno — cuánto ahorra la variante corta

Fecha: 2026-10-28
Medido con: `node scripts/protocolo-tokens.mjs` sobre los turnos reales del proyecto.

## Qué se manda

El chat recibe uno de dos bloques, nunca los dos:

| Variante | Cuándo | Tamaño |
|---|---|---|
| Completo (`PROTOCOLO_CHAT`) | turno con verbo de tarea o texto ≥ 30 caracteres | 1 619 caracteres ≈ 405 tok |
| Corto (`PROTOCOLO_CHAT_CORTO`) | `esTrivial()`: texto corto sin verbo de tarea | 281 caracteres ≈ 71 tok |

`esTrivial` vive en `src/sessions.ts` y reconoce el voseo acentuado («arreglá») y los
enclíticos («arreglame», «revisalo», «decime»); los saludos siguen siendo simples. Los agentes
del grafo no entran en este reparto: siempre reciben el bloque completo, porque su loop sí
tiene herramientas y cada llamada se autoriza y se traza.

## Cómo se midió

`scripts/protocolo-tokens.mjs` no inventa conversaciones:

1. Lee los mensajes de usuario guardados en `<root>/axiom.db`, con el modo real de su sesión.
2. Reconstruye cada prompt con el mismo `promptPara` que arma el prompt de producción —
   instrucciones, enfoque, historial y baseline anti-inyección incluidos.
3. Compara ese prompt contra el mismo prompt con el bloque completo. El delta es exacto:
   se cambia un único bloque en la misma posición.
4. Convierte a tokens a 4 caracteres por token, el mismo criterio de `usoEstimado` cuando el
   proveedor no reporta `usage`. Es una estimación, no la contabilidad del proveedor.

Reproducir: `node scripts/protocolo-tokens.mjs` (o `--root <dir>` para otro proyecto).

## Resultado

Sobre los 31 turnos de usuario de este proyecto, de los cuales 21 son simples:

| Concepto | Caracteres | Tokens (est.) |
|---|---|---|
| Bloque completo | 1 619 | 405 |
| Bloque corto | 281 | 71 |
| **Ahorro por turno simple** | **1 338** | **335** (83 % del bloque) |
| Prompt con variante corta (tal como sale) | 52 563 | 13 141 |
| Prompt con bloque completo (hipotético) | 80 661 | 20 166 |
| **Ahorro medido en la muestra** | **28 098** | **7 025** (35 % del prompt) |

Ejemplos de turnos que cayeron del lado simple: «hola», «continua», «di hola en una línea».

## Cómo leerlo

- El ahorro **por turno simple es fijo**: 335 tokens de entrada. No depende del largo del hilo.
- El porcentaje sobre el total depende de dos cosas: cuántos turnos son simples (acá 21 de 31,
  68 %) y cuánto pesa el historial. En un hilo largo con historial grande el porcentaje baja,
  porque el protocolo es un costo fijo por turno y el historial crece.
- Solo mide **entrada**. El protocolo no cambia la longitud de la respuesta, así que no hay
  ahorro de salida que atribuirle.
- Los 4 caracteres por token son una aproximación: el delta de caracteres es exacto, la
  conversión no. Sin tabla de precios y sin tokens de cache (ver
  [auditoria-pilares-arnes.md](auditoria-pilares-arnes.md), pilar 3) este número no se traduce
  a dinero.
- La variante corta no desaparece del todo en un saludo: conserva la regla de «no simular
  agentes ni describir archivos que no abriste», que es justamente la que se rompía antes de
  existir el gate.
