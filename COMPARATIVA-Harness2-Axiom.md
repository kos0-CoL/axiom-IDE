# Comparativa Harness² vs Axiom (v0.9.31)

Referencia: GitHub Spec Kit (https://github.github.com/spec-kit/) y `PROPUESTA-Superadora-Axiom-Harness2.md`.
Esta comparativa describe lo que existe hoy en el código, no lo prometido.

## 1. Flujo de trabajo

| Concepto Harness² / Spec Kit | En Axiom hoy | Estado |
|---|---|---|
| Specify → Plan → Tasks → Implement | `spec`, `plan`, `tasks`, `run` | Cubierto |
| Verificar con evidencia | `verify` con cmd+sha+veredicto, `evidences` | Cubierto |
| Converge (cerrar el ciclo y comparar con la intención) | No existe comando | **Brecha** (paso 2) |
| Ciclo de contraste (referencia vs variante) | `comp eval|compare|battery`, baterías en sandbox | Cubierto parcial |
| Memoria persistente | `EXPERIENCE.md`, `harness_snapshot`, `harness_propuestas` | Cubierto |

## 2. Componentes editables del harness

| Componente (propuesta) | En Axiom | Estado |
|---|---|---|
| Instrucciones del orquestador | `agents define <id> instrucciones` | Cubierto |
| Reglas / políticas | `policies.global.json`, `project.json` | Cubierto |
| Memoria / contexto | `EXPERIENCE.md`, contexto acotado no confiable | Cubierto |
| Skills | `agents skill`, skills validadas | Cubierto |
| Guía de herramientas | `herramientas` con `allow/ask/deny` por agente | Cubierto (declarativo) |
| Scripts de ejecución | `sandbox`, `run` | Cubierto |
| Subagentes / instancias | `agents add` con rol `subagente` (sin ejecución real) | Parcial |
| Integración propia | Módulos con `datosModulo` y `module new` (esqueleto + manifiesto) | Cubierto |

## 3. Lo que Axiom aporta y Harness² no muestra como producto

- Broker con permisos allow/deny/ask y aprobaciones auditadas.
- Handoff auditado (`delega` con arista exigida).
- Propuestas de harness con gate humano (nada se auto-aplica).
- Módulos con superficie validada y convención `datosModulo` sin cableado.

## 4. Brechas reales (no implementadas)

1. **Converge**: comparar lo especificado con lo verificado y decir qué falta. Paso 2 lo añade como comando del preset.
2. **Árbol visual de agentes con tooltips y modo EDITAR**: hoy la red es lista/texto; el grafo SVG solo muestra intended vs executed en el módulo grafos. Paso 3.
3. **Limbo con registro** (agentes sobrantes disponibles para revisión): no implementado; sigue como propuesta de diseño.
4. **Ejecución real de subagentes**: fuera de alcance de esta ronda.

## 5. Orden de integración elegido (menor conflicto)

1. **Comparativa** (este documento): cero código, cero conflictos.
2. **Preset Spec Kit como módulo nuevo** (`src/modules/speckit/`): no toca `web.ts` ni `ui.ts`; solo se registra en el catálogo de `modulos.ts`, el CLI y el preflight.
3. **Árbol visual de agentes**: último, porque toca `web.ts` (1757 líneas, el archivo más compartido) y `ui.ts`. Con los pasos 1 y 2 ya estables, el cambio queda acotado a la vista de Orquestación y a Configuración → Módulo Agentes.

Motivo del orden: cada paso añade superficie sobre la anterior; hacer la UI al final evita rehacerla si el preset cambia el modelo de datos.
