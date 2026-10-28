# Spec: etapa14-chat-dispara-orquestador

## Contexto
El chat en modo Build genera `propuesta_archivos` (contenido directo del
LLM, aplicado a mano con «Aplicar cambios») y el plan aprobado guarda
`spec.md` + `plan.md` sin checklist de archivos. El `AgentOrchestrator`
(variantes, run-log, resume, manifiesto) solo corre vía `axiom build <ruta>`
o `/api/build/stream?spec=<ruta>`, que exigen un checklist `- [ ] ruta`:
con la spec del chat (un `- [ ]` genérico) produciría rutas basura. Esta
etapa pone el puente plan→tasks y el botón que dispara el pipeline desde el
chat, reutilizando `spawn` (completion crudo del proveedor configurado),
`resolver` con fail closed y el handler SSE ya compartido.

## Criterios de aceptación
- [X] src/orchestrator/desde-plan.ts (resolverSpecBuild + asegurarTasksDesdePlan)
- [X] src/commands.ts (construirBuild acepta id de spec y deriva tasks)
- [X] src/server/build-events.ts (stream resuelve id y deriva tasks o falla cerrado)
- [X] src/web.ts (botón Construir con pipeline en la tarjeta de plan aprobado)
- [X] test/plan-tasks.test.ts
- [X] scripts/demo-plan-tasks.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- `axiom build <id>` con tasks existentes las reutiliza; sin tasks las deriva
  con UNA llamada al proveedor y escribe `tasks.md` (máx 20, sin espacios,
  sin `..`, sin absolutas); sin proveedor o sin líneas válidas falla cerrado
  sin escribir basura.
- `/api/build/stream?spec=<id>` hace lo mismo antes del primer evento; con
  ruta cruda sigue igual que antes.
- El botón del chat abre EventSource y pinta file_start/file_success/error/
  complete en vivo; si pausa ofrece reanudar (`&resume=1`).
- Tests en verde + `tsc` limpio.
