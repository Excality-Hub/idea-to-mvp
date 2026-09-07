import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "../git.js";
import type { runAnalystAgent } from "../agents/analyst.js";
import type { runArchitectAgent } from "../agents/architect.js";
import type { runDeveloperAgent } from "../agents/developer.js";
import type { runQaAgent } from "../agents/qa.js";
import type { QAFinding, QAOutput } from "../agents/schemas.js";
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

export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
): Promise<RunOutcome> {
  const { eventBus, github, render, git, agents, readStarterFiles } = deps;
  let currentStage: StageName = "create_repo";
  let currentInput: unknown;
  const tracingEntries: TracingPackEntry[] = [];
  let repo: Awaited<ReturnType<typeof github.createRepoFromStarter>> | undefined;

  async function commitTracingPack(outcome: string): Promise<void> {
    if (!repo) return;
    try {
      eventBus.emit(
        stageEvent("tracing_pack", "running", "Committing the tracing pack to the repo", {
          input: { path: TRACING_PACK_PATH },
        }),
      );
      const markdown = formatTracingPackMarkdown(tracingEntries, outcome);
      const result = await github.commitFile(params.owner, params.repoName, TRACING_PACK_PATH, markdown, BASE_BRANCH);
      eventBus.emit(
        stageEvent("tracing_pack", "done", TRACING_PACK_PATH, { output: { committed: true, sha: result.sha } }),
      );
    } catch (error) {
      const err = error as Error;
      eventBus.emit(stageEvent("tracing_pack", "failed", err.message));
    }
  }

  try {
    currentStage = "create_repo";
    const starterFiles = readStarterFiles(params.starterDir);
    currentInput = {
      owner: params.owner,
      repoName: params.repoName,
      starterFilePaths: starterFiles.map((f) => f.path),
    };
    eventBus.emit(stageEvent(currentStage, "running", "Creating GitHub repo from starter template", { input: currentInput }));
    repo = await github.createRepoFromStarter({
      owner: params.owner,
      repoName: params.repoName,
      starterFiles,
    });
    const createRepoOutput = { htmlUrl: repo.htmlUrl, cloneUrl: repo.cloneUrl };
    eventBus.emit(stageEvent(currentStage, "done", repo.htmlUrl, { output: createRepoOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: createRepoOutput });

    currentStage = "analyst";
    currentInput = { ideaText: params.ideaText };
    eventBus.emit(stageEvent(currentStage, "running", "Analyzing idea", { input: currentInput }));
    const analystOutput = await agents.analyst(params.ideaText, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", analystOutput.summary, { output: analystOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: analystOutput });

    currentStage = "architect";
    currentInput = { analystOutput };
    eventBus.emit(stageEvent(currentStage, "running", "Planning implementation", { input: currentInput }));
    const architectOutput = await agents.architect(analystOutput, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", architectOutput.issueTitle, { output: architectOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: architectOutput });

    currentStage = "open_issue";
    currentInput = { title: architectOutput.issueTitle, body: architectOutput.issueBody };
    eventBus.emit(stageEvent(currentStage, "running", "Opening GitHub issue", { input: currentInput }));
    const issue = await github.createIssue(
      params.owner,
      params.repoName,
      architectOutput.issueTitle,
      architectOutput.issueBody,
    );
    eventBus.emit(stageEvent(currentStage, "done", `#${issue.number}`, { output: issue }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: issue });

    currentStage = "developer";
    currentInput = { issueBody: architectOutput.issueBody };
    eventBus.emit(stageEvent(currentStage, "running", "Implementing the plan", { input: currentInput }));
    await git.cloneRepo(repo.cloneUrl, params.workDir, params.githubToken);
    await git.createAndCheckoutBranch(params.workDir, architectOutput.branchName);
    const developerOutput = await agents.developer(architectOutput.issueBody, params.workDir);
    await git.pushBranch(params.workDir, architectOutput.branchName, params.githubToken);
    eventBus.emit(stageEvent(currentStage, "done", developerOutput.prTitle, { output: developerOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: developerOutput });

    currentStage = "open_pr";
    currentInput = {
      title: developerOutput.prTitle,
      body: developerOutput.prBody,
      head: architectOutput.branchName,
      base: BASE_BRANCH,
    };
    eventBus.emit(stageEvent(currentStage, "running", "Opening pull request", { input: currentInput }));
    const pr = await github.createPullRequest({
      owner: params.owner,
      repo: params.repoName,
      title: developerOutput.prTitle,
      body: developerOutput.prBody,
      head: architectOutput.branchName,
      base: BASE_BRANCH,
      issueNumber: issue.number,
    });
    eventBus.emit(stageEvent(currentStage, "done", pr.htmlUrl, { output: pr }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: pr });

    currentStage = "qa";
    currentInput = undefined;
    eventBus.emit(stageEvent(currentStage, "running", "Reviewing the pull request"));
    const diff = await git.diffAgainstBase(params.workDir, BASE_BRANCH);
    currentInput = { diff };
    const qaOutput = await agents.qa(diff, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", qaOutput.verdict, { output: qaOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: qaOutput });

    currentStage = "post_review";
    const comment = formatQaComment(qaOutput);
    currentInput = { comment };
    eventBus.emit(stageEvent(currentStage, "running", "Posting review comment", { input: currentInput }));
    await github.postPrComment(params.owner, params.repoName, pr.number, comment);
    eventBus.emit(stageEvent(currentStage, "done", "posted", { output: { posted: true } }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: { posted: true } });

    const hasCritical = qaOutput.findings.some((f) => f.severity === "critical");
    if (hasCritical) {
      eventBus.emit(
        stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped", {
          output: { findings: qaOutput.findings },
        }),
      );
      tracingEntries.push({ stage: "merge", status: "blocked", output: { findings: qaOutput.findings } });
      await commitTracingPack("blocked");
      return { status: "blocked", findings: qaOutput.findings, prUrl: pr.htmlUrl };
    }

    currentStage = "merge";
    currentInput = { prNumber: pr.number };
    eventBus.emit(stageEvent(currentStage, "running", "Merging pull request", { input: currentInput }));
    await github.mergePullRequest(params.owner, params.repoName, pr.number);
    eventBus.emit(stageEvent(currentStage, "done", "merged", { output: { merged: true } }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: { merged: true } });

    currentStage = "deploy";
    currentInput = { name: params.repoName, repoUrl: repo.htmlUrl, branch: BASE_BRANCH };
    eventBus.emit(stageEvent(currentStage, "running", "Deploying to Render", { input: currentInput }));
    const service = await render.createService({
      name: params.repoName,
      repoUrl: repo.htmlUrl,
      branch: BASE_BRANCH,
    });
    const live = await render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
    eventBus.emit(stageEvent(currentStage, "done", live.url, { output: live }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: live });

    await commitTracingPack("deployed");
    return { status: "deployed", url: live.url, prUrl: pr.htmlUrl };
  } catch (error) {
    const err = error as Error;
    eventBus.emit(stageEvent(currentStage, "failed", err.message));
    tracingEntries.push({ stage: currentStage, status: "failed", input: currentInput, output: err.message });
    await commitTracingPack("failed");
    return { status: "failed", stage: currentStage, error: err.message };
  }
}
