# Axiom IDE — E4 Modelo de políticas (formal)

**Fecha:** 2026-10-20
**Base:** v0.2 §§10-13 + E3 AXM-020/022/025 + decisiones 2026-10-20
**Estado:** Propuesta revisable, sin código.

## 1. Jerarquía de autoridad

```
GLOBAL (policies.global.json, solo owner)  >  PROYECTO (project.json)  >  RUN (proceso/agente)
```

- Global define máximos y garantías no eludibles: tools admitidas, techo rondas/llamadas/tokens/concurrencia, niveles que exigen humano, sandbox obligatorio.
- Proyecto solo restringe o ajusta hacia abajo dentro del marco global. Toda llave `allow` de proyecto se evalúa como `allow_global AND allow_project AND check_ejecución`.
- Cambio de política mid-run: se aplica de inmediato; op activa se cancela segura si pierde permiso, se loguea `policy_revoked`.
- Test negativo obligatorio: proyecto que habilita `terminal` con global `terminal:false` → `deny + audit`.

## 2. Contadores separados + techo agregado

Contadores independientes (no se fusionan):
`retries_agente | rondas_integración (default 3) | agentes_simultáneos | tool_calls | tokens_in+out | tiempo_wall | recursos_sandbox`

Regla anti-multiplicación:
```
efectivo = min(global, proyecto, run)
rondas(≤3) × intentos_por_ronda(≤n) × paralelismo(≤p) ≤ techo_agregado_global
paralelismo no crea presupuesto nuevo, lo reparte.
```

Detección ciclos: `hash(error_normalizado + diff_paths)` — 3 idénticos → `escalar_humano`, no consume resto del techo.
Reserva verificación: 20% del presupuesto de unidad se reserva para `verify`; sin reserva, `run` rehúsa nueva historia (AXM-023).

Estados presupuesto: `asignado | reservado | consumido | disponible_proveedor`. Estimación siempre con rango `[p50-p90]`, nunca número único.

## 3. Matriz riesgo → aprobación

| Nivel | Ejemplos | Aprobación |
|---|---|---|
| BAJO | lectura, `status`, tests en jail, `validate-spec` | auto, logueado |
| MEDIO | escribir código aislado, instalar dep pinned, crear especialista temporal | regla proyecto: auto si habilitada o `ask` |
| ALTO | migración, publish, cambio seguridad/permisos, red externa, promoción local→global, borrar versión | humana explícita TUI o Telegram con ID correlación, expira en 30min, sin respuesta = deny |

Mapeo MCP: cada tool declara `readOnlyHint/destructiveHint/idempotentHint/openWorldHint` → nivel. Sin anotación = ALTO por defecto.

## 4. Promoción componentes (temporal→local→global)

- **Temporal:** crear dentro de límites autorizados, vive solo en run, se archiva como historial. Requiere nivel MEDIO.
- **Local proyecto:** usar solo en ese proyecto. Requiere evaluación aislada Docker vs estable (calidad, tests, coste, errores) + aprobación proyecto. Nivel MEDIO/ALTO según riesgo.
- **Global:** compartido. Requiere evaluación + compatibilidad + aprobación global explícita + ventana rollback. Nivel ALTO siempre.
- Promoción conocimiento ≠ promoción componente: útil no autoriza copiar contexto proyecto a global.
- Rollback: conserva `fábrica + en uso`; borrar otras exige chequeo dependencias directas/indirectas.

## 5. Aislamiento ejecución (default Docker)

`local` solo para lectura; `docker` default para escritura/tests; `microvm` futura sin cambiar interfaz `sandbox.spawn()`.
Docker: digest pineado, non-root UID 1000, `read_only:true`, `cap_drop:[ALL]`, `no-new-privileges`, source RO → copia tmpfs `/workspace` `0700`, `network_mode:none` default, `pids_limit` finito, secretos nunca en capas, solo `env_file` runtime.
Perfil `networked` solo opt-in visible con nombre distinto + aprobación ALTA + destrucción inmediata tras uso.

## 6. Telegram = canal

Bot solo transporte: `/status /bloqueos /consumo`, notifica con `ID correlación + diff resumido + riesgo`. Aprobar/Rechazar vía inline keyboard → `broker.approve(id, quien, cuando)`. Broker revalida política vigente en ese instante, no la del momento de solicitud. Todo auditado en SQLite.

## 7. Auditoría mínima no rebajable

La evaluación inteligente solo eleva, nunca rebaja: `verification.md` con hash, doble-eje review en PR, test negativo global>proyecto, informe de ronda fallida, rollback demo. Ausencia de estos = `no aceptado` aunque el agente afirme éxito.

Siguiente: E5 contratos/flujos + E6 plan granular.
