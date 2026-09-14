import { describe, expect, it, vi } from "vitest";
import { AgentStoppedError } from "../claudeAgent.js";
import { RunEventBus } from "./events.js";
import { BACKBONE_STEPS, runOrchestrator, type OrchestratorDeps, type OrchestratorParams } from "./runOrchestrator.js";
import { BACKBONE_STAGES, type ResolvedWorkflow, type RunEvent } from "./types.js";

const fakeUsage = {
  inputTokens: 100,
  outputTokens: 50,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  costUsd: 0.01,
};

const EMPTY_WORKFLOW: ResolvedWorkflow = { slots: {} };

const params: OrchestratorParams = {
  ideaText: "Build a todo app",
  owner: "org",
  repoName: "idea-to-mvp-app-1",
  starterDir: "/templates/starter",
  workDir: "/tmp/work",
  githubToken: "test-token",
  resolvedWorkflow: EMPTY_WORKFLOW,
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
  const deploy = {
    label: "Render",
    deploy: vi.fn().mockResolvedValue({ url: "https://idea-to-mvp-app-1.onrender.com" }),
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
      output: {
        summary: "A todo app",
        goals: [],
        keyFeatures: [],
        nonGoals: [],
        openQuestions: [],
      },
      usage: fakeUsage,
    }),
    architect: vi.fn().mockResolvedValue({
      output: {
        issueTitle: "Add task tracking",
        issueBody: "Implement it",
        branchName: "feature/x",
      },
      usage: fakeUsage,
    }),
    developer: vi.fn().mockResolvedValue({
      output: { prTitle: "Add task tracking", prBody: "Done" },
      usage: fakeUsage,
    }),
    qa: vi.fn().mockResolvedValue({ output: { verdict: "pass", findings: [] }, usage: fakeUsage }),
    custom: vi.fn(),
  };

  return {
    eventBus: new RunEventBus(),
    github: github as never,
    deploy: deploy as never,
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
    expect(deps.deploy.deploy).toHaveBeenCalledWith({
      name: "idea-to-mvp-app-1",
      repoUrl: "https://github.com/org/idea-to-mvp-app-1",
      branch: "main",
      workDir: "/tmp/work",
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

  it("attaches each LLM stage's token usage to its done event and the tracing pack, without adding usage to non-LLM stages", async () => {
    const deps = makeDeps();
    const events: RunEvent[] = [];
    deps.eventBus.onEvent((event) => events.push(event));

    await runOrchestrator(params, deps);

    const analystDone = events.find((e) => e.stage === "analyst" && e.status === "done");
    const architectDone = events.find((e) => e.stage === "architect" && e.status === "done");
    const developerDone = events.find((e) => e.stage === "developer" && e.status === "done");
    const qaDone = events.find((e) => e.stage === "qa" && e.status === "done");
    expect(analystDone?.usage).toEqual(fakeUsage);
    expect(architectDone?.usage).toEqual(fakeUsage);
    expect(developerDone?.usage).toEqual(fakeUsage);
    expect(qaDone?.usage).toEqual(fakeUsage);

    const createRepoDone = events.find((e) => e.stage === "create_repo" && e.status === "done");
    expect(createRepoDone?.usage).toBeUndefined();

    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    const analystSection = content.slice(content.indexOf("## analyst"), content.indexOf("## architect"));
    expect(analystSection).toContain("**Tokens**");
    const createRepoSection = content.slice(content.indexOf("## create_repo"), content.indexOf("## analyst"));
    expect(createRepoSection).not.toContain("**Tokens**");
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
      output: {
        verdict: "block",
        findings: [
          { severity: "critical", category: "security", summary: "SQL injection", file: "server.js", line: 10 },
        ],
      },
      usage: fakeUsage,
    });

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("blocked");
    expect(deps.github.mergePullRequest).not.toHaveBeenCalled();
    expect(deps.deploy.deploy).not.toHaveBeenCalled();
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

  it("retries a stage after a transient error and completes the run once it succeeds", async () => {
    const deps = makeDeps({ sleep: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(deps.agents.developer)
      .mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { status: 502 }))
      .mockResolvedValueOnce({
        output: { prTitle: "Add task tracking", prBody: "Done" },
        usage: fakeUsage,
      });
    const events: RunEvent[] = [];
    deps.eventBus.onEvent((event) => events.push(event));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("deployed");
    expect(deps.agents.developer).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.stage === "developer" && e.status === "failed")).toBe(false);
    expect(
      events.some((e) => e.stage === "developer" && e.status === "running" && e.message.includes("Retrying")),
    ).toBe(true);
  });

  it("does not retry a non-transient stage failure", async () => {
    const deps = makeDeps({ sleep: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(deps.agents.developer).mockRejectedValue(new Error("claude -p crashed"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "developer", error: "claude -p crashed" });
    expect(deps.agents.developer).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
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
      output: {
        verdict: "pass",
        findings: [
          { severity: "major", category: "correctness", summary: "off-by-one in pagination", file: "server.js", line: 22 },
        ],
      },
      usage: fakeUsage,
    });

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("deployed");
    expect(deps.github.mergePullRequest).toHaveBeenCalledWith("org", "idea-to-mvp-app-1", 2);
    expect(deps.deploy.deploy).toHaveBeenCalled();
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
          resolve({ output: { verdict: "pass", findings: [] }, usage: fakeUsage });
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

  it("inserts a custom agent step after analyst, running it with the idea and prior output as context", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "No security issues found." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              kind: "agent",
              agent: {
                id: "sec-1",
                name: "Security Reviewer",
                instructions: "Look for auth bypass issues.",
                repoAccess: true,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("deployed");
    const analystIndex = events.indexOf("analyst:done");
    const architectIndex = events.indexOf("architect:running");
    expect(events.slice(analystIndex + 1, architectIndex)).toEqual(["custom:sec-1:running", "custom:sec-1:done"]);
    expect(deps.agents.custom).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sec-1", name: "Security Reviewer" }),
      expect.stringContaining("Build a todo app"),
      "/tmp/work",
      expect.anything(),
    );
  });

  it("inserts a custom agent step after create_repo, before analyst even starts", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "Repo looks good." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          create_repo: [
            {
              kind: "agent",
              agent: {
                id: "repo-checker",
                name: "Repo Checker",
                instructions: "Sanity-check the new repo.",
                repoAccess: false,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("deployed");
    const createRepoIndex = events.indexOf("create_repo:done");
    const analystIndex = events.indexOf("analyst:running");
    expect(events.slice(createRepoIndex + 1, analystIndex)).toEqual([
      "custom:repo-checker:running",
      "custom:repo-checker:done",
    ]);
  });

  it("clones the repo before running a repoAccess custom agent placed before the developer stage, and only once even though developer would otherwise clone too", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "Looked at the repo." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              kind: "agent",
              agent: {
                id: "repo-agent",
                name: "Repo Reader",
                instructions: "Read the repo.",
                repoAccess: true,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("deployed");
    expect(deps.git.cloneRepo).toHaveBeenCalledTimes(1);
    const cloneOrder = vi.mocked(deps.git.cloneRepo).mock.invocationCallOrder[0];
    const customOrder = vi.mocked(deps.agents.custom).mock.invocationCallOrder[0];
    expect(cloneOrder).toBeLessThan(customOrder);
  });

  it("does not clone the repo for a custom agent without repoAccess placed before the developer stage", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "Just thinking out loud." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              kind: "agent",
              agent: {
                id: "text-agent",
                name: "Brainstormer",
                instructions: "Suggest ideas.",
                repoAccess: false,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
    let cloneCallsAtCustomDone: number | undefined;
    deps.eventBus.onEvent((event) => {
      if (event.stage === "custom:text-agent" && event.status === "done") {
        cloneCallsAtCustomDone = vi.mocked(deps.git.cloneRepo).mock.calls.length;
      }
    });

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("deployed");
    expect(cloneCallsAtCustomDone).toBe(0);
    // developer's own clone-once guard still fires later in the same run.
    expect(deps.git.cloneRepo).toHaveBeenCalledTimes(1);
  });

  it("pauses at a gate and waits for a decision, without committing a tracing pack", async () => {
    const deps = makeDeps();
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [{ kind: "gate", id: "g1" }],
        },
      },
    };

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("stopped");
    if (outcome.status === "stopped") {
      expect(outcome.stage).toBe("gate:g1");
      expect(outcome.resumeState.ctx.gateDecisions).toBeUndefined();
    }
    expect(events).toContain("gate:g1:running");
    expect(events).toContain("gate:g1:stopped");
    expect(deps.github.commitFile).not.toHaveBeenCalled();
  });

  it("continues past a gate once its decision is recorded as approved on resume", async () => {
    const deps = makeDeps();
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [{ kind: "gate", id: "g1" }],
        },
      },
    };
    const stopped = await runOrchestrator(workflowParams, deps);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");
    stopped.resumeState.ctx.gateDecisions = { g1: "approved" };

    const outcome = await runOrchestrator(workflowParams, deps, stopped.resumeState);

    expect(outcome.status).toBe("deployed");
  });

  it("ends the run blocked when a gate's decision is recorded as rejected on resume, and commits the tracing pack", async () => {
    const deps = makeDeps();
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [{ kind: "gate", id: "g1" }],
        },
      },
    };
    const stopped = await runOrchestrator(workflowParams, deps);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");
    stopped.resumeState.ctx.gateDecisions = { g1: "rejected" };

    const outcome = await runOrchestrator(workflowParams, deps, stopped.resumeState);

    expect(outcome).toEqual({ status: "gate_rejected", stage: "gate:g1" });
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(content).toContain("Outcome: **blocked**");
    expect(deps.agents.architect).not.toHaveBeenCalled();
  });

  it("runs a gate and a custom agent placed in the same slot in array order", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "Looks fine." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            { kind: "gate", id: "g1" },
            {
              kind: "agent",
              agent: {
                id: "sec-1",
                name: "Security Reviewer",
                instructions: "Look for auth bypass issues.",
                repoAccess: false,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
    const stopped = await runOrchestrator(workflowParams, deps);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");
    stopped.resumeState.ctx.gateDecisions = { g1: "approved" };
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));
    // onEvent replays existing history to new listeners (for SSE reconnects), so
    // the first run's create_repo/analyst events land here before the resumed
    // run's own events do. Measure from that point, not from index 0.
    const historyLength = events.length;

    const outcome = await runOrchestrator(workflowParams, deps, stopped.resumeState);

    expect(outcome.status).toBe("deployed");
    expect(events.slice(historyLength, historyLength + 4)).toEqual([
      "gate:g1:running",
      "gate:g1:done",
      "custom:sec-1:running",
      "custom:sec-1:done",
    ]);
  });
});

describe("BACKBONE_STEPS / BACKBONE_STAGES invariant", () => {
  it("BACKBONE_STEPS' step names are exactly the splice-eligible BACKBONE_STAGES, in the same order", () => {
    expect(BACKBONE_STEPS.map((step) => step.name)).toEqual(BACKBONE_STAGES);
  });
});
