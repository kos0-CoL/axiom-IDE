# ADR-0006 — Browser como tool del agente: sesiones conducibles por CDP

Fecha: 2026-10-27
Estado: aceptado
Relación: cierra el hueco "Browser como tool" ❌ de ADR-0002 (la captura de
`verify --url` ya existía; el agente no podía conducir un navegador).

## Contexto

El módulo `browser` solo capturaba screenshot/DOM de una URL como evidencia
(ADR de verify --url). El checklist exige que el agente pueda **verificar UI y
navegar**: abrir una página, interactuar y leer el resultado, con la misma
disciplina del resto de herramientas (decisión única en el broker, traza por
llamada, presupuesto y fail-closed).

## Decisión

Sesiones de navegador **conducibles**, dentro del módulo `browser`
(`src/modules/browser/sesion.ts`), sin dependencias nuevas:

1. **Transporte CDP por pipe**: se lanza el mismo motor detectable que ya usa
   la captura con `--remote-debugging-pipe` (JSON delimitado por `\0` por los
   fd 3/4). Cero dependencias npm; sin motor el módulo sigue fail-closed.
2. **Tools nuevas, decisión en el broker** (contrato con anotaciones; el riesgo
   lo deriva `riskOf`): `navegar` (openWorld → alto: aprobación humana por
   uso), `clic` y `escribir` (escriben → medio: exigen global+proyecto),
   `esperar`, `leerTexto` y `capturar` (solo lectura → bajo; el interruptor es
   el módulo), `cerrar` (bajo). Toda llamada deja traza con `contexto` de
   sesión y entrada acotada (AXM-066 sigue siendo la misma fuente).
3. **Aprobación manual**: las filas sin agente se consumen con la nueva
   `consumirAprobacionManual` (misma CAS de un solo uso que la del runner);
   patrón idéntico a `autorizarUso`: primero consumir, después decidir.
4. **Límites duros de sesión** (no dependen de política): máximo de acciones
   (defecto 30), tiempo máximo (defecto 10 min), solo `http(s)` y allowlist de
   dominios opcional (`browser.config.json → sesiones.dominios`). La URL final
   (tras redirecciones) también se valida. Sin motor o módulo apagado: 409/exit
   2, igual que `verify --url`.
5. **Superficie**: CLI `axiom browser abrir|nav|click|type|wait|text|shot|
   cerrar|sesiones` (la captura puntual `browser <url>` no cambia), web
   `GET /api/browser/sesiones` + `POST /api/browser/accion` (origen `web`) y
   `datosModulo` con las sesiones para el panel. Como la sesión vive en la
   memoria de su proceso (sin espejo en disco), `abrir` de la CLI se queda en
   una **consola de sesión** que lee las mismas acciones de stdin hasta
   `cerrar`/`exit`/EOF —y la cierra al salir para no dejar huérfanos—; el
   servidor web, al ser de larga duración, la conduce entre peticiones.

## Consecuencias

- El agente (y el humano por CLI/web) puede conducir un navegador con las
  mismas garantías que `editar`: decisión del broker, traza, aprobación de un
  solo uso y límites de sesión que ninguna política puede desactivar.
- Elegir el sitio (`navegar`) siempre pasa por un humano; una vez dentro de la
  sesión, las interacciones quedan acotadas por la allowlist y el presupuesto
  de acciones.
- Fuera de alcance deliberado: descargas, autenticación gestionada, varios
  targets/pestañas y crawling multipágina (se añade sobre esta base).
- Cerrado por `test/browser-tool.test.ts` + caso `browser-tool` de
  `npm run evals` (omitido justificado sin motor de navegador).
