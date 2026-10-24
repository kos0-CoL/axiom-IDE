# Propuesta superadora — Axiom con flujo inspirado en Harness²

## Idea central

No queremos imitar a Harness² copiando su motor ni su ritmo.  
Queremos aprovechar lo que de verdad vale la pena y adaptarlo a Axiom.

La dirección es esta:

- mejorar el **harness**, no el modelo,
- con **componentes editables claros**,
- con un **ciclo de contraste** cuando amerita,
- con **evidencia, no intuición**,
- y con **memoria persistente** de lo que vale para después.

Al mismo tiempo, Axiom ya tiene cosas que Harness² no propone como interfaz: broker, handoff, panel de ajuste, módulos y la posibilidad de que el harness cree ayuda extra cuando un problema no se puede resolver solo.

## 1. Lo que nos vendría bien de Harness²

### 1.1. Separar ejecución de mejora

Mejor tener claro dos cosas:

- el **harness de ejecución**, que es lo que hace la tarea,
- el **harness de mejora**, que es la lógica que propone, prueba y decide cambios.

Esto evita que todo se mezcle y ayuda a que la mejora no sea un montón de reflectores sueltos.

### 1.2. Los ocho componentes editables, adaptados a Axiom

Harness² habla de un harness compuesto por componentes editables. Nosotros podemos tener una versión propia, que en Axiom signifique cosas como:

- instrucciones del orquestador,
- reglas/guías,
- memoria/contexto,
- habilidades,
- guía de herramientas,
- scripts de ejecución,
- subagentes/instancias,
- un complemento o capa de integración propia.

Lo importante no es pegar los nombres, sino tener **una lista clara de qué puede cambiar** sin tocar el núcleo por todos lados.

### 1.3. Un ciclo de contraste mínimo

Cuando un problema no es trivial y no se resuelve bien con lo normal, puede valer la pena un ciclo tipo:

1. ejecutar una referencia,
2. proponer una variante,
3. ejecutar esa variante en la misma tarea,
4. comparar,
5. componer lo que la evidencia soporte,
6. ejecutar el compuesto,
7. registrar lo que se decidió y por qué.

Esto es lo que me parece el mejor aporte: no mejorar por “se sintió bien”, sino por contraste observable.

### 1.4. Evidencia antes de adoptar

Mejor separar claramente:

- lo que cambió,
- qué se observó,
- qué soporta el cambio,
- qué no se garantiza.

Es decir: contraste no es verificación perfecta. Ayuda a decidir, pero no convierte una propuesta en verdad absoluta.

### 1.5. Memoria persistente de mejora

Guadar para después:

- lo adoptado,
- la evidencia asociada,
- el contexto y el problema que tuvo,
- por qué se reutiliza o se adapta después.

Y lo crucial: la tarea siguiente no hereda automáticamente el harness de la anterior; reutiliza o adapta selectivamente lo que parece útil.

## 2. Lo que nos sobra o no conviene traer tal cual

- El motor de benchmarks y la infraestructura específica de ejecución de Harness².
- Cualquier idea de mejora ciega o automática sin revisión.
- Copiar que “todo mejora solo” sin criterio ni evidencia.
- Creer que Harness² ya define instancias efímeras, limbo de agentes o creación reactiva de ayuda como parte central del método.

Eso nos sobra como메카니스모 externo; nosotros podemos decidir si los incorporamos, pero no hay que asumirlos como parte obligatoria del flujo.

## 3. Lo que Axiom ya aporta y que encaja bien

Me parece que esto ya nos da una base distinta y útil:

- el **broker** como decisor de permisos y preguntas,
- el **handoff** como transferencia auditada entre agentes,
- las **propuestas estructuradas** con revisión humana,
- un **panel de ajuste** para ver, editar y decidir,
- y los **módulos** como capa complementaria, sin tocar el núcleo.

Esto es bueno porque nos da una interfaz y una gobernanza que Harness² no propone como producto visible.

## 4. La parte nueva que sí debería tener Axiom

### 4.1. Harness con potestad de crear ayuda cuando amerita

Si un problema no puede resolver solo, el harness podría:

- reconocer que la dificultad no es menor,
- generar dos o más agentes o estrategias distintas para atacarlo,
- dejar uno con la solución,
- y mandar el otro, o lo que aportó, a un **limbo con registro**.

Este limbo no es desaparición ni obligación de integrar. Es: queda disponible, con evidencia, para revisión futura.

Esto me parece una extensión razonable y no algo que haya que forzar siempre.

### 4.2. Limbo como estado de registro, no de olvido

El limbo me parece útil si tiene:

- qué se hizo,
- por qué se generó,
- qué aportó,
- por qué no se integró de inmediato,
- y si sigue siendo relevante.

Así no se pierde lo útil y no se convierte en estructura permanente sin más.

### 4.3. El panel de ajuste como lugar de control

El panel debería poder mostrar:

- estructura estable,
- lo que el harness creó o propuso,
- lo que quedó en limbo,
- lo que se integró,
- la evidencia atrás de cada cosa,
- y permitir revisar, editar, aprobar o rechazar.

Esto es lo que evita que la mejora sea un tubo opaco.

### 4.4. Módulos como capa complementaria sin tocar el circuito base

Si un usuario quiere crear un módulo que complemente esta lógica, debe poder hacerlo sin tener que saber de hooks ni de código interno.

El módulo puede aportar:

- observación,
- criterio propio,
- propuestas propias,
- o una capa de comportamiento en un punto del flujo.

Pero el circuito base sigue siendo el circuito base. El módulo modifica el recorrido del usuario o de la tarea en un punto determinado, no reescribe el sistema para todos.

## 5. Qué creo que debería ser el orden

1. Primero, definir bien la separación entre ejecución y mejora.
2. Segundo, definir qué componentes editables tiene el harness en Axiom.
3. Tercero, definir un ciclo de contraste mínimo compatible con el broker y el handoff.
4. Cuarto, definir qué se guarda como mejora persistente y cómo se reutiliza después.
5. Quinto, definir el caso del harness que crea ayuda extra y lleva lo sobrante a limbo.
6. Sexto, definir cómo se ve y edita esto en el panel de ajuste.
7. Séptimo, dejar claro cómo entran los módulos complementarios sin romper el circuito base.

Ese orden me parece menos volátil que empezar por el panel o por los umbrales.

## 6. Lo que no quiero que se convierta en esto

- un sistema que promueva agentes efímeros a permanentes por repetición sola,
- un panel que solo muestre “el harness aprendió” sin poder editar ni entender por qué,
- un módulo que pueda tocar cualquier parte sin reglas,
- ni una mejora que se base en intuición sin evidencia.

Lo que importa es que la mejora sea visible, criticable, y con criterio.

## 7. Resumen

Creo que la propuesta superadora es esta:

- tomar de Harness² la separación ejecución/mejora, los componentes editables, el contraste y la memoria de lo útil,
- adaptarlo a Axiom, no copiarlo,
- mantener lo que ya tiene sentido aquí: broker, handoff, propuestas, panel y módulos,
- y agregar una capacidad deliberada del harness para crear ayuda cuando amerita, comparar, y dejar lo útil en un limbo con registro.

Esto me parece más honesto que “nos volvemos Harness²”, y más útil que “el harness solo ejecuta sin mejorar”.

## Nota interna: pendiente por revisar después

- Módulo como capa complementaria para modificar comportamiento sin tocar el circuito base.
- Imagen de referencia: circuito de carreras + atajo en la pista propia, sin reescribir el circuito original.
- El usuario no debería tener que saber de hooks ni de inversión de código.
(Fuente: conversación pendiente, anotada en NOTAS-propuesta-superadora.md)
