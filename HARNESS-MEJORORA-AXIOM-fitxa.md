# Fitxa — millora del harness a Axiom (decisió interna)

> Aquesta fitxa tanca la nota interna com a decisió curta. No és un pla terminat, ni un compromís de codi. És el que Ara mateix em sembla que val la pena conservar, què cal afegir després i què es pot deixar de banda.

## 1. Què sí que tinc clara

El nervi del projecte ja no és aquest:
- millorar el harness, no el model,
- amb components editables clars,
- amb un cicle de contrastaçió quan cal,
- amb evidència, no intuïció,
- i amb memòria persistent de el que val per després.

I alhora Axiom ja porta coses que Harness² no ofereix com a interfície visible: broker, handoff, propostes auditades, painel i mòduls. Això dona gobernança, no només execució.

## 2. Què em sembla que cal aprofitar de Harness²

No cal copiar el motor ni el ritme. Cal aprofitar la idea bonica, no la infraestructura específica:

- separar execució de millora,
- deixar clar què pot canviar sense tocar el nucli per tots els costats,
- contrastar quan un problema no és trivial,
- guardar per després el que es va adoptar, amb la seva evidència i context,
- i no fer que la tasca següent hereti automàticament el harness de la anterior.

Aquesta última és una de les coses que més em sembla que cal deixar clara en l'arquitectura.

## 3. Què em sembla que es pot deixar de banda

- El motor de benchmarks i l'infraestructura concreta d'execució de Harness².
- Qualsevol idea de millora cega o automàtica sense revisió.
- La il·lusió que “tot millora sols” sense criteri ni evidència.
- Creure que Harness² ja defineix instàncies efímeres, limbo d'agents o creació reactiva d'ajuda com a part central del mètode.

Això ens sobra com a mecanisme extern. Nosaltres podem decidir si el col·loquem aquí, però no l'hem de prendre com a part obligatòria del flux.

## 4. Què already cal afegir després, de manera serena

Des de aquí, el que em sembla que val la pena afegir no és “fer Harness²”, sinó afegir:

- el broker com a decisor de permisos i preguntes,
- el handoff com a transferència auditada entre agents,
- les propostes estructurades amb revisió humana,
- un painel de l'ajust per veure, editar i decidir,
- i els mòduls com a capa complementària, sense tocar el nucli.

I, si m'hi ha de forçar alguna cosa nova, que no sigui forçosament sempre, sinó la capacitat deliberada del harness per crear ajuda extra quan cal, comparar i deixar allò útil en un limbo amb registre.

## 5. Per què aquesta fitxa existeix

Perque no es perdi el criteri mentre entren dos agents llegint context, mentre tanco coses internes i mentre segueixo llegint-codi. La fitxa deixa escrit:

- què caldrà conservar,
- què potser no caldra endur,
- i què cal preguntar abans de seguir.

## 6. Punt que cal decidir abans de seguir

Mentres l'agent web llegia Harness² jo tinc dos agents treballant en paral·lel aquí. Si vols que tregui el context i n'esperi només un, digues-m'ho i jo els recull; si vols que segueixi així, continuo igual.

Això és una decisió de context, no de producte, però em sembla que cal dir-ho ara per no barrejar les dues coses.

## 7. Següents passes que et proposo, si et sembla

- definir quin és el primer component editable que AQUEST SÍ cal implementar ara dins d'Axiom,
- després mirar quina part de `experience.ts` cal ampliar per a la memòria de millora,
- i després decidir on mostrem el limbo al painel de ajust.

Deixo això com a tasques a resoldre junts, no com a compromís.

## 8. La idea que sí que em queda clara

No vull copiar Harness². Vull conservar els esquelets que valen la pena:

- separació execució/millora,
- components editables,
- contrast amb evidència,
- memòria persistent,
- i després afegir-hi el que fa sentit a Axiom: broker, handoff, propostes auditades, painel, mòduls i possibilitat deliberada de crear ajuda extra amb un limbo amb registre.

Això és, en el meu criteri, més honest que “ens virem Harness²” i més útil que “el harness només executa sense millorar”.
