import { describe, expect, it, vi } from "vitest";
import { AgentStoppedError } from "../claudeAgent.js";
import { RunEventBus } from "./events.js";
import { runOrchestrator, type OrchestratorDeps, type OrchestratorParams } from "./runOrchestrator.js";
import type { RunEvent } from "./types.js";

const params: OrchestratorParams = {
  ideaText: "Build a todo app",
  owner: "org",
  repoName: "idea-to-mvp-app-1",
  starterDir: "/templates/starter",
  workDir: "/tmp/work",
  githubToken: "test-token",
};

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const github = {
    createRepoFromStarter: vi.fn().mockResolvedValue({
      owner: "org",
      repo: "idea-to-mvp-app-1",
      htmlUrl: "https://github.com/org/idea-to-mvp-app-1",
      cloneUrl: "https://github.com/org/idea-to-mvp-app-1.git",
    }),
    createIssue: vi.fn().mockResolvedValue({ number: 1 }),
    createPullRequest: vi.fn().mockResolvedValue({
      number: 2,
      htmlUrl: "https://github.com/org/idea-to-mvp-app-1/pull/2",
    }),
    postPrComment: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    commitFile: vi.fn().mockResolvedValue({ sha: "tracing-pack-sha" }),
  };
  const render = {
    createService: vi.fn().mockResolvedValue({ serviceId: "srv-1" }),
    waitForLive: vi.fn().mockResolvedValue({ url: "https://idea-to-mvp-app-1.onrender.com" }),
  };
  const git = {
    cloneRepo: vi.fn().mockResolvedValue(undefined),
    createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
    resetWorkingTree: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    diffAgainstBase: vi.fn().mockResolvedValue("diff --git a/server.js b/server.js"),
  };
  const agents = {
    analyst: vi.fn().mockResolvedValue({
      summary: "A todo app",
      goals: [],
      keyFeatures: [],
      nonGoals: [],
      openQuestions: [],
    }),
    architect: vi.fn().mockResolvedValue({
      issueTitle: "Add task tracking",
      issueBody: "Implement it",
      branchName: "feature/x",
    }),
    developer: vi.fn().mockResolvedValue({ prTitle: "Add task tracking", prBody: "Done" }),
    qa: vi.fn().mockResolvedValue({ verdict: "pass", findings: [] }),
  };

  return {
    eventBus: new RunEventBus(),
    github: github as never,
    render: render as never,
    git: git as never,
    agents: agents as never,
    readStarterFiles: vi.fn().mockReturnValue([{ path: "package.json", content: "{}" }]),
    ...overrides,
  };
}

describe("runOrchestrator", () => {
  it("runs every stage, including the final tracing_pack stage, and deploys when QA passes", async () => {
    const deps = makeDeps();
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({
      status: "deployed",
      url: "https://idea-to-mvp-app-1.onrender.com",
      prUrl: "https://github.com/org/idea-to-mvp-app-1/pull/2",
    });
    expect(deps.github.mergePullRequest).toHaveBeenCalledWith("org", "idea-to-mvp-app-1", 2);
    expect(deps.render.createService).toHaveBeenCalledWith({
      name: "idea-to-mvp-app-1",
      repoUrl: "https://github.com/org/idea-to-mvp-app-1",
      branch: "main",
    });
    expect(events).toEqual([
      "create_repo:running",
      "create_repo:done",
      "analyst:running",
      "analyst:done",
      "architect:running",
      "architect:done",
      "open_issue:running",
      "open_issue:done",
      "developer:running",
      "developer:done",
      "open_pr:running",
      "open_pr:done",
      "qa:running",
      "qa:done",
      "post_review:running",
      "post_review:done",
      "merge:running",
      "merge:done",
      "deploy:running",
      "deploy:done",
      "tracing_pack:running",
      "tracing_pack:done",
    ]);
  });

  it("captures each stage's input and output on its events", async () => {
    const deps = makeDeps();
    const events: RunEvent[] = [];
    deps.eventBus.onEvent((event) => events.push(event));

    await runOrchestrator(params, deps);

    const analystRunning = events.find((e) => e.stage === "analyst" && e.status === "running");
    const analystDone = events.find((e) => e.stage === "analyst" && e.status === "done");
    expect(analystRunning?.input).toEqual({ ideaText: "Build a todo app" });
    expect(analystDone?.output).toEqual({
      summary: "A todo app",
      goals: [],
      keyFeatures: [],
      nonGoals: [],
      openQuestions: [],
    });

    const createRepoDone = events.find((e) => e.stage === "create_repo" && e.status === "done");
    expect(createRepoDone?.output).toEqual({
      htmlUrl: "https://github.com/org/idea-to-mvp-app-1",
      cloneUrl: "https://github.com/org/idea-to-mvp-app-1.git",
    });

    const qaDone = events.find((e) => e.stage === "qa" && e.status === "done");
    expect(qaDone?.output).toEqual({ verdict: "pass", findings: [] });
  });

  it("commits a TRACING_PACK.md to the repo's main branch after a deployed run", async () => {
    const deps = makeDeps();

    await runOrchestrator(params, deps);

    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [owner, repo, path, content, branch] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(owner).toBe("org");
    expect(repo).toBe("idea-to-mvp-app-1");
    expect(path).toBe("TRACING_PACK.md");
    expect(branch).toBe("main");
    expect(content).toContain("Outcome: **deployed**");
    expect(content).toContain("## create_repo");
    expect(content).toContain("## deploy");
  });

  it("blocks before merging or deploying when QA reports a critical finding, and still commits a partial tracing pack", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.qa).mockResolvedValue({
      verdict: "block",
      findings: [
        { severity: "critical", category: "security", summary: "SQL injection", file: "server.js", line: 10 },
      ],
    });

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("blocked");
    expect(deps.github.mergePullRequest).not.toHaveBeenCalled();
    expect(deps.render.createService).not.toHaveBeenCalled();
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(content).toContain("Outcome: **blocked**");
    expect(content).not.toContain("## deploy");
  });

  it("reports a failed outcome at the stage that threw, and still commits a tracing pack for the repo that exists", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockRejectedValue(new Error("claude -p crashed"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "developer", error: "claude -p crashed" });
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(content).toContain("Outcome: **failed**");
    expect(content).toContain("## developer");
  });

  it("records the qa stage's tracing-pack input as none (not the previous open_pr stage's input) when qa fails before computing the diff", async () => {
    const deps = makeDeps();
    vi.mocked(deps.git.diffAgainstBase).mockRejectedValue(new Error("git diff failed"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "qa", error: "git diff failed" });
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    const qaSection = content.slice(content.indexOf("## qa"));
    // The qa entry's input must not be open_pr's carried-over shape.
    expect(qaSection).not.toContain('"head"');
    expect(qaSection).not.toContain('"base"');
    expect(qaSection).toContain("**Input**\n\n_none_");
  });

  it("does not commit a tracing pack when the repo itself was never created", async () => {
    const deps = makeDeps();
    vi.mocked(deps.github.createRepoFromStarter).mockRejectedValue(new Error("repo already exists"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "create_repo", error: "repo already exists" });
    expect(deps.github.commitFile).not.toHaveBeenCalled();
  });

  it("proceeds through merge and deploy when QA findings are present but none are critical", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.qa).mockResolvedValue({
      verdict: "pass",
      findings: [
        { severity: "major", category: "correctness", summary: "off-by-one in pagination", file: "server.js", line: 22 },
      ],
    });

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("deployed");
    expect(deps.github.mergePullRequest).toHaveBeenCalledWith("org", "idea-to-mvp-app-1", 2);
    expect(deps.render.createService).toHaveBeenCalled();
  });

  it("stops the run when the developer agent is aborted, without committing a tracing pack", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockImplementation(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        }),
    );
    const outcome = await runOrchestrator(params, deps, undefined, (controller) => controller?.abort());

    expect(outcome.status).toBe("stopped");
    if (outcome.status === "stopped") {
      expect(outcome.stage).toBe("developer");
      expect(outcome.resumeState.stageIndex).toBeGreaterThanOrEqual(0);
      expect(outcome.resumeState.ctx.repo).toBeDefined();
    }
    expect(deps.github.commitFile).not.toHaveBeenCalled();
  });

  it("resumes a stopped run from the stored snapshot and continues to completion", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockImplementationOnce(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        }),
    );
    const stopped = await runOrchestrator(params, deps, undefined, (controller) => controller?.abort());
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");

    const outcome = await runOrchestrator(params, deps, stopped.resumeState);

    expect(outcome.status).toBe("deployed");
    expect(deps.git.createAndCheckoutBranch).toHaveBeenCalledTimes(2);
    expect(deps.github.mergePullRequest).toHaveBeenCalled();
  });

  it("does not re-clone the repo on resume, but does re-checkout the branch to discard partial edits", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockImplementationOnce(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        }),
    );
    const stopped = await runOrchestrator(params, deps, undefined, (controller) => controller?.abort());
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");

    const outcome = await runOrchestrator(params, deps, stopped.resumeState);

    expect(deps.git.cloneRepo).toHaveBeenCalledTimes(1);
    expect(deps.git.createAndCheckoutBranch).toHaveBeenCalledTimes(2);
    expect(deps.git.resetWorkingTree).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("deployed");
  });

  it("does not let a stop that lands after an abortable stage's agent call already resolved poison a later abortable stage", async () => {
    const deps = makeDeps();
    // qa must actually honour its signal for this test to have teeth: with the old
    // run-scoped signal, qa would inherit developer's already-aborted signal and
    // stop here, so an inert qa mock would let the buggy design pass.
    vi.mocked(deps.agents.qa).mockImplementation(
      (_diff: string, _cwd: string, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
          resolve({ verdict: "pass", findings: [] });
        }),
    );
    let developerController: AbortController | undefined;

    const outcome = await runOrchestrator(params, deps, undefined, (controller) => {
      if (controller) {
        developerController = controller;
      } else {
        // This branch runs once developer's run() (agent call + pushBranch) has
        // fully finished. Aborting the now-stale controller here simulates a
        // stop() request that physically arrives after developer's agent call
        // already resolved. It must not affect qa's later, separate controller.
        developerController?.abort();
      }
    });

    expect(outcome.status).toBe("deployed");
    expect(deps.agents.qa).toHaveBeenCalled();
  });
});
