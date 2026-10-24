import { z } from "zod";

export const EstadoTarea = z.enum(["implementado", "verificado", "aceptado", "bloqueado", "rechazado"]);
export type EstadoTarea = z.infer<typeof EstadoTarea>;

export const ToolAnnotations = z.object({
  readOnlyHint: z.boolean().default(true),
  destructiveHint: z.boolean().default(false),
  idempotentHint: z.boolean().default(true),
  openWorldHint: z.boolean().default(false),
});

export const ToolContract = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  annotations: ToolAnnotations,
});
export type ToolContract = z.infer<typeof ToolContract>;

export const TaskContract = z.object({
  id: z.string().min(1),
  spec_id: z.string().min(1),
  spec_ver: z.string().min(1),
  title: z.string().min(1),
  scenario: z.string().min(1).refine(
    (s) => /given/i.test(s) && /when/i.test(s) && /then/i.test(s),
    "scenario debe contener Given/When/Then observable"
  ),
  estado: EstadoTarea,
  owner: z.string().default("unassigned"),
});
export type TaskContract = z.infer<typeof TaskContract>;

export const EvidenceContract = z.object({
  task_id: z.string().min(1),
  spec_ver: z.string().min(1),
  cmd: z.string().min(1),
  exit: z.number().int(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, "sha256 hex 64"),
  verdict: z.enum(["pass", "fail"]),
});
export type EvidenceContract = z.infer<typeof EvidenceContract>;

export const PolicyDecision = z.enum(["allow", "deny", "ask"]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

export function riskOf(tool: ToolContract): "bajo" | "medio" | "alto" {
  if (tool.annotations.destructiveHint) return "alto";
  if (tool.annotations.openWorldHint) return "alto";
  if (!tool.annotations.readOnlyHint) return "medio";
  return "bajo";
}
