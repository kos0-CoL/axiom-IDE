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
  const evidencia = probes.map((p) => `${p.id}→${p.ok ? "pass" : `fail(${p.errores.join("; ")})`}`).join(" · ");
  if (ganadora?.codigo) {
    registrarLeccion(root, taskId, "pass", juez, `variante ${ganadora.id} ganó (${ganadora.descripcion}); fallo base: ${motivoFallo}. probes: ${evidencia}`.slice(0, 300));
    return { codigo: ganadora.codigo, ganadora: ganadora.id };
  }
  registrarLeccion(root, taskId, "fail", juez, `ninguna variante pasó; fallo base: ${motivoFallo}. probes: ${evidencia}`.slice(0, 300));
  return {};
}
