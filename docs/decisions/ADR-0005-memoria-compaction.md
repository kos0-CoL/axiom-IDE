# ADR-0005 — Memoria: retención por capas y compactación explícita

Fecha: 2026-10-27
Estado: aceptado
Relación: cierra el gap "Memoria entre sesiones" ⚠️ de ADR-0002.

## Contexto

La memoria de Axiom es archivos (skills, specs, ADRs, EXPERIENCE.md) + SQLite.
La auditoría señalaba que **no había estrategia de compaction/olvido para
sesiones largas**: EXPERIENCE.md se le `append` con cada verify sin cota,
`chat_messages` crece mientras la sesión viva (solo se borra al borrar la
sesión) y varias tablas de auditoría crecen sin límite. El lector de chat ya
estaba acotado (`contextoSesion`: 8 mensajes / 3000 chars), pero el
almacenamiento no.

## Decisión

**Retención por capas, olvido solo explícito:**

1. **Auditoría — nunca se poda:** `evidences`, `trace_log`, `handoff_log`,
   `bloqueos`, `aprobaciones`. Son la cadena de evidencia; un "olvido" aquí
   rompería la trazabilidad (AXM-063). Si alguna vez crece demasiado, se
   archiva fuera de línea, no se borra en caliente.
2. **Logs de actividad — retención automática ya existente:** `uso_log` ≤50,
   `trace_log` ≤500 (ADR-0004). Sin cambios.
3. **Lo que crece sin cota — compactación EXPLÍCITA** con
   `axiom memory compact [--keep N] [--dry-run]`:
   - `EXPERIENCE.md` a las últimas N lecciones (default 50). El olvido **queda
     anotado en el propio archivo** (`> Última poda: … N lecciones
     eliminadas`): nadie puede confundir un archivo podado con uno completo.
   - `chat_messages` de sesiones **archivadas** a los últimos 200 por sesión.
     Las sesiones activas jamás se tocan (el usuario sigue en ellas).
   - `VACUUM` solo si algo se podó.
4. **`axiom memory` (sin args)** es el estado: tamaños/contadores por capa,
   qué tiene retención conocida, qué es auditoría intocable y qué comando es
   accionable.

`--dry-run` calcula sin escribir: la poda es una decisión humana, no un
mantenimiento silencioso.

## Consecuencias

- El criterio del gap queda verificable: hay estrategia escrita, comando que
  la aplica y estado que la describe.
- **Fuera de alcance:** archivado automático de auditoría (no hay volumen que
  lo justifique aún), compactación de sesiones activas y export de la memoria
  a otro soporte.
- Cubierto por `test/memoria.test.ts` (4 tests: estado, poda anotada,
  sesiones archivadas vs activas, auditoría intacta + dry-run).
