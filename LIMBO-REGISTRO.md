# Limbos / Limbo — registro editables (definición inicial)

> Estado propuesto para proyecto: **editable candidato, no auto-integrado** ni eliminado.  
> Vigencia: revisar antes de seguir ampliando el panel. Ahora mismo, mientras dos agents leen el contexto de Harness² y yo cierro el fitxa, dejo aquí la decisión mínima que creo que vale la pena tomar ya y la que conviene confirmar contigo.

## 1. Decisión que sí reviso ahora mismo

El fitxa que cerré (`HARNESS-MEJORORA-AXIOM-fitxa.md`) es la nota interna más razonable que me queda. Ella decida tres cosas:

- qué de Harness² calza con Axiom (separación ejecución/mejora, componentes editables, contraste con evidencia, memoria persistente),
- qué sobra o no conviene traer tal cual (motor de benchmarks, mejora ciega/auto-aplicada, y todo lo que haría que “se sienta Harness²” sin ser útil aquí),
- y qué añadir después des de aquí: broker, handoff, propuestas auditadas, panel, módulos y **la posibilidad deliberada de crear ayuda extra con un limbo con registro**.

Así que el limbo no entra como característica forzada, sino como una extensión razonable cuando un problema no se puede resolver solo.

## 2. Qué me parece que calza aquí

El limbo, en esta propuesta, no es desaparición ni es obligación de integrar. Es un registro:

- qué se hizo,
- por qué se generó,
- qué aportó,
- por qué no se integró de inmediato,
- y si sigue siendo relevante.

Eso calza con lo que ya tienes: broker decide, handoff transfiere auditado, las propuestas se revisan en Plan, y el panel es el lugar de control. El limbo sería, en el fondo, otro tipo de registro con su propio estado, pero sin que el sistema lo pregunte continuamente ni lo integre por repetición.

## 3. Decisión mínima que yo sí veo clara para ya

Para ahora, no necesito crear la tabla, el CLI o el panel. Creo que sí conviene dejar claro, en un registro corto y en catalán o en el idioma que tú uses, lo siguiente:

- el limbo existe como idea de registro, no como función activa;
- si llegamos a implementarlo, el harness generaría dos o más estrategias/agentes distintos, dejaría uno con la solución y mandaría el excedente a limbo con evidencia;
- el panel, cuando exista, podría mostrar estructura estable, lo creado o propuesto, lo que quedó en limbo, lo integrado, y la evidencia detrás de cada cosa.

Esto es una línea editorial, no un compromiso de código.

## 4. Lo que queda para confirmar tú

Aquí es donde el fitxa no decide por ti. Creo que conviene confirmar:

1. si perdemos los dos agents que teníamos colocados para leer Harness² y esperar un solo contexto, o los dejamos en paralelo mientras yo cierro;
2. si quieres que el limbo sea un concepto a definir antes de tocar código, o si ya prefieres un primer componente editable concreto dentro de Axiom antes de hablar de limbo;
3. y si el panel de ajustes/límpido que mencionas es la misma pantalla de orquestación/memoria, o algo aparte que deberíamos nombrar con su propio nombre.

Los dos primeros puntos los tira el contexto actual; el tercero es el que más adelanta o retrasa lo que viene.

## 5. Próximos pasos propuestos, si te cuadra

Si te parece bien dejar claro el limbo como concepto y luego pasar a código, yo seguiría este orden, sin apurar nada:

- definir el primer componente editable que sí calza ahora con Axiom;
- mirar qué parte de `experience.ts` conviene ampliar para la memòria de millora;
- y després decidir on mostrem el limbo al painel de ajuste, si pensamos que calza.

Si en cambio prefieres frenar aquesta línia i anar a coses més concretes, també llegeixo això com una ordre.

Nota breu pel que fa al idioma: el fitxa i aquest registre els deixo en català perquè així més còmode em queda resumir el criteri sense perdre el fil entremig. Si prefereixes que tot el projecte avanci en castellano, anglès o una altra cosa, digues-m'ho i canvio el to, però no canvio la decisió que ya t'he deixat escrita.
