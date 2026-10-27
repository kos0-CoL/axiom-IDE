# ADR-0002 — Auditoría de madurez del harness (awesome-harness-engineering)

Fecha: 2026-10-27
Estado: aceptado
Referencia: https://github.com/ai-boost/awesome-harness-engineering (README + templates/HARNESS_CHECKLIST.md)

## Contexto

El checklist de awesome-harness-engineering evalúa un harness en 7 ejes. El bar es estricto:
un ítem fallido bloquea; un ítem omitido necesita justificación escrita. Se audita Axiom MVP-0
contra ese checklist para decidir qué integrar y en qué orden, sin reescribir lo que ya existe.

## Auditoría

| Eje (checklist) | Estado Axiom | Evidencia / gap |
|---|---|---|
| Instrucciones del agente | ✅ | AGENTS.md con comandos probados y reglas duras; skills por proyecto (`skills/<id>/SKILL.md`) sobreescriben el catálogo |
| Calidad de tools | ✅ | Contratos Zod (E5 §4); tools acotadas por módulos; errores con formato consistente |
| Entrega de contexto | ✅ | Skills inyectados al prompt por id; catálogo con una sola fuente (`modules/agents/skills.ts`) |
| Planning verificable | ✅ | Flujo `spec → plan → tasks → verify`; PLAN por tarea con milestones y comandos de verificación |
| Permisos / sandbox | ✅ | broker es único punto de decisión (`allow|deny|ask`); boundaries por CI (`scripts/check-boundaries.mjs`); sandbox docker |
| Verificación + evidencia | ✅ | Sin evidencia (cmd+sha+veredicto) no hay verificado/aceptado; tabla `evidences` |
| Evaluación (evals) | ⚠️ | Skill `evaluacion` existe como instrucción, pero no hay suite de evals ni línea base ejecutable del harness |
| Observabilidad / tracing | ✅ | Cada tool call deja traza en `trace_log` (decisión + IO resumido con sha256 del completo) desde `broker.check()`; `axiom status --trace` la consulta por tarea y global (ADR-0004; el export OTel/Langfuse sigue opcional según E5) |
| Memoria entre sesiones | ✅ | Estrategia por capas escrita y operativa (ADR-0005): auditoría intocable, retención automática en logs, `axiom memory [estado|compact --dry-run]` para EXPERIENCE.md y sesiones archivadas — olvido solo explícito y anotado |
| Browser como tool | ❌ | No hay módulo de navegador: el agente no puede verificar UI ni navegar URLs (gap de verificación, no solo features) |
| Seguridad ofensiva/defensiva | ❌ | Solo el skill `seguridad` (revisión estática); sin skills de dominio (threat modeling, hardening, auditar dependencias) |
| Diagramas como artefacto | ⚠️ | Módulo `grafos` compara intended vs executed, pero no genera diagramas de arquitectura/flujo revisables |

## Decisión

Integrar los gaps en orden de valor de verificación, siempre como módulos/fachadas
delgadas que no tocan el núcleo (regla de boundaries):

1. **ADR + módulo `browser`** (nuevo): fachada sobre un motor de navegador ya disponible
   en el entorno; sirve `datosModulo` con sesiones/acciones y expone CLI propia.
2. **Skills de seguridad**: traducir skills de dominio al catálogo/overrides en
   `skills/security/<id>/SKILL.md`; no sustituyen al broker, solo instruyen.
3. **Diagramas**: evaluar extender `grafos` antes que crear módulo nuevo (un solo grafo
   intended/executed ya cubre el panel; los diagramas de arquitectura salen de specs/ADRs).
4. **Evals y tracing**: queda abierto; se aborda cuando haya runs suficientes para línea base.

## Consecuencias

- Axiom gana capacidad de verificación en navegador y conocimiento de dominio de seguridad
  sin duplicar lógica en el núcleo: todo entra por `src/modules/<n>/` con manifest y superficie declarada.
- Los ítems ⚠️ (evals, tracing, compaction de memoria) quedan justificados como fuera del
  alcance de MVP-0 según el criterio del propio checklist ("skipped item needs written justification").
- `OpenKerving` no se integra: no se localizó un repositorio con esa identidad; si es un typo
  (p. ej. OpenKantu u otro), reabrir este ADR con la referencia exacta.
