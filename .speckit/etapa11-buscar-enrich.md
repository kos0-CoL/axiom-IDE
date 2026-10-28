# Spec: etapa11-buscar-enrich

## Contexto
El planificador no busca en internet: su prompt solo trae tarea + contexto +
skills. Varios agentes declaran la tool `buscar` pero nada la ejecuta. Esta
etapa implementa la tool: `buscarExterno` (EXA server-side, timeout, tope de
resultados, fail closed sin key) y `enriquecerConBusqueda` (autoriza en el
broker con contrato openWorld —ask por defecto— y devuelve el bloque de
contexto para el prompt). Sin key o sin aprobación: sale como hoy, sin
bloquear. Reutiliza `getSecret`, `autorizarUso`, el patrón `spawnFn`
inyectable de `ejecutarConRoster` y `SECRET_KEYS` (EXA ya es clave conocida).

## Criterios de aceptación
- [X] src/modules/buscar/index.ts
- [X] test/buscar-enrich.test.ts
- [X] scripts/demo-buscar.mjs

## Notas de verificación (no son archivos: el harness las comprueba al cerrar)
- Con key stubbed y `buscar=allow` declarado, devuelve resultados acotados
  (título+url+snippet) formateados como contexto.
- Sin key, sin declaración o con deny: fail closed con motivo, sin red.
- Con política que lo deja en `ask`, devuelve el approvalId sin buscar.
- Tests en verde + `tsc` limpio.
