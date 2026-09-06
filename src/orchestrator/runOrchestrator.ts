import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "../git.js";
import type { runAnalystAgent } from "../agents/analyst.js";
import type { runArchitectAgent } from "../agents/architect.js";
import type { runDeveloperAgent } from "../agents/developer.js";
import type { runQaAgent } from "../agents/qa.js";
import type { QAFinding, QAOutput } from "../agents/schemas.js";
import type { RenderClient } from "../deploy/render.js";
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

function stageEvent(stage: StageName, status: RunEvent["status"], message: string): RunEvent {
  return { stage, status, message, timestamp: new Date().toISOString() };
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

  try {
    eventBus.emit(stageEvent(currentStage, "running", "Creating GitHub repo from starter template"));
    const starterFiles = readStarterFiles(params.starterDir);
    const repo = await github.createRepoFromStarter({
      owner: params.owner,
      repoName: params.repoName,
      starterFiles,
    });
    eventBus.emit(stageEvent(currentStage, "done", repo.htmlUrl));

    currentStage = "analyst";
    eventBus.emit(stageEvent(currentStage, "running", "Analyzing idea"));
    const analystOutput = await agents.analyst(params.ideaText, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", analystOutput.summary));

    currentStage = "architect";
    eventBus.emit(stageEvent(currentStage, "running", "Planning implementation"));
    const architectOutput = await agents.architect(analystOutput, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", architectOutput.issueTitle));

    currentStage = "open_issue";
    eventBus.emit(stageEvent(currentStage, "running", "Opening GitHub issue"));
    const issue = await github.createIssue(
      params.owner,
      params.repoName,
      architectOutput.issueTitle,
      architectOutput.issueBody,
    );
    eventBus.emit(stageEvent(currentStage, "done", `#${issue.number}`));

    currentStage = "developer";
    eventBus.emit(stageEvent(currentStage, "running", "Implementing the plan"));
    await git.cloneRepo(repo.cloneUrl, params.workDir, params.githubToken);
    await git.createAndCheckoutBranch(params.workDir, architectOutput.branchName);
    const developerOutput = await agents.developer(architectOutput.issueBody, params.workDir);
    await git.pushBranch(params.workDir, architectOutput.branchName, params.githubToken);
    eventBus.emit(stageEvent(currentStage, "done", developerOutput.prTitle));

    currentStage = "open_pr";
    eventBus.emit(stageEvent(currentStage, "running", "Opening pull request"));
    const pr = await github.createPullRequest({
      owner: params.owner,
      repo: params.repoName,
      title: developerOutput.prTitle,
      body: developerOutput.prBody,
      head: architectOutput.branchName,
      base: BASE_BRANCH,
      issueNumber: issue.number,
    });
    eventBus.emit(stageEvent(currentStage, "done", pr.htmlUrl));

    currentStage = "qa";
    eventBus.emit(stageEvent(currentStage, "running", "Reviewing the pull request"));
    const diff = await git.diffAgainstBase(params.workDir, BASE_BRANCH);
    const qaOutput = await agents.qa(diff, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", qaOutput.verdict));

    currentStage = "post_review";
    eventBus.emit(stageEvent(currentStage, "running", "Posting review comment"));
    await github.postPrComment(params.owner, params.repoName, pr.number, formatQaComment(qaOutput));
    eventBus.emit(stageEvent(currentStage, "done", "posted"));

    const hasCritical = qaOutput.findings.some((f) => f.severity === "critical");
    if (hasCritical) {
      eventBus.emit(stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped"));
      return { status: "blocked", findings: qaOutput.findings, prUrl: pr.htmlUrl };
    }

    currentStage = "merge";
    eventBus.emit(stageEvent(currentStage, "running", "Merging pull request"));
    await github.mergePullRequest(params.owner, params.repoName, pr.number);
    eventBus.emit(stageEvent(currentStage, "done", "merged"));

    currentStage = "deploy";
    eventBus.emit(stageEvent(currentStage, "running", "Deploying to Render"));
    const service = await render.createService({
      name: params.repoName,
      repoUrl: repo.htmlUrl,
      branch: BASE_BRANCH,
    });
    const live = await render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
    eventBus.emit(stageEvent(currentStage, "done", live.url));

    return { status: "deployed", url: live.url, prUrl: pr.htmlUrl };
  } catch (error) {
    const err = error as Error;
    eventBus.emit(stageEvent(currentStage, "failed", err.message));
    return { status: "failed", stage: currentStage, error: err.message };
  }
}
