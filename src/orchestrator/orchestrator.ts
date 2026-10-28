// Orquestador central — state machine del build Speckit.
// Bucle FIFO sobre el checklist del .md: en cada iteración relee la spec de
// disco, toma la primera tarea pendiente y la pasa por coder → validator →
// filesystem. Sin pendientes rompe el bucle y consolida (complete).
// Defensa: 3 fallos SEGUIDOS del mismo archivo en validación (o escritura)
// pausan el build, persisten lo avanzado (la spec siempre se escribe tras
// cada éxito) y emiten el evento de excepción. Usa fs síncrono: cada llamada
// abre y cierra su descriptor, no queda nada abierto al terminar.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { leerChecklist, marcarHecha } from "../spec/checklist.js";
import { escribirArchivo } from "../server/filesystem.js";
import { validarCodigo } from "../nodes/validator.js";
import { componerAnteFalloAsync, sanearCodigo, type PropuestaVarianteAsync } from "./variantes.js";
import { escribirManifiesto, registrarArtefacto } from "../server/manifiesto.js";
import { runIdParaSpec } from "../server/run-log.js";

export type TipoEvento = "status" | "file_start" | "file_success" | "error" | "complete";

export interface EventoBuild {
  type: TipoEvento;
  ruta?: string;
  mensaje?: string;
  intento?: number;
  estado?: EstadoBuild;
}

export type EstadoBuild = "completo" | "pausado";

export interface ResultadoBuild {
  estado: EstadoBuild;
  procesados: number;
  fallos: Record<string, number>;
}

export interface DepsOrquestador {
  /** Nodo coder (inyectado: el prompt raw vive en nodes/coder, el LLM lo pone el llamador). */
  generarCodigo: (ruta: string, spec: string) => Promise<string> | string;
  emitir?: (evento: EventoBuild) => void;
  maxFallos?: number;
  /**
   * Ante un fallo de validación, variantes a probar antes de contar el
   * fallo (tope 2, las que sobren se ignoran). Por defecto: reintento del
   * coder (fresh sample) + saneado local barato del código fallido.
   */
  construirVariantes?: (ruta: string, codigo: string, motivo: string, spec: string) => PropuestaVarianteAsync[];
  /**
   * Trazabilidad por defecto: cada file_success queda en
   * .runs/<run>/artefactos/ y al completar se escribe el manifiesto.
   * `false` lo apaga (tests que no quieren rastro en disco).
   */
  artefactos?: boolean;
  version?: string;
}

const MAX_FALLOS_DEFECTO = 3;

function versionPaquete(root: string): string {
  try {
    const p = `${root}/package.json`;
    if (!existsSync(p)) return "dev";
    const j = JSON.parse(readFileSync(p, "utf8")) as { version?: unknown };
    return typeof j.version === "string" ? j.version : "dev";
  } catch {
    return "dev";
  }
}

export class AgentOrchestrator {
  private fallos: Record<string, number> = {};

  constructor(
    private readonly root: string,
    private readonly specRel: string,
    private readonly deps: DepsOrquestador,
  ) {}

  private emitir(evento: EventoBuild): void {
    try {
      this.deps.emitir?.(evento);
    } catch {
      /* el observador nunca tumba el build */
    }
  }

  async ejecutar(): Promise<ResultadoBuild> {
    const maxFallos = this.deps.maxFallos ?? MAX_FALLOS_DEFECTO;
    let procesados = 0;
    for (;;) {
      let spec: string;
      try {
        spec = readFileSync(`${this.root}/${this.specRel}`, "utf8");
      } catch {
        throw new Error(`spec no encontrada: ${this.specRel} (fail closed: sin spec no hay build)`);
      }
      const siguiente = leerChecklist(spec).find((t) => !t.hecha);
      if (!siguiente) {
        if (this.deps.artefactos !== false) {
          try {
            escribirManifiesto(this.root, runIdParaSpec(this.specRel), {
              version: this.deps.version ?? versionPaquete(this.root),
              tests: { pasados: procesados, fallados: Object.keys(this.fallos).length },
            });
          } catch {
            /* el manifiesto nunca tumba el build */
          }
        }
        this.emitir({ type: "complete", estado: "completo", mensaje: "sin tareas pendientes: spec finalizada" });
        return { estado: "completo", procesados, fallos: { ...this.fallos } };
      }
      const ruta = siguiente.ruta;
      const intento = (this.fallos[ruta] ?? 0) + 1;
      this.emitir({ type: "file_start", ruta, intento, mensaje: `procesando ${ruta} (intento ${intento})` });

      let codigo: string;
      try {
        codigo = await this.deps.generarCodigo(ruta, spec);
      } catch (e) {
        this.emitir({ type: "error", ruta, intento, mensaje: `coder falló: ${e instanceof Error ? e.message : e}` });
        const r = this.registrarFallo(ruta, intento, maxFallos, "el nodo coder lanzó excepción", procesados);
        if (r) return r;
        continue;
      }

      const v = validarCodigo(codigo);
      if (!v.ok) {
        const motivo = `validación: ${v.errores.join("; ")}`;
        // Ciclo Propose–Probe–Compose en pequeño: 2 variantes antes de
        // contar el fallo. Si una pasa, se compone sin penalizar el intento.
        const variantes = (this.deps.construirVariantes?.(ruta, codigo, motivo, spec) ?? [
          {
            id: "v1-reintento-coder",
            descripcion: "nueva muestra del coder",
            producir: () => this.deps.generarCodigo(ruta, spec),
          },
          {
            id: "v2-saneado-local",
            descripcion: "saneado local (sin cercas ni cháchara)",
            producir: () => sanearCodigo(codigo),
          },
        ]) as PropuestaVarianteAsync[];
        let compuesto: { codigo?: string; ganadora?: string } = {};
        try {
          compuesto = await componerAnteFalloAsync(this.root, `${this.specRel}#${ruta}`, motivo, variantes);
        } catch {
          compuesto = {};
        }
        if (compuesto.codigo) {
          this.emitir({ type: "status", ruta, mensaje: `variante ${compuesto.ganadora} compuesta tras fallo (${motivo})` });
          codigo = compuesto.codigo;
        } else {
          this.emitir({ type: "error", ruta, intento, mensaje: motivo });
          const r = this.registrarFallo(ruta, intento, maxFallos, motivo, procesados);
          if (r) return r;
          continue;
        }
      }

      try {
        escribirArchivo(this.root, ruta, codigo);
      } catch (e) {
        this.emitir({ type: "error", ruta, intento, mensaje: `filesystem: ${e instanceof Error ? e.message : e}` });
        const r = this.registrarFallo(ruta, intento, maxFallos, `escritura: ${e instanceof Error ? e.message : e}`, procesados);
        if (r) return r;
        continue;
      }

      const marcado = marcarHecha(spec, ruta);
      writeFileSync(`${this.root}/${this.specRel}`, marcado.markdown);
      delete this.fallos[ruta];
      procesados++;
      if (this.deps.artefactos !== false) {
        try {
          registrarArtefacto(this.root, runIdParaSpec(this.specRel), ruta, codigo, "orchestrator");
        } catch {
          /* el registro nunca tumba el build */
        }
      }
      this.emitir({ type: "file_success", ruta, mensaje: `${ruta} escrito y marcado [X]` });
    }
  }

  /**
   * Cuenta el fallo. Si llega al tope devuelve el ResultadoBuild de pausa;
   * si no, devuelve null y el llamador hace `continue` (el bucle reintenta
   * el mismo archivo: por eso el contador mide fallos SEGUIDOS).
   */
  private registrarFallo(
    ruta: string,
    intento: number,
    maxFallos: number,
    motivo: string,
    procesados: number,
  ): ResultadoBuild | null {
    this.fallos[ruta] = intento;
    if (intento >= maxFallos) return this.pausar(ruta, intento, procesados, motivo);
    return null;
  }

  private pausar(ruta: string, intento: number, procesados: number, motivo: string): ResultadoBuild {
    this.emitir({
      type: "error",
      ruta,
      intento,
      estado: "pausado",
      mensaje: `excepción: ${ruta} falló ${intento} veces seguidas (${motivo}). Build pausado, lo avanzado queda persistido en la spec.`,
    });
    return { estado: "pausado", procesados, fallos: { ...this.fallos } };
  }
}
