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

export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: {
    afterAnalyst: string[];
    afterArchitect: string[];
    afterQa: string[];
  };
  createdAt: string;
}

export const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  slots: z.object({
    afterAnalyst: z.array(z.string()),
    afterArchitect: z.array(z.string()),
    afterQa: z.array(z.string()),
  }),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export interface ResolvedWorkflow {
  afterAnalyst: AgentDefinition[];
  afterArchitect: AgentDefinition[];
  afterQa: AgentDefinition[];
}
