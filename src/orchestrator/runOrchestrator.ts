import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "../git.js";
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
import type { RenderClient } from "../deploy/render.js";
import { formatTracingPackMarkdown, type TracingPackEntry } from "./tracingPack.js";
import { RunEventBus } from "./events.js";
import type { RunEvent, StageName } from "./types.js";

export interface OrchestratorParams {
  ideaText: string;
  owner: string;
  repoName: string;
  starterDir: string;
  workDir: string;
  githubToken: string;
}

export interface OrchestratorDeps {
  eventBus: RunEventBus;
  github: GithubClient;
  render: RenderClient;
  git: {
    cloneRepo: typeof cloneRepo;
    createAndCheckoutBranch: typeof createAndCheckoutBranch;
    pushBranch: typeof pushBranch;
    diffAgainstBase: typeof diffAgainstBase;
  };
  agents: {
    analyst: typeof runAnalystAgent;
    architect: typeof runArchitectAgent;
    developer: typeof runDeveloperAgent;
    qa: typeof runQaAgent;
  };
  readStarterFiles: typeof ReadStarterFiles;
}

export type RunOutcome =
  | { status: "deployed"; url: string; prUrl: string }
  | { status: "blocked"; findings: QAFinding[]; prUrl: string }
  | { status: "failed"; stage: StageName; error: string };

const BASE_BRANCH = "main";
const TRACING_PACK_PATH = "TRACING_PACK.md";

function stageEvent(
  stage: StageName,
  status: RunEvent["status"],
  message: string,
  extra?: { input?: unknown; output?: unknown },
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
  analystOutput?: AnalystOutput;
  architectOutput?: ArchitectOutput;
  issue?: { number: number };
  developerOutput?: DeveloperOutput;
  pr?: { number: number; htmlUrl: string };
  diff?: string;
  qaOutput?: QAOutput;
  deployUrl?: string;
}

interface StageStep {
  name: StageName;
  guard?: (ctx: PipelineContext) => boolean;
  run(ctx: PipelineContext, params: OrchestratorParams, deps: OrchestratorDeps): Promise<void>;
}

const STAGE_STEPS: StageStep[] = [
  {
    name: "create_repo",
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
    async run(ctx, params, deps) {
      ctx.pendingInput = { ideaText: params.ideaText };
      deps.eventBus.emit(stageEvent("analyst", "running", "Analyzing idea", { input: ctx.pendingInput }));
      const analystOutput = await deps.agents.analyst(params.ideaText, params.workDir);
      deps.eventBus.emit(stageEvent("analyst", "done", analystOutput.summary, { output: analystOutput }));
      ctx.tracingEntries.push({ stage: "analyst", status: "done", input: ctx.pendingInput, output: analystOutput });
      ctx.analystOutput = analystOutput;
    },
  },
  {
    name: "architect",
    async run(ctx, params, deps) {
      ctx.pendingInput = { analystOutput: ctx.analystOutput };
      deps.eventBus.emit(stageEvent("architect", "running", "Planning implementation", { input: ctx.pendingInput }));
      const architectOutput = await deps.agents.architect(ctx.analystOutput!, params.workDir);
      deps.eventBus.emit(stageEvent("architect", "done", architectOutput.issueTitle, { output: architectOutput }));
      ctx.tracingEntries.push({
        stage: "architect",
        status: "done",
        input: ctx.pendingInput,
        output: architectOutput,
      });
      ctx.architectOutput = architectOutput;
    },
  },
  {
    name: "open_issue",
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
    async run(ctx, params, deps) {
      ctx.pendingInput = { issueBody: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("developer", "running", "Implementing the plan", { input: ctx.pendingInput }));
      await deps.git.cloneRepo(ctx.repo!.cloneUrl, params.workDir, params.githubToken);
      await deps.git.createAndCheckoutBranch(params.workDir, ctx.architectOutput!.branchName);
      const developerOutput = await deps.agents.developer(ctx.architectOutput!.issueBody, params.workDir);
      await deps.git.pushBranch(params.workDir, ctx.architectOutput!.branchName, params.githubToken);
      deps.eventBus.emit(stageEvent("developer", "done", developerOutput.prTitle, { output: developerOutput }));
      ctx.tracingEntries.push({
        stage: "developer",
        status: "done",
        input: ctx.pendingInput,
        output: developerOutput,
      });
      ctx.developerOutput = developerOutput;
    },
  },
  {
    name: "open_pr",
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
    async run(ctx, params, deps) {
      ctx.pendingInput = undefined;
      deps.eventBus.emit(stageEvent("qa", "running", "Reviewing the pull request"));
      const diff = await deps.git.diffAgainstBase(params.workDir, BASE_BRANCH);
      ctx.pendingInput = { diff };
      const qaOutput = await deps.agents.qa(diff, params.workDir);
      deps.eventBus.emit(stageEvent("qa", "done", qaOutput.verdict, { output: qaOutput }));
      ctx.tracingEntries.push({ stage: "qa", status: "done", input: ctx.pendingInput, output: qaOutput });
      ctx.diff = diff;
      ctx.qaOutput = qaOutput;
    },
  },
  {
    name: "post_review",
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
    async run(ctx, params, deps) {
      ctx.pendingInput = { name: params.repoName, repoUrl: ctx.repo!.htmlUrl, branch: BASE_BRANCH };
      deps.eventBus.emit(stageEvent("deploy", "running", "Deploying to Render", { input: ctx.pendingInput }));
      const service = await deps.render.createService({
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
      });
      const live = await deps.render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
      deps.eventBus.emit(stageEvent("deploy", "done", live.url, { output: live }));
      ctx.tracingEntries.push({ stage: "deploy", status: "done", input: ctx.pendingInput, output: live });
      ctx.deployUrl = live.url;
    },
  },
];

export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
): Promise<RunOutcome> {
  const ctx: PipelineContext = { tracingEntries: [] };

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

  let currentStage: StageName = "create_repo";
  for (const step of STAGE_STEPS) {
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
    try {
      await step.run(ctx, params, deps);
    } catch (error) {
      const err = error as Error;
      deps.eventBus.emit(stageEvent(currentStage, "failed", err.message));
      ctx.tracingEntries.push({ stage: currentStage, status: "failed", input: ctx.pendingInput, output: err.message });
      await commitTracingPack("failed");
      return { status: "failed", stage: currentStage, error: err.message };
    }
  }

  await commitTracingPack("deployed");
  return { status: "deployed", url: ctx.deployUrl!, prUrl: ctx.pr!.htmlUrl };
}
