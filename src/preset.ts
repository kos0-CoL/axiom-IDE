export const SPEC_TEMPLATE = (id: string, title: string) => `# Spec ${id} — ${title}

**versión:** v1
**estado:** draft
**origen:** MD inicial + clarify si ambiguo

## Problema
<!-- qué y por qué -->

## Requisitos
- [ ] R1: <!-- observable -->

## Escenarios (Gherkin)
\`\`\`gherkin
Feature: ${title}
  Scenario: caso principal
    Given contexto
    When acción
    Then resultado observable
\`\`\`

## Fuera de alcance
<!-- explícito -->
`;

export const PLAN_TEMPLATE = (id: string) => `# Plan ${id}

**spec_ver:** v1
**estrategia:** mínimo-escalable, jail Docker, SQLite+MD

## Paquetes afectados
- <!-- apps/... packages/... -->

## Contratos
- <!-- Tool/Zod, API, schema -->

## Riesgos
- <!-- riesgo → mitigación -->

## Migración
- <!-- pasos reversibles -->
`;

export const TASKS_TEMPLATE = (id: string) => `# Tasks ${id}

| ID | Escenario | Estado | Dueño | Evidencia |
|----|-----------|--------|-------|-----------|
| ${id}-T1 | Given/When/Then principal | implementado | unassigned | PENDIENTE |
| ${id}-T2 | Given/When/Then alternativo | implementado | unassigned | PENDIENTE |

> Estados válidos: implementado|verificado|aceptado|bloqueado|rechazado. Sin evidencia no hay verificado.
`;

export const VERIFICATION_TEMPLATE = (taskId: string, verdict: string, sha: string, cmd: string, juez = "humano", archivos = "") => `# Verification ${taskId}

**veredicto:** ${verdict}
**juez:** ${juez}
**archivos:** ${archivos || "—"}
**cmd:** \`${cmd}\`
**sha256:** \`${sha}\`
**fecha:** ${new Date().toISOString()}

> Ausencia de pruebas ≠ éxito. Este archivo es la única prueba válida para pasar a verificado/aceptado.
> Si el juez no pudo veredictar, no se escribe este archivo: se escribe verification-${taskId}-ERROR.md y la tarea sigue implementado.
`;

export const OVERRIDES_README = `# Preset axiom — overrides sobre SpecKit core

Precedencia: overrides locales > presets > extensions > core.
Este preset añade: estados implementado/verificado/aceptado/bloqueado,
verification.md obligatoria con hash, 3 rondas integración por defecto,
validate-spec con Given/When/Then.
`;
