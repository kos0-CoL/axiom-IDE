// Agent-as-a-tool — el especialista como herramienta, no como chat.
// Patrón ADK `AgentTool` / OpenAI `as_tool` adaptado al broker de Axiom:
// entrada estrecha (tarea), salida pequeña acotada, maxTurns/timeout
// propios, autorización en el broker (deny por defecto) y eventos con
// parent_call_id para trazar padre→hijo. El prompt nunca autoriza.
import { autorizarUso } from "../modules/agents/ejecucion.js";
import type { ToolContract } from "../contracts.js";
export interface VeredictoTool {
  decision: "allow" | "deny" | "ask";
  motivo?: string;
}

export interface AgenteToolDef {
  /** Id del especialista en el roster (p. ej. `review`). */
  agenteId: string;
  /** Nombre de tool expuesto al padre (p. ej. `review-as-tool`). */
  tool: string;
  descripcion: string;
  maxTurns?: number;
  timeoutMs?: number;
  maxBytesSalida?: number;
}

export interface LlamadaAgenteTool {
  tarea: string;
  parentCallId: string;
}

export interface ResultadoAgenteTool {
  ok: boolean;
  salida: string;
  error?: string;
  traza: { padre: string; hijo: string; agente: string; tool: string; decision: string }[];
}

const MAX_TURNOS_DEFECTO = 3;
const TIMEOUT_DEFECTO = 30000;
const MAX_SALIDA = 4000;

// La tool no escribe ni ejecuta por sí misma: devuelve texto acotado que el
// padre sintetiza. Por eso el contrato es readOnly (riesgo bajo, la política
// lo auto-permite) y lo que manda es la declaración del agente en el roster:
// sin `tool=allow|ask` declarado, el broker deniega (fail closed).
const CONTRATO_TOOL: ToolContract = {
  name: "agent-tool",
  description:
    "Delega una subtarea estrecha a un especialista del roster; devuelve texto acotado que el padre sintetiza, sin escribir ni ejecutar.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

/**
 * Cableado real al broker: resuelve la declaración del especialista en
 * agents.config.json y cruza política global ∧ proyecto ∧ agente vía
 * autorizarUso (consume una aprobación vigente si la hay). Devuelve la
 * función `autorizar(tool, agenteId)` que pide invocarAgenteComoTool.
 * Sin declaración o sin política que lo cubra: deny (fail closed).
 */
export function autorizarPorBroker(root: string, por = "agent-tool"): (tool: string, agenteId: string) => VeredictoTool {
  return (tool: string, agenteId: string) => {
    const r = autorizarUso(root, agenteId, tool, { ...CONTRATO_TOOL, name: tool }, por);
    return { decision: r.decision, motivo: r.id ? `${r.motivo} (aprobación ${r.id})` : r.motivo };
  };
}

/**
 * Ejecuta al especialista como tool. `autorizar` es el broker (no el prompt):
 * si no es allow, fail closed. `ejecutar` es el especialista real (inyectado,
 * con su propio presupuesto); el padre sintetiza con `sintetizar`.
 */
export async function invocarAgenteComoTool(
  def: AgenteToolDef,
  llamada: LlamadaAgenteTool,
  deps: {
    autorizar: (tool: string, agenteId: string) => VeredictoTool | Promise<VeredictoTool>;
    ejecutar: (tarea: string, opts: { maxTurns: number; timeoutMs: number }) => string | Promise<string>;
    sintetizar?: (salidaHijo: string) => string;
  },
): Promise<ResultadoAgenteTool> {
  const base = {
    padre: llamada.parentCallId,
    hijo: `${llamada.parentCallId}:${def.tool}`,
    agente: def.agenteId,
    tool: def.tool,
    decision: "deny",
  };
  if (!llamada.tarea?.trim()) {
    return { ok: false, salida: "", error: "tarea vacía: nada que delegar", traza: [{ ...base }] };
  }
  let v: VeredictoTool;
  try {
    v = await deps.autorizar(def.tool, def.agenteId);
  } catch (e) {
    return { ok: false, salida: "", error: `broker ilegible (fail closed): ${e instanceof Error ? e.message : e}`, traza: [{ ...base }] };
  }
  base.decision = v.decision;
  if (v.decision !== "allow") {
    return { ok: false, salida: "", error: `denegado por el broker (${v.decision}): ${v.motivo ?? def.tool}`, traza: [{ ...base }] };
  }
  const maxTurns = def.maxTurns ?? MAX_TURNOS_DEFECTO;
  const timeoutMs = def.timeoutMs ?? TIMEOUT_DEFECTO;
  let crudo: string;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    crudo = await Promise.race([
      Promise.resolve(deps.ejecutar(llamada.tarea, { maxTurns, timeoutMs })),
      new Promise<never>((_, rechaza) => {
        temporizador = setTimeout(() => rechaza(new Error(`timeout del especialista (${timeoutMs}ms)`)), timeoutMs);
        // No retiene el proceso si el especialista ya respondió.
        (temporizador as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } catch (e) {
    if (temporizador) clearTimeout(temporizador);
    return { ok: false, salida: "", error: `especialista falló: ${e instanceof Error ? e.message : e}`, traza: [{ ...base }] };
  }
  if (temporizador) clearTimeout(temporizador);
  const limite = def.maxBytesSalida ?? MAX_SALIDA;
  const acotada = crudo.slice(0, limite);
  const salida = deps.sintetizar ? deps.sintetizar(acotada).slice(0, limite) : acotada;
  return { ok: true, salida, traza: [{ ...base }] };
}
