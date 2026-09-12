import { z } from "zod";
import type { AgentUsage } from "../claudeAgent.js";
import type { AgentDefinition } from "../agents/types.js";

export type StageName =
  | "create_repo"
  | "analyst"
  | "architect"
  | "open_issue"
  | "developer"
  | "open_pr"
  | "qa"
  | "post_review"
  | "merge"
  | "deploy"
  | "tracing_pack"
  | `custom:${string}`;

export type StageStatus = "running" | "done" | "failed" | "blocked" | "stopped";

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;
  output?: unknown;
  usage?: AgentUsage;
}

export const ABORTABLE_STAGES: StageName[] = ["analyst", "architect", "developer", "qa"];

// 10, not 11 — tracing_pack runs via commitTracingPack() outside the
// BACKBONE_STEPS loop, on every exit path, so a custom agent spliced
// after it would never execute. See runOrchestrator.ts's BACKBONE_STEPS
// and the invariant test in runOrchestrator.test.ts.
export const BACKBONE_STAGES = [
  "create_repo",
  "analyst",
  "architect",
  "open_issue",
  "developer",
  "open_pr",
  "qa",
  "post_review",
  "merge",
  "deploy",
] as const;
export type BackboneStage = (typeof BACKBONE_STAGES)[number];

export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: Partial<Record<BackboneStage, string[]>>;
  createdAt: string;
}

export const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  slots: z.record(z.string(), z.array(z.string())),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export interface ResolvedWorkflow {
  slots: Partial<Record<BackboneStage, AgentDefinition[]>>;
}
