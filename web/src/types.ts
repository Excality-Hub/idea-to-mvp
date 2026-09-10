// Mirrors src/orchestrator/types.ts on the backend. Kept as a plain
// duplicate since the web app has its own build/module-resolution setup.

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

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
}

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;
  output?: unknown;
  usage?: AgentUsage;
}

export const STAGE_ORDER: StageName[] = [
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
  "tracing_pack",
];

export const STAGE_LABELS: Record<Exclude<StageName, `custom:${string}`>, string> = {
  create_repo: "Create repo",
  analyst: "Analyst",
  architect: "Architect",
  open_issue: "Open issue",
  developer: "Developer",
  open_pr: "Open PR",
  qa: "QA review",
  post_review: "Post review",
  merge: "Merge",
  deploy: "Deploy",
  tracing_pack: "Tracing pack",
};

export const ABORTABLE_STAGES: StageName[] = ["analyst", "architect", "developer", "qa"];

export type OverallStatus = "idle" | "running" | "deployed" | "blocked" | "failed" | "stopped";

export function isCustomStage(stage: StageName): stage is `custom:${string}` {
  return stage.startsWith("custom:");
}

export function isAbortableStage(stage: StageName): boolean {
  return isCustomStage(stage) || (ABORTABLE_STAGES as StageName[]).includes(stage);
}

export function getStageLabelSafe(stage: StageName): string {
  if (isCustomStage(stage)) {
    return stage.slice(7); // Remove "custom:" prefix
  }
  return STAGE_LABELS[stage as Exclude<StageName, `custom:${string}`>];
}

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  createdAt: string;
}

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
