// Módulo kanban — tablero de tareas por estado.
// Fuente única: SQLite del proyecto (tabla tasks), agrupada por `estado` y con
// el spec de cada tarea. Solo lectura: el estado cambia con `axiom verify` /
// `axiom tasks`, nunca desde el panel. Si la base no existe, devuelve columnas
// vacías con la causa (fail soft, no inventa tareas).
import { openDb } from "../../store.js";

export const NOMBRE = "kanban";

export interface TarjetaKanban {
  id: string;
  titulo: string;
  spec: string;
  owner: string;
}

export interface ColumnaKanban {
  id: string;
  titulo: string;
  total: number;
  tarjetas: TarjetaKanban[];
}

export interface DatosKanban {
  columnas: ColumnaKanban[];
  vacio: boolean;
  fuente: string;
}

// Orden estable de los estados que el núcleo conoce (tasks.estado). Cualquier
// estado nuevo que aparezca en la base se añade al final: nada se pierde.
const ORDEN = ["pendiente", "implementado", "verificado", "bloqueado"];
// El panel pinta como máximo N tarjetas por columna; `total` dice el real.
const MAX_POR_COLUMNA = 20;

export function datosModulo(root: string): DatosKanban {
  try {
    const db = openDb(root);
    const filas = db.prepare("SELECT id, spec_id, title, estado, owner FROM tasks ORDER BY id").all() as {
      id: string;
      spec_id: string | null;
      title: string | null;
      estado: string | null;
      owner: string | null;
    }[];
    db.close();
    // Siempre las 4 columnas conocidas (aunque vacías); lo demás se añade.
    const porEstado = new Map<string, TarjetaKanban[]>(ORDEN.map((e) => [e, [] as TarjetaKanban[]]));
    for (const f of filas) {
      const estado = (f.estado ?? "").trim() || "pendiente";
      const tarjeta: TarjetaKanban = {
        id: f.id,
        titulo: (f.title ?? "").trim() || f.id,
        spec: f.spec_id ?? "—",
        owner: f.owner ?? "unassigned",
      };
      const lista = porEstado.get(estado) ?? [];
      lista.push(tarjeta);
      porEstado.set(estado, lista);
    }
    const ids = [...porEstado.keys()].sort((a, b) => {
      const ia = ORDEN.indexOf(a);
      const ib = ORDEN.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    const columnas: ColumnaKanban[] = ids.map((id) => {
      const lista = porEstado.get(id) ?? [];
      return { id, titulo: id, total: lista.length, tarjetas: lista.slice(0, MAX_POR_COLUMNA) };
    });
    return {
      columnas,
      vacio: filas.length === 0,
      fuente: filas.length === 0
        ? "SQLite del proyecto (tabla tasks): sin tareas todavía (crea specs y tareas desde la CLI)."
        : `SQLite del proyecto (tabla tasks): ${filas.length} tarea(s) repartida(s) en ${columnas.length} columna(s).`,
    };
  } catch {
    return { columnas: [], vacio: true, fuente: "sin base de datos del proyecto todavía (corre `axiom init`)." };
  }
}

export function estadoTexto(): string {
  return `kanban: tareas por estado (SQLite tasks) — columnas ${ORDEN.join(" · ")}`;
}
