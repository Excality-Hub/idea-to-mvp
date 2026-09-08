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

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;
  output?: unknown;
}

export const ABORTABLE_STAGES: StageName[] = ["analyst", "architect", "developer", "qa"];
