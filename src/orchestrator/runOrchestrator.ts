import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch, resetWorkingTree } from "../git.js";
import type { runAnalystAgent } from "../agents/analyst.js";
import type { runArchitectAgent } from "../agents/architect.js";
import type { runDeveloperAgent } from "../agents/developer.js";
import type { runQaAgent } from "../agents/qa.js";
import type {
  AnalystOutput,
  ArchitectOutput,
  DeveloperOutput,
  QAFinding,
  QAOutput,
} from "../agents/schemas.js";
import type { DeployClient } from "../deploy/types.js";
import { formatTracingPackMarkdown, type TracingPackEntry } from "./tracingPack.js";
import { RunEventBus } from "./events.js";
import {
  ABORTABLE_STAGES,
  type BackboneStage,
  type ResolvedWorkflow,
  type RunEvent,
  type StageName,
} from "./types.js";
import { AgentStoppedError, type AgentUsage } from "../claudeAgent.js";
import type { AgentDefinition } from "../agents/types.js";
import type { runCustomAgent } from "../agents/custom.js";

export interface OrchestratorParams {
  ideaText: string;
  owner: string;
  repoName: string;
  starterDir: string;
  workDir: string;
  githubToken: string;
  resolvedWorkflow: ResolvedWorkflow;
}

export interface OrchestratorDeps {
  eventBus: RunEventBus;
  github: GithubClient;
  deploy: DeployClient;
  git: {
    cloneRepo: typeof cloneRepo;
    createAndCheckoutBranch: typeof createAndCheckoutBranch;
    resetWorkingTree: typeof resetWorkingTree;
    pushBranch: typeof pushBranch;
    diffAgainstBase: typeof diffAgainstBase;
  };
  agents: {
    analyst: typeof runAnalystAgent;
    architect: typeof runArchitectAgent;
    developer: typeof runDeveloperAgent;
    qa: typeof runQaAgent;
    custom: typeof runCustomAgent;
  };
  readStarterFiles: typeof ReadStarterFiles;
}

const BASE_BRANCH = "main";
const TRACING_PACK_PATH = "TRACING_PACK.md";

function stageEvent(
  stage: StageName,
  status: RunEvent["status"],
  message: string,
  extra?: { input?: unknown; output?: unknown; usage?: AgentUsage },
): RunEvent {
  return { stage, status, message, timestamp: new Date().toISOString(), ...extra };
}

function formatQaComment(qa: QAOutput): string {
  if (qa.findings.length === 0) {
    return `QA review: ${qa.verdict}. No findings.`;
  }
  const lines = qa.findings.map(
    (f) => `- **${f.severity}** [${f.category}] ${f.file}:${f.line} - ${f.summary}`,
  );
  return [`QA review: ${qa.verdict}`, "", ...lines].join("\n");
}

export interface PipelineContext {
  tracingEntries: TracingPackEntry[];
  pendingInput?: unknown;
  repo?: { owner: string; repo: string; htmlUrl: string; cloneUrl: string };
  repoCloned?: boolean;
  analystOutput?: AnalystOutput;
  architectOutput?: ArchitectOutput;
  issue?: { number: number };
  developerOutput?: DeveloperOutput;
  pr?: { number: number; htmlUrl: string };
  diff?: string;
  qaOutput?: QAOutput;
  deployUrl?: string;
}

export interface ResumeState {
  stageIndex: number;
  ctx: PipelineContext;
}

export type RunOutcome =
  | { status: "deployed"; url: string; prUrl: string }
  | { status: "blocked"; findings: QAFinding[]; prUrl: string }
  | { status: "failed"; stage: StageName; error: string }
  | { status: "stopped"; stage: StageName; resumeState: ResumeState };

interface StageStep {
  name: StageName;
  abortable: boolean;
  guard?: (ctx: PipelineContext) => boolean;
  run(
    ctx: PipelineContext,
    params: OrchestratorParams,
    deps: OrchestratorDeps,
    signal?: AbortSignal,
  ): Promise<void>;
}

const BACKBONE_STEPS: StageStep[] = [
  {
    name: "create_repo",
    abortable: ABORTABLE_STAGES.includes("create_repo"),
    async run(ctx, params, deps) {
      const starterFiles = deps.readStarterFiles(params.starterDir);
      ctx.pendingInput = {
        owner: params.owner,
        repoName: params.repoName,
        starterFilePaths: starterFiles.map((f) => f.path),
      };
      deps.eventBus.emit(
        stageEvent("create_repo", "running", "Creating GitHub repo from starter template", {
          input: ctx.pendingInput,
        }),
      );
      const repo = await deps.github.createRepoFromStarter({
        owner: params.owner,
        repoName: params.repoName,
        starterFiles,
      });
      const output = { htmlUrl: repo.htmlUrl, cloneUrl: repo.cloneUrl };
      deps.eventBus.emit(stageEvent("create_repo", "done", repo.htmlUrl, { output }));
      ctx.tracingEntries.push({ stage: "create_repo", status: "done", input: ctx.pendingInput, output });
      ctx.repo = repo;
    },
  },
  {
    name: "analyst",
    abortable: ABORTABLE_STAGES.includes("analyst"),
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = { ideaText: params.ideaText };
      deps.eventBus.emit(stageEvent("analyst", "running", "Analyzing idea", { input: ctx.pendingInput }));
      const { output: analystOutput, usage } = await deps.agents.analyst(params.ideaText, params.workDir, signal);
      deps.eventBus.emit(stageEvent("analyst", "done", analystOutput.summary, { output: analystOutput, usage }));
      ctx.tracingEntries.push({
        stage: "analyst",
        status: "done",
        input: ctx.pendingInput,
        output: analystOutput,
        usage,
      });
      ctx.analystOutput = analystOutput;
    },
  },
  {
    name: "architect",
    abortable: ABORTABLE_STAGES.includes("architect"),
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = { analystOutput: ctx.analystOutput };
      deps.eventBus.emit(stageEvent("architect", "running", "Planning implementation", { input: ctx.pendingInput }));
      const starterLayout = params.starterDir.includes("cloudflare") ? "cloudflare" : "render";
      const { output: architectOutput, usage } = await deps.agents.architect(
        ctx.analystOutput!,
        params.workDir,
        starterLayout,
        signal,
      );
      deps.eventBus.emit(
        stageEvent("architect", "done", architectOutput.issueTitle, { output: architectOutput, usage }),
      );
      ctx.tracingEntries.push({
        stage: "architect",
        status: "done",
        input: ctx.pendingInput,
        output: architectOutput,
        usage,
      });
      ctx.architectOutput = architectOutput;
    },
  },
  {
    name: "open_issue",
    abortable: ABORTABLE_STAGES.includes("open_issue"),
    async run(ctx, params, deps) {
      ctx.pendingInput = { title: ctx.architectOutput!.issueTitle, body: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("open_issue", "running", "Opening GitHub issue", { input: ctx.pendingInput }));
      const issue = await deps.github.createIssue(
        params.owner,
        params.repoName,
        ctx.architectOutput!.issueTitle,
        ctx.architectOutput!.issueBody,
      );
      deps.eventBus.emit(stageEvent("open_issue", "done", `#${issue.number}`, { output: issue }));
      ctx.tracingEntries.push({ stage: "open_issue", status: "done", input: ctx.pendingInput, output: issue });
      ctx.issue = issue;
    },
  },
  {
    name: "developer",
    abortable: ABORTABLE_STAGES.includes("developer"),
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = { issueBody: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("developer", "running", "Implementing the plan", { input: ctx.pendingInput }));
      if (!ctx.repoCloned) {
        await deps.git.cloneRepo(ctx.repo!.cloneUrl, params.workDir, params.githubToken);
        ctx.repoCloned = true;
      }
      await deps.git.createAndCheckoutBranch(params.workDir, ctx.architectOutput!.branchName);
      await deps.git.resetWorkingTree(params.workDir);
      const { output: developerOutput, usage } = await deps.agents.developer(
        ctx.architectOutput!.issueBody,
        params.workDir,
        signal,
      );
      await deps.git.pushBranch(params.workDir, ctx.architectOutput!.branchName, params.githubToken);
      deps.eventBus.emit(
        stageEvent("developer", "done", developerOutput.prTitle, { output: developerOutput, usage }),
      );
      ctx.tracingEntries.push({
        stage: "developer",
        status: "done",
        input: ctx.pendingInput,
        output: developerOutput,
        usage,
      });
      ctx.developerOutput = developerOutput;
    },
  },
  {
    name: "open_pr",
    abortable: ABORTABLE_STAGES.includes("open_pr"),
    async run(ctx, params, deps) {
      ctx.pendingInput = {
        title: ctx.developerOutput!.prTitle,
        body: ctx.developerOutput!.prBody,
        head: ctx.architectOutput!.branchName,
        base: BASE_BRANCH,
      };
      deps.eventBus.emit(stageEvent("open_pr", "running", "Opening pull request", { input: ctx.pendingInput }));
      const pr = await deps.github.createPullRequest({
        owner: params.owner,
        repo: params.repoName,
        title: ctx.developerOutput!.prTitle,
        body: ctx.developerOutput!.prBody,
        head: ctx.architectOutput!.branchName,
        base: BASE_BRANCH,
        issueNumber: ctx.issue!.number,
      });
      deps.eventBus.emit(stageEvent("open_pr", "done", pr.htmlUrl, { output: pr }));
      ctx.tracingEntries.push({ stage: "open_pr", status: "done", input: ctx.pendingInput, output: pr });
      ctx.pr = pr;
    },
  },
  {
    name: "qa",
    abortable: ABORTABLE_STAGES.includes("qa"),
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = undefined;
      deps.eventBus.emit(stageEvent("qa", "running", "Reviewing the pull request"));
      const diff = await deps.git.diffAgainstBase(params.workDir, BASE_BRANCH);
      ctx.pendingInput = { diff };
      const { output: qaOutput, usage } = await deps.agents.qa(diff, params.workDir, signal);
      deps.eventBus.emit(stageEvent("qa", "done", qaOutput.verdict, { output: qaOutput, usage }));
      ctx.tracingEntries.push({ stage: "qa", status: "done", input: ctx.pendingInput, output: qaOutput, usage });
      ctx.diff = diff;
      ctx.qaOutput = qaOutput;
    },
  },
  {
    name: "post_review",
    abortable: ABORTABLE_STAGES.includes("post_review"),
    async run(ctx, params, deps) {
      const comment = formatQaComment(ctx.qaOutput!);
      ctx.pendingInput = { comment };
      deps.eventBus.emit(stageEvent("post_review", "running", "Posting review comment", { input: ctx.pendingInput }));
      await deps.github.postPrComment(params.owner, params.repoName, ctx.pr!.number, comment);
      deps.eventBus.emit(stageEvent("post_review", "done", "posted", { output: { posted: true } }));
      ctx.tracingEntries.push({
        stage: "post_review",
        status: "done",
        input: ctx.pendingInput,
        output: { posted: true },
      });
    },
  },
  {
    name: "merge",
    abortable: ABORTABLE_STAGES.includes("merge"),
    guard: (ctx) => ctx.qaOutput!.findings.some((f) => f.severity === "critical"),
    async run(ctx, params, deps) {
      ctx.pendingInput = { prNumber: ctx.pr!.number };
      deps.eventBus.emit(stageEvent("merge", "running", "Merging pull request", { input: ctx.pendingInput }));
      await deps.github.mergePullRequest(params.owner, params.repoName, ctx.pr!.number);
      deps.eventBus.emit(stageEvent("merge", "done", "merged", { output: { merged: true } }));
      ctx.tracingEntries.push({ stage: "merge", status: "done", input: ctx.pendingInput, output: { merged: true } });
    },
  },
  {
    name: "deploy",
    abortable: ABORTABLE_STAGES.includes("deploy"),
    async run(ctx, params, deps) {
      ctx.pendingInput = {
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
        workDir: params.workDir,
      };
      deps.eventBus.emit(stageEvent("deploy", "running", `Deploying to ${deps.deploy.label}`, { input: ctx.pendingInput }));
      const live = await deps.deploy.deploy({
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
        workDir: params.workDir,
      });
      deps.eventBus.emit(stageEvent("deploy", "done", live.url, { output: live }));
      ctx.tracingEntries.push({ stage: "deploy", status: "done", input: ctx.pendingInput, output: live });
      ctx.deployUrl = live.url;
    },
  },
];

function renderContextSoFar(ideaText: string, entries: TracingPackEntry[]): string {
  const sections = entries.map((entry) => `## ${entry.stage}\n${JSON.stringify(entry.output ?? {}, null, 2)}`);
  return [
    "IDEA:",
    ideaText,
    "",
    "OUTPUT SO FAR FROM EARLIER PIPELINE STAGES:",
    sections.length > 0 ? sections.join("\n\n") : "(none yet)",
  ].join("\n");
}

function buildCustomStep(agent: AgentDefinition): StageStep {
  const stageName = `custom:${agent.id}` as StageName;
  return {
    name: stageName,
    abortable: true,
    async run(ctx, params, deps, signal) {
      const contextText = renderContextSoFar(params.ideaText, ctx.tracingEntries);
      ctx.pendingInput = { agentName: agent.name, instructions: agent.instructions, repoAccess: agent.repoAccess };
      deps.eventBus.emit(stageEvent(stageName, "running", `Running ${agent.name}`, { input: ctx.pendingInput }));
      if (agent.repoAccess && !ctx.repoCloned) {
        await deps.git.cloneRepo(ctx.repo!.cloneUrl, params.workDir, params.githubToken);
        ctx.repoCloned = true;
      }
      const { output, usage } = await deps.agents.custom(agent, contextText, params.workDir, signal);
      deps.eventBus.emit(stageEvent(stageName, "done", output.text.slice(0, 200), { output, usage }));
      ctx.tracingEntries.push({ stage: stageName, status: "done", input: ctx.pendingInput, output, usage });
    },
  };
}

export function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[] {
  const steps: StageStep[] = [];
  for (const step of BACKBONE_STEPS) {
    steps.push(step);
    const afterThisStage = resolvedWorkflow.slots[step.name as BackboneStage] ?? [];
    steps.push(...afterThisStage.map(buildCustomStep));
  }
  return steps;
}

export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
  resumeState?: ResumeState,
  onAbortableStep?: (controller: AbortController | undefined) => void,
): Promise<RunOutcome> {
  const ctx: PipelineContext = resumeState?.ctx ?? { tracingEntries: [] };
  const startIndex = resumeState?.stageIndex ?? 0;
  const stageSteps = buildStageSteps(params.resolvedWorkflow);

  async function commitTracingPack(outcome: string): Promise<void> {
    if (!ctx.repo) return;
    try {
      deps.eventBus.emit(
        stageEvent("tracing_pack", "running", "Committing the tracing pack to the repo", {
          input: { path: TRACING_PACK_PATH },
        }),
      );
      const markdown = formatTracingPackMarkdown(ctx.tracingEntries, outcome);
      const result = await deps.github.commitFile(
        params.owner,
        params.repoName,
        TRACING_PACK_PATH,
        markdown,
        BASE_BRANCH,
      );
      deps.eventBus.emit(
        stageEvent("tracing_pack", "done", TRACING_PACK_PATH, { output: { committed: true, sha: result.sha } }),
      );
    } catch (error) {
      const err = error as Error;
      deps.eventBus.emit(stageEvent("tracing_pack", "failed", err.message));
    }
  }

  let currentStage: StageName = stageSteps[startIndex]?.name ?? "create_repo";
  for (let i = startIndex; i < stageSteps.length; i++) {
    const step = stageSteps[i];
    currentStage = step.name;
    if (step.guard?.(ctx)) {
      deps.eventBus.emit(
        stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped", {
          output: { findings: ctx.qaOutput!.findings },
        }),
      );
      ctx.tracingEntries.push({ stage: "merge", status: "blocked", output: { findings: ctx.qaOutput!.findings } });
      await commitTracingPack("blocked");
      return { status: "blocked", findings: ctx.qaOutput!.findings, prUrl: ctx.pr!.htmlUrl };
    }
    const controller = step.abortable ? new AbortController() : undefined;
    if (step.abortable) onAbortableStep?.(controller);
    try {
      await step.run(ctx, params, deps, controller?.signal);
    } catch (error) {
      if (error instanceof AgentStoppedError) {
        deps.eventBus.emit(stageEvent(currentStage, "stopped", "Stopped by user"));
        return { status: "stopped", stage: currentStage, resumeState: { stageIndex: i, ctx } };
      }
      const err = error as Error;
      deps.eventBus.emit(stageEvent(currentStage, "failed", err.message));
      ctx.tracingEntries.push({ stage: currentStage, status: "failed", input: ctx.pendingInput, output: err.message });
      await commitTracingPack("failed");
      return { status: "failed", stage: currentStage, error: err.message };
    } finally {
      if (step.abortable) onAbortableStep?.(undefined);
    }
  }

  await commitTracingPack("deployed");
  return { status: "deployed", url: ctx.deployUrl!, prUrl: ctx.pr!.htmlUrl };
}
