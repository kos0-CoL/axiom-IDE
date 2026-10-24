// Módulo adapters — ruta GET /api/adapters/modelos sin HTTP.
// web.ts delega aquí: contrato testeable listarModelos(prov, filtro, live).
// Sin key o live fallido → { ok:false } (el llamador decide el status).
import { modelosPara, modelosOpenRouter } from "./index.js";

export type FiltroModelos = "todos" | "free" | "recomendados";

export interface ModeloOut {
  id: string;
  free?: boolean;
  recomendado?: boolean;
  nota?: string;
}

export type ListadoModelos =
  | { ok: true; modelos: ModeloOut[]; nota?: string }
  | { ok: false; error: string };

function normalizaFiltro(f: string): FiltroModelos {
  return f === "free" || f === "recomendados" ? f : "todos";
}

export async function listarModelos(root: string, prov: string, filtro: string, live: boolean): Promise<ListadoModelos> {
  const f = normalizaFiltro(filtro);
  if (prov === "openrouter" && live) {
    const r = await modelosOpenRouter(root, f);
    if (!r.ok) return { ok: false, error: r.error ?? "live no disponible" };
    const modelos = r.modelos ?? [];
    return { ok: true, modelos, nota: `${modelos.length} modelo(s) live cargados (filtro ${f})` };
  }
  return { ok: true, modelos: modelosPara(prov, f) };
}
