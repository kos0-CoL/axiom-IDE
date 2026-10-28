// Propose–Probe–Compose en pequeño (corazón Harness²).
// Ante un fallo de validación: propone 2 variantes (de prompt o de skill),
// las prueba contra el validator (probe barato, sin gastar tokens de más),
// compone la ganadora y registra la lección en EXPERIENCE.md con evidencia.
// Presupuesto fijo: 2 variantes por fallo. Si ninguna pasa, se pausa como hoy.
import { validarCodigo } from "../nodes/validator.js";
import { registrarLeccion } from "../experience.js";

export interface PropuestaVariante {
  id: string;
  descripcion: string;
  /** Transforma el prompt o el código base en la variante a probar. */
  producir: () => string;
}

export interface PropuestaVarianteAsync {
  id: string;
  descripcion: string;
  /** Puede re-llamar al coder (fresh sample) o sanear localmente. */
  producir: () => string | Promise<string>;
}

export interface ResultadoProbe {
  id: string;
  descripcion: string;
  ok: boolean;
  errores: string[];
  codigo?: string;
}

export interface ResultadoComposicion {
  ganadora?: ResultadoProbe;
  probes: ResultadoProbe[];
}

/** Probe barato: cada variante se valida en local, sin LLM. */
export function probarVariantes(variantes: PropuestaVariante[]): ResultadoComposicion {
  const probes: ResultadoProbe[] = [];
  for (const v of variantes.slice(0, 2)) {
    let codigo = "";
    try {
      codigo = v.producir();
    } catch (e) {
      probes.push({ id: v.id, descripcion: v.descripcion, ok: false, errores: [`variante lanzó: ${e instanceof Error ? e.message : e}`] });
      continue;
    }
    const val = validarCodigo(codigo);
    probes.push({ id: v.id, descripcion: v.descripcion, ok: val.ok, errores: val.errores, codigo: val.ok ? codigo : undefined });
    if (val.ok) return { ganadora: probes[probes.length - 1], probes };
  }
  return { probes };
}

/**
 * Saneado local barato: quita cercas ``` y la cháchara previa al código
 * (primeras líneas sin pinta de código). Es un probe, no una promesa: el
 * validator decide si el resultado vale.
 */
export function sanearCodigo(codigo: string): string {
  const lineas = codigo
    .split("\n")
    .filter((l) => !/^\s*```/.test(l))
    .filter((l) => !/^\s*<\/?(code|pre)>\s*$/.test(l));
  const PINTA_CODIGO = /(;|\{|\}|\(|\)|=>|=|import |export |const |let |var |function |return |if |for |#include|def |class )|^\s*\/\//;
  let i = 0;
  while (i < lineas.length && !PINTA_CODIGO.test(lineas[i])) i++;
  return lineas.slice(i).join("\n").trim() + "\n";
}

/** Probe barato async: cada variante se valida en local, sin gastar LLM de más. */
export async function probarVariantesAsync(variantes: PropuestaVarianteAsync[]): Promise<ResultadoComposicion> {
  const probes: ResultadoProbe[] = [];
  for (const v of variantes.slice(0, 2)) {
    let codigo = "";
    try {
      codigo = await v.producir();
    } catch (e) {
      probes.push({ id: v.id, descripcion: v.descripcion, ok: false, errores: [`variante lanzó: ${e instanceof Error ? e.message : e}`] });
      continue;
    }
    const val = validarCodigo(codigo);
    probes.push({ id: v.id, descripcion: v.descripcion, ok: val.ok, errores: val.errores, codigo: val.ok ? codigo : undefined });
    if (val.ok) return { ganadora: probes[probes.length - 1], probes };
  }
  return { probes };
}

/**
 * Ciclo completo ante un fallo: prueba 2 variantes y registra la lección con
 * evidencia en EXPERIENCE.md. Devuelve el código ganador o null (pausar).
 */
export function componerAnteFallo(
  root: string,
  taskId: string,
  motivoFallo: string,
  variantes: PropuestaVariante[],
  juez = "harness-variantes",
): { codigo?: string; ganadora?: string } {
  const { ganadora, probes } = probarVariantes(variantes);
  return componerConProbes(root, taskId, motivoFallo, probes, ganadora, juez);
}

export async function componerAnteFalloAsync(
  root: string,
  taskId: string,
  motivoFallo: string,
  variantes: PropuestaVarianteAsync[],
  juez = "harness-variantes",
): Promise<{ codigo?: string; ganadora?: string }> {
  const { ganadora, probes } = await probarVariantesAsync(variantes);
  return componerConProbes(root, taskId, motivoFallo, probes, ganadora, juez);
}

function componerConProbes(
  root: string,
  taskId: string,
  motivoFallo: string,
  probes: ResultadoProbe[],
  ganadora: ResultadoProbe | undefined,
  juez: string,
): { codigo?: string; ganadora?: string } {
  const evidencia = probes.map((p) => `${p.id}→${p.ok ? "pass" : `fail(${p.errores.join("; ")})`}`).join(" · ");
  if (ganadora?.codigo) {
    registrarLeccion(root, taskId, "pass", juez, `variante ${ganadora.id} ganó (${ganadora.descripcion}); fallo base: ${motivoFallo}. probes: ${evidencia}`.slice(0, 300));
    return { codigo: ganadora.codigo, ganadora: ganadora.id };
  }
  registrarLeccion(root, taskId, "fail", juez, `ninguna variante pasó; fallo base: ${motivoFallo}. probes: ${evidencia}`.slice(0, 300));
  return {};
}
