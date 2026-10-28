// Nodo Architect — solo corre en modo Plan. Genera la spec inicial en
// `.speckit/<nombre>.md` con los criterios de aceptación como una tarea por
// archivo (`- [ ] ruta`). Es el único escritor del checklist inicial.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function specMarkdown(nombre: string, archivos: string[]): string {
  const lineas = [`# Spec: ${nombre}`, "", "## Criterios de aceptación", ""];
  for (const a of archivos) lineas.push(`- [ ] ${a}`);
  lineas.push("", "_Origen de la verdad: este archivo. El orquestador lo relee en cada iteración._", "");
  return lineas.join("\n");
}

export function escribirSpecPlan(root: string, nombre: string, archivos: string[], modo: string): string {
  if (modo !== "plan") {
    throw new Error(`architect solo corre en modo plan (recibido: ${modo})`);
  }
  if (!archivos.length) throw new Error("architect necesita al menos un archivo objetivo");
  const dir = join(root, ".speckit");
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, `${nombre}.md`);
  writeFileSync(ruta, specMarkdown(nombre, archivos));
  return `.speckit/${nombre}.md`;
}
