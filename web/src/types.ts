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
  | "deploy";

export type StageStatus = "running" | "done" | "failed" | "blocked";

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
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
};

export type OverallStatus = "idle" | "running" | "deployed" | "blocked" | "failed";
