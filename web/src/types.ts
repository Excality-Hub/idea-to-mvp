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
  | "tracing_pack";

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

export const STAGE_LABELS: Record<StageName, string> = {
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
