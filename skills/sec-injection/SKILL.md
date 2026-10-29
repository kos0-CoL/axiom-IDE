# SKILL: sec-injection

Objetivo: caza de inyección (SQL, shell, XSS, path traversal) con camino entrada→sink.

## Cómo trabajar con esta skill
Caza inyección: consultas sin parametrizar, entrada concatenada en shell/HTML/SQL, deserialización no confiable, path traversal y XSS por salida sin codificar. Señala el camino entrada→sink con archivo:línea; sin camino reproducible, márcalo como sospecha, no como hallazgo.

## Formato de salida
- Concreta, sin prosa de relleno.
- Cada afirmación acompañada de su evidencia o criterio de aceptación.
