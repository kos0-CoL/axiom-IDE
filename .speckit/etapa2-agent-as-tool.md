# Spec: etapa2-agent-as-tool

## Contexto
Hoy el orquestador delega por handoff (el especialista toma el control).
Falta el patrón agent-as-a-tool (ADK `AgentTool`, OpenAI `as_tool`): el
especialista recibe una tarea estrecha, devuelve un resultado pequeño y el
padre sintetiza. La autorización vive en el broker, no en el prompt.
Reutiliza `src/broker.ts`, `src/modules/agents/*` y `src/orchestrator/`.

## Criterios de aceptación
- [ ] src/orchestrator/agent-tool.ts
- [ ] test/agent-as-tool.test.ts
- [ ] scripts/demo-agent-tool.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Registro: un especialista del roster se expone como tool con esquema de
  entrada/salida estrecho, `max_turns`/timeout propios y `parent_call_id`
  en eventos padre→hijo.
- El broker autoriza cada invocación (deny por defecto); el prompt no decide.
- Demo: el orquestador delega una subtarea, el padre sintetiza, y el trace
  muestra ambas llamadas enlazadas. Tests en verde + `tsc` limpio.
