# Spec: etapa9-ejecutar-real

## Contexto
`invocarAgenteComoTool` recibe `ejecutar` inyectado: en todo código no-test
es un stub. Esta etapa le da el ejecutor real `ejecutarConRoster`, que carga
al especialista del roster, construye su prompt con `construirPromptAgente`
y hace `spawn` con su modelo (o el global si hereda). Fail closed ante
agente inexistente, pausado o spawn fallido. Reutiliza
`src/modules/agents/ejecucion.ts` (`construirPromptAgente`,
`modeloDeAgente`), `loadAgents` y `spawn` de adapters.

## Criterios de aceptación
- [X] src/orchestrator/agent-tool.ts (ejecutarConRoster)
- [X] test/agent-tool-ejecutar.test.ts
- [X] scripts/demo-agent-tool-roster.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Con roster temporal y spawn inyectado, el especialista devuelve texto y el
  padre sintetiza; el trace enlaza padre→hijo con decisión allow.
- Agente inexistente/pausado o spawn con `ok:false` fallan cerrado sin
  ejecutar nada más.
- Tests en verde + `tsc` limpio.
