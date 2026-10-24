// Módulo grafos — intended (lo planeado) vs executed (lo que el run usó).
// Intended = agents.config.json (diseño). Executed = handoff_log + evidencias
// (conducta observada). Sin ejecuciones, el panel executed lo dice (fail soft).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../store.js";

export const NOMBRE = "grafos";

export interface NodoGrafo {
  id: string;
  tipo: "agente" | "evento";
  nota: string;
}

export interface AristaGrafo {
  de: string;
  a: string;
  nota: string;
}

export interface GrafoVista {
  centro: string;
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
}

export interface DatosGrafos {
  intended: GrafoVista;
  executed: GrafoVista;
  vacio: boolean;
}

function intended(root: string): GrafoVista {
  try {
    const p = join(root, "agents.config.json");
    if (!existsSync(p)) return { centro: "orquestador", nodos: [], aristas: [] };
    const g = JSON.parse(readFileSync(p, "utf8")) as {
      agentes?: { id?: unknown; rol?: unknown }[];
      aristas?: { de?: unknown; a?: unknown; tipo?: unknown }[];
    };
    const ag = Array.isArray(g?.agentes) ? g.agentes : [];
    const ids = ag.map((a) => String(a.id ?? "?"));
    const centro = ag.find((a) => a.rol === "orquestador");
    const c = centro ? String(centro.id) : (ids[0] ?? "orquestador");
    return {
      centro: c,
      nodos: ag
        .filter((a) => String(a.id) !== c)
        .map((a) => ({ id: String(a.id ?? "?"), tipo: "agente" as const, nota: String(a.rol ?? "") })),
      aristas: (Array.isArray(g?.aristas) ? g.aristas : []).map((e) => ({
        de: String(e.de ?? "?"),
        a: String(e.a ?? "?"),
        nota: String(e.tipo ?? ""),
      })),
    };
  } catch {
    return { centro: "orquestador", nodos: [], aristas: [] };
  }
}

function executed(root: string): GrafoVista {
  const nodos: NodoGrafo[] = [];
  const aristas: AristaGrafo[] = [];
  try {
    const db = openDb(root);
    const hands = db.prepare("SELECT de,a,decision,approval_id FROM handoff_log ORDER BY id DESC LIMIT 100").all() as {
      de: string;
      a: string;
      decision: string;
      approval_id: string;
    }[];
    const evs = db.prepare("SELECT verdict, COUNT(*) c FROM evidences GROUP BY verdict").all() as { verdict: string; c: number }[];
    db.close();
    const ids = new Set<string>();
    for (const h of hands) {
      ids.add(h.de);
      ids.add(h.a);
      aristas.push({ de: h.de, a: h.a, nota: h.decision });
    }
    const centro = [...ids][0] ?? "orquestador";
    for (const id of [...ids].filter((x) => x !== centro)) nodos.push({ id, tipo: "agente", nota: "observado en handoff" });
    const aprob = hands.filter((h) => h.approval_id || h.decision === "pendiente").length;
    if (aprob > 0) nodos.push({ id: "aprobación", tipo: "evento", nota: `${aprob} evento(s)` });
    const pass = evs.find((e) => e.verdict === "pass")?.c ?? 0;
    if (pass > 0) nodos.push({ id: "evidencia", tipo: "evento", nota: `${pass} veredicto(s) pass` });
    const deny = hands.filter((h) => h.decision === "denegada").length;
    if (deny > 0) nodos.push({ id: "denegado", tipo: "evento", nota: `${deny} handoff(s)` });
    return { centro, nodos, aristas };
  } catch {
    return { centro: "orquestador", nodos: [], aristas: [] };
  }
}

// Convención sin cableado: el núcleo llama a `datosModulo(root)` por import
// dinámico (ver GET /api/modulos/datos). El manifiesto declara panel grafo.
export function datosModulo(root: string): DatosGrafos {
  return datosGrafos(root);
}

export function datosGrafos(root: string): DatosGrafos {
  const inten = intended(root);
  const ejec = executed(root);
  let vacio = true;
  try {
    const db = openDb(root);
    const n = (db.prepare("SELECT COUNT(*) c FROM handoff_log").get() as { c: number }).c;
    const e = (db.prepare("SELECT COUNT(*) c FROM evidences").get() as { c: number }).c;
    db.close();
    vacio = n === 0 && e === 0;
  } catch {
    /* fail soft: se muestra vacío */
  }
  return { intended: inten, executed: ejec, vacio };
}

export function estadoTexto(): string {
  return `grafos: intended vs executed (usa agents.config.json + handoff_log + evidences)`;
}
