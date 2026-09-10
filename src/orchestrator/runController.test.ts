import { describe, expect, it, vi } from "vitest";
import { AgentStoppedError } from "../claudeAgent.js";
import { RunEventBus } from "./events.js";
import { RunController, type RunControllerConfig } from "./runController.js";
import type { WorkflowDefinition, StageName } from "./types.js";
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import type { WorkflowStore } from "./workflowStore.js";

function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: () => agents,
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[]): WorkflowStore {
  return {
    list: () => workflows,
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function waitForStage(bus: RunEventBus, stage: StageName, status: string): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = bus.onEvent((event) => {
      if (event.stage === stage && event.status === status) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function makeConfig(): RunControllerConfig {
  const github = {
    createRepoFromStarter: vi.fn().mockResolvedValue({
      owner: "org",
      repo: "app",
      htmlUrl: "https://github.com/org/app",
      cloneUrl: "https://github.com/org/app.git",
    }),
    createIssue: vi.fn().mockResolvedValue({ number: 1 }),
    createPullRequest: vi.fn().mockResolvedValue({ number: 2, htmlUrl: "https://github.com/org/app/pull/2" }),
    postPrComment: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    commitFile: vi.fn().mockResolvedValue({ sha: "sha" }),
  };
  const deploy = {
    label: "Render",
    deploy: vi.fn().mockResolvedValue({ url: "https://app.onrender.com" }),
  };
  const git = {
    cloneRepo: vi.fn().mockResolvedValue(undefined),
    createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
    resetWorkingTree: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    diffAgainstBase: vi.fn().mockResolvedValue("diff --git a/server.js b/server.js"),
  };
  const usage = {
    inputTokens: 10,
    outputTokens: 5,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0.001,
  };
  const agents = {
    analyst: vi.fn().mockResolvedValue({
      output: { summary: "s", goals: [], keyFeatures: [], nonGoals: [], openQuestions: [] },
      usage,
    }),
    architect: vi.fn().mockResolvedValue({
      output: { issueTitle: "t", issueBody: "b", branchName: "feature/x" },
      usage,
    }),
    developer: vi.fn().mockResolvedValue({ output: { prTitle: "t", prBody: "b" }, usage }),
    qa: vi.fn().mockResolvedValue({ output: { verdict: "pass", findings: [] }, usage }),
    custom: vi.fn(),
  };
  return {
    owner: "org",
    starterDir: "/templates/starter",
    githubToken: "test-token",
    agentStore: makeAgentStore(),
    workflowStore: makeWorkflowStore([DEFAULT_WORKFLOW]),
    deps: {
      github: github as never,
      deploy: deploy as never,
      git: git as never,
      agents: agents as never,
      readStarterFiles: vi.fn().mockReturnValue([{ path: "package.json", content: "{}" }]),
    },
  };
}

describe("RunController", () => {
  it("starts a run and completes it", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("Build a todo app");
    const outcome = await controller.getRunPromise();

    expect(outcome?.status).toBe("deployed");
    expect(controller.getStatus()).toBe("done");
  });

  it("throws when starting while a run is already active", () => {
    const controller = new RunController(makeConfig());
    controller.start("Build a todo app");

    expect(() => controller.start("Another idea")).toThrow("A run is already active");
  });

  it("throws when stop() is called with no abortable stage running", () => {
    const controller = new RunController(makeConfig());
    expect(() => controller.stop()).toThrow("No abortable stage is currently running");
  });

  it("throws when resume() is called with no stopped run", () => {
    const controller = new RunController(makeConfig());
    expect(() => controller.resume()).toThrow("No stopped run to resume");
  });

  it("stops the run when the developer agent is in flight, and resumes it to completion", async () => {
    const config = makeConfig();
    let firstAttempt = true;
    vi.mocked(config.deps.agents.developer).mockImplementation(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) => {
        if (!firstAttempt) {
          return Promise.resolve({
            output: { prTitle: "t", prBody: "b" },
            usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.001 },
          });
        }
        firstAttempt = false;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        });
      },
    );
    const controller = new RunController(config);

    controller.start("Build a todo app");
    await waitForStage(controller.eventBus, "developer", "running");
    controller.stop();
    const stoppedOutcome = await controller.getRunPromise();

    expect(stoppedOutcome?.status).toBe("stopped");
    expect(controller.getStatus()).toBe("stopped");

    controller.resume();
    const finalOutcome = await controller.getRunPromise();

    expect(finalOutcome?.status).toBe("deployed");
    expect(config.deps.github.mergePullRequest).toHaveBeenCalled();
  });

  it("gives a fresh event bus to a second run and notifies onBusReplaced", async () => {
    const config = makeConfig();
    const controller = new RunController(config);
    const busReplaced = vi.fn();
    controller.onBusReplaced(busReplaced);

    controller.start("First idea");
    const firstBus = controller.eventBus;
    await controller.getRunPromise();
    expect(busReplaced).not.toHaveBeenCalled();

    controller.start("Second idea");
    expect(controller.eventBus).not.toBe(firstBus);
    expect(busReplaced).toHaveBeenCalledTimes(1);
    await controller.getRunPromise();
  });

  it("throws when starting with an unknown workflow id", () => {
    const controller = new RunController(makeConfig());

    expect(() => controller.start("Build a todo app", "nope")).toThrow("Unknown workflow: nope");
  });

  it("throws when a workflow references an unknown agent id", () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "broken",
        name: "Broken",
        slots: { afterAnalyst: ["missing-agent"], afterArchitect: [], afterQa: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const controller = new RunController(config);

    expect(() => controller.start("Build a todo app", "broken")).toThrow("Unknown agent: missing-agent");
  });

  it("does not swap the event bus when a second start() fails validation after a prior run completed", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "broken",
        name: "Broken",
        slots: { afterAnalyst: ["missing-agent"], afterArchitect: [], afterQa: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app");
    await controller.getRunPromise();
    expect(controller.getStatus()).toBe("done");

    const busBeforeSecondStart = controller.eventBus;
    expect(() => controller.start("Build a todo app", "broken")).toThrow("Unknown agent: missing-agent");
    expect(controller.eventBus).toBe(busBeforeSecondStart);
  });

  it("exposes the resolved stage order via getPlan()", async () => {
    const controller = new RunController(makeConfig());

    controller.start("Build a todo app");
    await controller.getRunPromise();

    expect(controller.getPlan()).toEqual([
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
    ]);
  });

  it("runs a custom agent inserted by a non-default workflow", async () => {
    const config = makeConfig();
    const securityReviewer: AgentDefinition = {
      id: "sec-1",
      name: "Security Reviewer",
      instructions: "Look for auth bypass issues.",
      repoAccess: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    config.agentStore = makeAgentStore([securityReviewer]);
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "with-review",
        name: "With security review",
        slots: { afterAnalyst: ["sec-1"], afterArchitect: [], afterQa: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(config.deps.agents.custom).mockResolvedValue({
      output: { text: "No issues found." },
      usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.001 },
    });
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-review");
    const outcome = await controller.getRunPromise();

    expect(outcome?.status).toBe("deployed");
    expect(controller.getPlan()).toContain("custom:sec-1");
    expect(config.deps.agents.custom).toHaveBeenCalled();
  });
});
