import type { BackboneStage } from "../orchestrator/types.js";

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

// Derived from PipelineContext usage in runOrchestrator.ts's BACKBONE_STEPS
// (e.g. developer reads ctx.architectOutput! and ctx.repo!, so its inputs
// are architecture_plan + repo). Fixed and not user-editable.
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
