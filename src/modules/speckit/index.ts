// Módulo speckit — converge (SDD, inspirado en GitHub Spec Kit).
// Compara lo especificado (specs + tasks) con lo verificado (evidences).
// Solo lectura: no cambia estados ni escribe en la base. Fail soft si no hay datos.
import { openDb } from "../../store.js";

export const NOMBRE = "speckit";

export interface TareaConverge {
  id: string;
  spec: string;
  titulo: string;
  estado: string;
  verificada: boolean;
}

export interface SpecConverge {
  id: string;
  ver: string;
  titulo: string;
  estado: string;
  tareas: number;
  verificadas: number;
  converge: boolean;
}

export interface DatosSpeckit {
  specs: SpecConverge[];
  pendientes: TareaConverge[];
  resumen: { specs: number; convergen: number; tareas: number; verificadas: number };
  vacio: boolean;
}

interface FilaSpec {
  id: string;
  ver: string;
  title: string;
  status: string;
}

interface FilaTarea {
  id: string;
  spec_id: string;
  title: string;
  estado: string;
  verificada: number;
}

// Convergencia: una spec converge cuando tiene tareas y todas tienen evidencia pass.
export function datosSpeckit(root: string): DatosSpeckit {
  const vacioRes: DatosSpeckit = { specs: [], pendientes: [], resumen: { specs: 0, convergen: 0, tareas: 0, verificadas: 0 }, vacio: true };
  try {
    const db = openDb(root);
    const specs = db.prepare("SELECT id, ver, title, status FROM specs ORDER BY id, ver").all() as unknown as FilaSpec[];
    const tareas = db
      .prepare(
        "SELECT t.id, t.spec_id, t.title, t.estado, EXISTS(SELECT 1 FROM evidences e WHERE e.task_id = t.id AND e.verdict = 'pass') AS verificada FROM tasks t ORDER BY t.spec_id, t.id",
      )
      .all() as unknown as FilaTarea[];
    db.close();

    const out: SpecConverge[] = specs.map((s) => {
      const ts = tareas.filter((t) => t.spec_id === s.id);
      const ver = ts.filter((t) => t.verificada === 1).length;
      return {
        id: s.id,
        ver: s.ver,
        titulo: s.title,
        estado: s.status,
        tareas: ts.length,
        verificadas: ver,
        converge: ts.length > 0 && ver === ts.length,
      };
    });
    const pendientes: TareaConverge[] = tareas
      .filter((t) => t.verificada !== 1)
      .map((t) => ({ id: t.id, spec: t.spec_id, titulo: t.title, estado: t.estado, verificada: false }));

    if (out.length === 0 && tareas.length === 0) return vacioRes;
    return {
      specs: out,
      pendientes,
      resumen: {
        specs: out.length,
        convergen: out.filter((s) => s.converge).length,
        tareas: tareas.length,
        verificadas: tareas.length - pendientes.length,
      },
      vacio: false,
    };
  } catch {
    return vacioRes;
  }
}

// Convención sin cableado: el núcleo llama a datosModulo(root) por import dinámico.
export function datosModulo(root: string): DatosSpeckit {
  return datosSpeckit(root);
}

export function estadoTexto(): string {
  return "speckit: converge (specs y tareas frente a evidencias pass)";
}
