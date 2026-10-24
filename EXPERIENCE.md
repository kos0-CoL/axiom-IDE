# EXPERIENCE — memoria del harness

> Una lección por verify (pass/fail/error-juez): qué del harness ayudó o estorbó.
> El harness = agentes + instrucciones + skills + aristas (agents.config.json).
> Las propuestas de ajuste se revisan en Plan y las aplica un humano
> (`agents define` / `agents link`); aquí nunca se auto-aplica nada.


## 2026-10-23T23:42:01.951Z — test-spec-T1 → pass (juez=humano)

- harness: 4 agentes (orquestador:orquestador, nodo-code:nodo, nodo-review:nodo, esp-seguridad:especializado) · 4 aristas (orquestador—delega→nodo-code; orquestador—delega→nodo-review; nodo-code—escala→esp-seguridad; nodo-review—comunica→orquestador) · fp 62d720cc
- ayuda/estorba: sin nota (usa --detalle para decir qué del harness ayudó o estorbó)

## 2026-10-24T00:06:12.019Z — test-spec-T2 → fail (juez=agente)

- harness: 4 agentes (orquestador:orquestador, nodo-code:nodo, nodo-review:nodo, esp-seguridad:especializado) · 4 aristas (orquestador—delega→nodo-code; orquestador—delega→nodo-review; nodo-code—escala→esp-seguridad; nodo-review—comunica→orquestador) · fp 6457df09
- ayuda/estorba: sin nota (usa --detalle para decir qué del harness ayudó o estorbó)
