# ADR-0007 — La orquestación de Axiom es un supervisor jerárquico con handoffs, no un swarm

Fecha: 2026-10-28
Estado: aceptado
Relación: describe la topología que ya implementan `src/modules/agents/`
(`config.ts`, `ejecucion.ts`, `handoff.ts`) y `src/orchestrator/`; no cambia
comportamiento. Ordena el vocabulario de ADR-0002 y de
`docs/harness-2.0-agentes.md` §3, donde el grafo se describe sin nombrar su tipo.

## Contexto

«Swarm» se usa hoy para casi cualquier cosa con varios agentes. En Axiom importa
fijarlo porque la palabra tiene dos sentidos que no son el nuestro:

1. **Enjambre en el sentido clásico**: control descentralizado, auto-organización
   y ausencia de coordinador externo.
2. **Nombre de un patrón o librería**: `openai/swarm` y el equipo `Swarm` de
   AutoGen, donde «swarm» designa un patrón de *handoffs* entre agentes que
   deciden localmente a quién pasar el turno.

Axiom no es ninguno de los dos: es un supervisor que reparte trabajo por un grafo
declarado en disco, con cada delegación autorizada por el broker y registrada.
Decidir esto por escrito evita dos errores caros: esperar emergencia donde hay un
grafo fijo, y llamar «swarm» a algo cuyas garantías (presupuesto, traza,
aprobación) son justamente lo contrario de la coordinación emergente.

## Criterios que separan las dos topologías

| Criterio | Swarm | Supervisor jerárquico |
|---|---|---|
| Quién elige al siguiente agente | el agente que tiene el turno, según el último mensaje/handoff | un supervisor o *lead* que planifica y delega |
| Control de la conversación | se transfiere al especialista | el supervisor lo retiene (o lo recupera al terminar la subtarea) |
| Quién coordina | nadie: decisiones locales y auto-organización | el plan del supervisor |
| Topología | emergente, puede cambiar en runtime | declarada y estable |
| Resultado | comportamiento colectivo no programado | síntesis de lo que devolvieron los subagentes |

Fuentes, con las frases que sostienen cada fila:

- **Elección del siguiente agente (swarm).** AutoGen, equipo `Swarm`: «at each
  turn, the speaker agent is selected based on the most recent HandoffMessage
  message in the context» y los agentes «make local decisions about task
  planning, rather than relying on a central orchestrator such as in
  SelectorGroupChat» — <https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/swarm.html>
- **Elección del siguiente agente (supervisor).** Anthropic, sistema de
  investigación multiagente: «Our Research system uses a multi-agent architecture
  with an orchestrator-worker pattern, where a lead agent coordinates the process
  while delegating to specialized subagents that operate in parallel» y «the lead
  agent decomposes queries into subtasks and describes them to subagents» —
  <https://www.anthropic.com/research/multi-agent-research-system>
- **Control retenido vs transferido.** OpenAI Agents SDK: en el patrón manager «a
  central manager/orchestrator invokes specialized sub-agents as tools and
  retains control of the conversation»; en handoffs «peer agents hand off control
  to a specialized agent that takes over the conversation. This is
  decentralized» — <https://openai.github.io/openai-agents-python/multi_agent/>
- **Coordinación descentralizada (definición fuerte de enjambre).** Scholarpedia:
  los sistemas de inteligencia de enjambre «coordinate using decentralized
  control and self-organization», con «collective behaviors that result from the
  local interactions of the individuals», y actúan «without the presence of a
  coordinator or of an external controller» —
  <http://www.scholarpedia.org/article/Swarm_intelligence>
- **Topología declarada vs emergente.** LangChain, multiagente: «A main agent
  coordinates subagents as tools. All routing passes through the main agent,
  which decides when and how to invoke each subagent» —
  <https://docs.langchain.com/oss/python/langchain/multi-agent>

Nota de rigor: que una librería se llame `swarm` no la vuelve un enjambre en el
sentido de Scholarpedia. El README de `openai/swarm` se presenta como
«experimental, educational» y sus dos abstracciones son «Agents and handoffs» —
<https://github.com/openai/swarm>. Es un patrón de handoffs, no un sistema
auto-organizado.

## Lo que Axiom hace, con evidencia en el código

| Criterio | Axiom | Dónde |
|---|---|---|
| Topología | declarada en `agents.config.json` (`agentes` + `aristas` con tipo `delega`/`comunica`/`escala`), validada con zod y versionada (`config_version`); el roster semilla trae **17 agentes y 23 aristas**, con un solo `orquestador` | `src/modules/agents/config.ts`, `seed.ts` |
| Siguiente agente | no lo elige el agente: `encontrarDelegado` recorre **solo las aristas salientes existentes**, en orden de prioridad `delega > escala > comunica`, y prefiere un destino que declare la herramienta requerida | `src/modules/agents/ejecucion.ts` |
| Secuencia por tarea | fija: orquestador → delegado que pueda `editar` → juez (`review`). Las tres autorizaciones se piden **antes** de gastar un spawn; un bloqueo detiene la corrida entera | `ejecutarTareaGrafo` |
| Control | vuelve al supervisor: la delegación entrega «solo contexto permitido + presupuesto» y el avance lo hace el agente que delega | `DELEGA_CONTRACT` en `handoff.ts` |
| Handoff | exige arista (`sin arista de delegación …`), se autoriza con la declaración del agente que delega, y escribe `handoff_log` con `decision` (`aprobada`/`pendiente`/`denegada`) y `approval_id`; un `pendiente` no avanza hasta `axiom approve <id>` | `handoff.ts` |
| Presupuesto | por agente (`presupuesto: {tokens, calls}`) y techo global (rondas, tokens, llamadas); el tool-loop acota además turnos (4), llamadas por turno (3) y totales (6) | `config.ts`, `policy`, `tool-loop.ts` |
| Canales entre agentes | no hay: dos nodos no se hablan sin pasar por una arista del grafo y por el broker | `ejecucion.ts` |

Leído contra la tabla anterior, Axiom cae del lado supervisor en las cinco filas.
No hay un solo punto donde un agente decida por su cuenta a quién ceder el
control.

## Una trampa de vocabulario: «handoff» no siempre significa transferir el control

En el SDK de OpenAI, handoff es transferencia: el especialista «takes over the
conversation». En Axiom, `delega` **transfiere una tarea**, no la conversación:
el subagente recibe contexto permitido y presupuesto, devuelve su trabajo, y el
control sigue donde estaba — de ahí que el juez y el registro estén del lado del
supervisor.

Que la tabla se llame `handoff_log` y el comando sea `axiom agents handoff` no
convierte a Axiom en un swarm: es delegación con retorno y auditoría, el opuesto
de un sistema donde el control se pasa y no vuelve.

## Decisión

Axiom es un **supervisor jerárquico con handoffs auditados** (patrón
orchestrator-worker de Anthropic, patrón manager de OpenAI Agents SDK). De ahí
salen tres reglas que ya están en el código y que no se deben romper sin otra ADR:

1. **La topología se edita, no emerge.** Un agente sin arista no participa, por
   más capaz que sea; `agents link` es el único modo de habilitar una delegación.
2. **Un agente propone, el grafo y el broker disponen.** Ningún agente transfiere
   control: emite `delega`, y la arista existente más la declaración del que
   delega deciden si se ejecuta.
3. **Todo handoff deja rastro.** Fila en `handoff_log`, traza del broker y, si el
   riesgo lo pide (riesgo alto → aprobación humana), concesión de un solo uso.

## Consecuencias

- **Lo que no hay que esperar de Axiom**: paralelismo emergente, agentes que crean
  sus propios pares, negociación peer-to-peer o aprendizaje colectivo entre
  nodos. Si se quiere eso, es una ADR nueva: cambia el modelo de permisos, la
  traza y el presupuesto, no solo el roster.
- **A favor**: el grafo es inspeccionable, diffeable y auditable; el módulo
  `grafos` puede comparar *intended* vs *executed*; el gasto está acotado por
  agente y por corrida; cada delegación es una tool call con decisión y motivo.
- **Costo asumido**: el supervisor es cuello de botella y las rutas que el grafo
  no declara no se exploran. Es el precio de que el sistema sea predecible: un
  mapa incompleto se nota, en vez de producir sorpresas.
- **Uso del término**: en docs, PRs y UI, Axiom es «supervisor jerárquico con
  handoffs auditados». Si aparece «swarm» describiendo este repo, esta ADR es la
  referencia para corregirlo — o para abrir la ADR que lo cambie de verdad.

## Referencias

- Anthropic — *How we built our multi-agent research system*:
  <https://www.anthropic.com/research/multi-agent-research-system>
- OpenAI Agents SDK — multiagente (manager vs handoffs):
  <https://openai.github.io/openai-agents-python/multi_agent/> · agentes como
  tools: <https://openai.github.io/openai-agents-python/agents/>
- AutoGen — equipo `Swarm`:
  <https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/swarm.html>
  · `SelectorGroupChat`:
  <https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html>
- OpenAI Swarm (experimental, educational): <https://github.com/openai/swarm>
- Scholarpedia — *Swarm intelligence*:
  <http://www.scholarpedia.org/article/Swarm_intelligence>
- LangChain — multiagente centralizado:
  <https://docs.langchain.com/oss/python/langchain/multi-agent>
- Interno: `docs/harness-2.0-agentes.md` §3 y §7 (roster, skills y handoffs);
  ADR-0002 (auditoría de harness, eje permisos); `src/modules/agents/seed.ts`,
  `src/modules/agents/ejecucion.ts`, `src/modules/agents/handoff.ts`.
