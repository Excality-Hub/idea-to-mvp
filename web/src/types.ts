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
  | `custom:${string}`
  | `gate:${string}`;

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

export const GATE_ID_PREFIX = "gate:";

export function isGateEntry(id: string): boolean {
  return id.startsWith(GATE_ID_PREFIX);
}

export function parseGateId(id: string): string {
  return id.slice(GATE_ID_PREFIX.length);
}

export const DATA_KINDS = [
  "idea_text",
  "repo",
  "analysis_summary",
  "architecture_plan",
  "issue",
  "code_changes",
  "pull_request",
  "qa_findings",
  "merged_code",
  "deployment",
] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  idea_text: "Idea text",
  repo: "Repo",
  analysis_summary: "Analysis summary",
  architecture_plan: "Architecture plan",
  issue: "GitHub issue",
  code_changes: "Code changes",
  pull_request: "Pull request",
  qa_findings: "QA findings",
  merged_code: "Merged code",
  deployment: "Deployment",
};

export const BACKBONE_STAGE_IO: Record<BackboneStage, { inputs: DataKind[]; outputs: DataKind[] }> = {
  create_repo: { inputs: [], outputs: ["repo"] },
  analyst: { inputs: ["idea_text"], outputs: ["analysis_summary"] },
  architect: { inputs: ["analysis_summary"], outputs: ["architecture_plan"] },
  open_issue: { inputs: ["architecture_plan", "repo"], outputs: ["issue"] },
  developer: { inputs: ["architecture_plan", "repo"], outputs: ["code_changes"] },
  open_pr: { inputs: ["code_changes", "issue", "repo"], outputs: ["pull_request"] },
  qa: { inputs: ["pull_request"], outputs: ["qa_findings"] },
  post_review: { inputs: ["qa_findings", "pull_request"], outputs: [] },
  merge: { inputs: ["qa_findings", "pull_request"], outputs: ["merged_code"] },
  deploy: { inputs: ["merged_code"], outputs: ["deployment"] },
};

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

export function isGateStage(stage: StageName): stage is `gate:${string}` {
  return stage.startsWith(GATE_ID_PREFIX);
}

export function isAbortableStage(stage: StageName): boolean {
  return isCustomStage(stage) || (ABORTABLE_STAGES as StageName[]).includes(stage);
}

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  inputs?: DataKind[];
  outputs?: DataKind[];
  createdAt: string;
}

export interface WorkflowDefinition {
  id: string;
  projectId: string;
  name: string;
  slots: Partial<Record<BackboneStage, string[]>>;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  repoName: string;
  repo?: { owner: string; htmlUrl: string; cloneUrl: string };
  createdAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  ideaText: string;
  workflowId: string;
  createdAt: string;
  events: RunEvent[];
}

export type RunSummary = Omit<Run, "events">;

const DEFAULT_WORKFLOW_SUFFIX = "-default";

export function defaultWorkflowIdFor(projectId: string): string {
  return `${projectId}${DEFAULT_WORKFLOW_SUFFIX}`;
}
