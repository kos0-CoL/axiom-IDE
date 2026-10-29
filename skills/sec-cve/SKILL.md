# SKILL: sec-cve

Objetivo: auditoría de dependencias contra CVEs con id y versión verificable.

## Cómo trabajar con esta skill
Audita dependencias contra CVEs: ejecuta el audit del gestor (npm audit / OSV), confirma contra el lockfile instalado y reporta id CVE + severidad + versión afectada + fix disponible. Sin id y versión ejecutable no hay hallazgo; no afirmes 'sin vulnerabilidades' sin haber corrido la auditoría.

## Formato de salida
- Concreta, sin prosa de relleno.
- Cada afirmación acompañada de su evidencia o criterio de aceptación.
