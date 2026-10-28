# Harness 2.0 en Axiom: qué agentes faltan y qué piezas del harness

> Investigación hecha el 2026-10-26 sobre fuentes primarias. Cada afirmación numérica
> cita la página que la declara. No se inventaron agentes ni cifras.

## 1. Qué es «Harness²» de verdad

`google-research/harness2` existe, pero **no es un catálogo de 50-60 agentes**: es un
marco de investigación para modificar y mejorar recursivamente el harness de un agente.
El README define *harness* como el sistema alrededor del modelo (prompts, herramientas,
memoria, habilidades, orquestación) y *harnessing* como optimizarlo. Propone dos niveles
de recursión:

1. **Nivel tarea**: propone un cambio de harness, lo prueba en la misma tarea y combina
   las mejoras según resultados.
2. **Nivel harnessing**: conserva los harnesses adoptados y las lecciones respaldadas
   por evidencia para futuras mejoras.

Enumera **ocho componentes editables**: system prompt, guardrails, memoria, guía de
herramientas, subagentes, habilidades, scripts y plugins. El propio repo aclara que **no
es un producto oficialmente respaldado por Google**, y no publica un inventario de agentes
ni un esquema «rol + herramientas + modelo + memoria + presupuesto» por agente.

Fuente: <https://github.com/google-research/harness2>

## 2. De dónde sale la cifra de 50-60 agentes

Lo que sí publica catálogos grandes son colecciones de subagentes de la comunidad. No son
Harness² y sus cifras no son comparables entre sí:

| Repositorio | Cifra declarada | Foco | URL |
|---|---|---|---|
| `0xSteph/pentest-ai-agents` | 50 en el README, 52 en el texto de instalación | Pentesting y seguridad ofensiva | <https://github.com/0xSteph/pentest-ai-agents> |
| `VoltAgent/awesome-claude-code-subagents` | 161+ en 10 categorías | Catálogo generalista de subagentes | <https://github.com/VoltAgent/awesome-claude-code-subagents> |
| `wshobson/agents` | 202 agentes locales; 94 plugins, 185 skills, 105 comandos | Catálogo generalista por dominio | <https://github.com/wshobson/agents> |
| `lst97/claude-code-sub-agents` | 33 | Ciclo de vida de desarrollo | <https://github.com/lst97/claude-code-sub-agents> |

Claude Code trae agentes propios (`Explore`, `Plan`, `General-purpose`, `claude`,
`statusline-setup`, `claude-code-guide`) pero **no declara un total de colección**:
<https://code.claude.com/docs/en/sub-agents>.

OpenAI Agents SDK y LangGraph **no tienen catálogo**: son frameworks con ejemplos o
patrones (por ejemplo, tres agentes en el ejemplo de atención al cliente). Comparar su
«número de agentes» no significa nada: <https://openai.github.io/openai-agents-python/handoffs/>,
<https://docs.langchain.com/oss/python/langgraph/workflows-agents>.

Conclusión: **«harness 2.0 = 50 agentes» no está respaldado por la fuente que se cita**.
Tener 200 agentes tampoco es el criterio de calidad: Anthropic y OpenAI recomiendan
empezar con pocos roles, aislar contexto y restringir permisos, y usar más especialistas
solo cuando aportan independencia o herramientas más acotadas
(<https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk>).

## 3. Lo que Axiom tiene hoy

- Semilla única en `src/modules/agents/seed.ts`: **17 agentes** y **23 aristas**. La
  consumen `defecto()` (proyecto sin `agents.config.json`) y `src/proyectos.ts`
  (esqueleto de proyecto), así que ambos cargan el mismo grafo.
- Catálogo de skills: **23** con cuerpo (13 originales + 10 nuevas: `explorar`, `seguridad`,
  `docs`, `datos-esquema`, `rendimiento`, `accesibilidad`, `release`, `incidentes`,
  `dependencias`, `evaluacion`).
- **Cada agente declara sus herramientas** (`leer=allow`, `buscar=allow`, `editar=ask`,
  `ejecutar=ask`…). El broker las cruza con la política: `deny > ask > allow` y lo no
  declarado se deniega, de modo que la declaración es una cota, no un permiso.
- `delega=allow` en los 7 agentes con aristas salientes (`orquestador`, `planificador`,
  `implementador`, `explorador`, `verificador`, `revisor`, `evaluador-harness`): el handoff
  se autoriza con la declaración del agente que delega.
- El runner (`run --agente`) consulta al broker **antes** de cada uso: `delega` del orquestador
  al nodo, `editar` del nodo para escribir su trabajo y `delega` del nodo al juez. `deny`
  detiene la corrida sin gastar spawn; `ask` deja la aprobación y una concesión autoriza un
  solo uso. Las herramientas que el runner no puede ejercer (p. ej. `ejecutar`) siguen siendo
  cota declarada, no capacidad: no hay ejecución de comandos en el grafo.
- Roles disponibles: `orquestador`, `nodo`, `especializado`, `subagente`.

Hallazgo corregido: antes el seed por defecto (6 agentes, ids `nodo-code/nodo-review/
esp-seguridad`) y el esqueleto (7, ids `planificador/implementador/verificador/revisor`)
eran grafos distintos. Ahora hay una sola fuente y un test que fija la igualdad.

## 4. Gap por función

Criterio: funciones que la documentación de Anthropic, OpenAI/ADK y OWASP consideran
necesarias en un harness de código de producción, no una lista de deseos.

| Función | Axiom hoy | Falta | Prioridad |
|---|---|---|---|
| Orquestación y planificación | `orquestador` + `planificador` (oleada 1), skills `plan`/`broker` | Límites de iteración y presupuesto efectivos en la ejecución real | Alta |
| Exploración del código antes de tocar | `explorador` (solo lectura) | Que el grafo lo invoque antes de `implementador` en la ejecución real | Alta |
| Implementación acotada | `implementador` con `editar=ask` | — | — |
| Verificación con evidencia | `verificador` + `verify`/`testing`/`evidence` | Ejecución real de la suite en el grafo (hoy es CLI) | Alta |
| Revisión independiente del diff | `revisor` (solo lectura) | Revisar archivos inesperados y desviaciones de spec en cada corrida | Media |
| Seguridad | `revisor-seguridad` (`policy`, `sandbox`, `seguridad`, `sec-*`) | Controles deterministas (escaneo de secretos, dependencias) conectados al broker | Alta |
| Datos y esquema | `especialista-datos` (`datos-esquema`) | Ejecución local de migraciones y verificación en el grafo | Alta si hay datos |
| Rendimiento | `rendimiento` (oleada 2) | Línea base automatizada por tarea | Media |
| Accesibilidad | `accesibilidad` (oleada 2) | Pruebas de UI automatizadas | Media (si hay UI) |
| Documentación | `documentador` (`docs`) | Verificación de docs contra comportamiento en CI | Media |
| Release y despliegue | `release` (oleada 2) | Publicación automatizada (hoy es explícitamente humana) | Media |
| Incidentes | `incidentes` (oleada 2) | Fuentes de logs y métricas conectadas | Baja por defecto |
| Observabilidad | — | Trazas, SLI/SLO, instrumentación | Baja por defecto |
| Dependencias | `dependencias` (oleada 2) | Auditoría automática (licencias, CVEs) | Media |
| MCP / integraciones | — (hay módulo `telegram`, MCP no) | Servidor y cliente MCP | Media si se usa MCP |
| Prompts y evaluación del harness | `evaluador-harness` (`evaluacion`) | Bucle con presupuesto `k` y adopción de cambios | Alta para 2.0 |
| Memoria | `experiencia`, `propuestas`, `handoffs` | Memoria por agente y recuperación por tarea | Media |

Fuentes de las funciones: subagentes y permisos por agente
(<https://code.claude.com/docs/en/agent-sdk/subagents>), ciclo contexto→acción→verificación
(<https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk>),
orquestador-worker y sus costes (<https://www.anthropic.com/research/multi-agent-research-system>),
evaluar trayectoria y herramientas además del texto
(<https://adk.dev/evaluate/>, <https://developers.openai.com/api/docs/guides/agent-evals>),
riesgos de permisos excesivos y contenido del repo como instrucciones
(<https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html>).

## 5. Roster propuesto

**Estado: oleadas 1 y 2 implementadas** en `seed.ts` (14 agentes nuevos, 10 skills nuevas
con cuerpo y herramientas declaradas en los 17 agentes). La oleada 3 sigue siendo
propuesta.

### Oleada 1 — núcleo verificable (8 agentes)

| id | rol | skills | herramientas (`tool=acceso`) | Por qué |
|---|---|---|---|---|
| `planificador` | nodo | `plan`, `broker` | `leer=allow`, `buscar=allow` | Convierte el pedido en criterios de aceptación; hoy está solo en el esqueleto |
| `explorador` | nodo | `explorar`, `minimal-diff` | `leer=allow`, `buscar=allow` | Mapa del código sin editar; separa contexto de acción |
| `implementador` | nodo | `implementar`, `minimal-diff` | `leer=allow`, `editar=ask`, `ejecutar=ask` | Único que escribe código |
| `verificador` | nodo | `verify`, `testing`, `evidence` | `leer=allow`, `ejecutar=ask` | Corre la suite y deja evidencia |
| `revisor` | nodo | `review`, `evidence` | `leer=allow` | Revisión de solo lectura, independiente del implementador |
| `revisor-seguridad` | especializado | `policy`, `sandbox`, `seguridad`, `sec-threat-model`, `sec-cve`, `sec-hardening`, `sec-injection`, `sec-auth`, `sec-net` | `leer=allow`, `buscar=ask` | Secretos, permisos, dependencias, CI, threat model, CVEs, hardening, inyección, auth, red |
| `documentador` | especializado | `docs`, `minimal-diff` | `leer=allow`, `editar=ask` | Docs que no derivan del comportamiento |
| `especialista-datos` | especializado | `datos-esquema`, `verify` | `leer=allow`, `ejecutar=ask` | Migraciones con rollback, solo si hay esquema |

### Oleada 2 — producción (8, activar según riesgo)

`arquitecto` (revisión de coherencia), `depurador` (hoy `cazador-fallos` cubre parte),
`rendimiento`, `accesibilidad`, `release`, `incidentes`, `dependencias`,
`evaluador-harness` (prompts y evaluación de trayectoria).

### Oleada 3 — especialistas bajo demanda

Lenguaje/framework (`typescript-pro`, `python-pro`, `golang-pro`, `rust-engineer`…),
cloud/IaC (`cloud-architect`, `terraform-engineer`, `kubernetes-specialist`), móvil,
datos/ML, blockchain, pagos. **No por defecto**: la guía primaria es crear el especialista
cuando el trabajo lo pide, con herramientas más restringidas, no tener 200 agentes
inactivos. Los catálogos que sí los tienen los declaran como colección instalable
(`wshobson/agents` 202; `VoltAgent` 161+), no como grafo activo.

## 6. Skills que faltan (con cuerpo)

Un agente nuevo sin skill con cuerpo no enseña nada: `loadAgents` acepta el id, pero el
prompt solo recibe el nombre. Para las oleadas 1 y 2 hacen falta al menos:

`explorar`, `seguridad`, `datos-esquema`, `rendimiento`, `accesibilidad`, `docs`,
`release`, `incidentes`, `dependencias`, `evaluacion`, `refactor`, `git`.

Se pueden crear sin tocar código desde Ajustes → Módulo Skills (editor de `SKILL.md`),
que es justo la costura que acaba de añadirse.

## 7. Lo que falta del harness 2.0 además de agentes

| Componente (Harness²) | Axiom |
|---|---|
| System prompt | ✅ skills con cuerpo + `defensa.ts` + `instrucciones` por agente |
| Guardrails | ⚠️ baseline anti-inyección + broker con doble cota (política ∧ agente) + `policies.global.json`; falta evaluar la salida |
| Memoria | ⚠️ `experiencia`, propuestas y handoffs; no hay memoria por agente |
| Guía de herramientas | ⚠️ herramientas declaradas con acceso, sin guía de uso por herramienta |
| Subagentes | ⚠️ el rol existe y las aristas los expresan; falta ejecución anidada real |
| Habilidades | ✅ catálogo + override editable por proyecto |
| Scripts | ⚠️ `run`/`verify` existen; no hay scripts registrados por agente |
| Plugins | ❌ no hay mecanismo de plugins |
| Recursión (proponer → evaluar → adoptar → conservar lecciones) | ⚠️ hay propuestas de harness y memoria; falta el bucle con presupuesto `k` y evaluación comparable |

Ese último punto es el que separa «muchos agentes» de «harness 2.0» según la fuente
primaria: sin bucle de evaluación que conserve lo adoptado, ampliar el roster solo agrega
superficie.

## 8. Orden recomendado

1. ~~Unificar seed por defecto y esqueleto~~ — hecho: `seed.ts` es la única fuente.
2. ~~Oleada 1 con sus skills con cuerpo y sus herramientas declaradas~~ — hecho: 8 agentes
   nuevos, 4 skills nuevas (`explorar`, `seguridad`, `docs`, `datos-esquema`) y
   herramientas declaradas en los 11 agentes.
3. Bucle de evaluación del harness (candidato → prueba → adoptar → lección) con `k` acotado.
4. Oleada 2 — agentes creados; falta asociar a cada uno una verificación automática.
5. Especialistas de oleada 3, creados al necesitarse.
