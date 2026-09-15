import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AgentStoppedError } from "../claudeAgent.js";
import { RunEventBus } from "./events.js";
import { RunController, type RunControllerConfig } from "./runController.js";
import type { WorkflowDefinition, StageName } from "./types.js";
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import type { WorkflowStore } from "./workflowStore.js";
import type { Run, RunStore } from "./runStore.js";
import type { Project, ProjectStore } from "./projectStore.js";

const PROJECT_ID = "proj-1";

function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: () => agents,
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[]): WorkflowStore {
  return {
    list: () => workflows,
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listByProject: (projectId) => workflows.filter((w) => w.projectId === projectId),
  };
}

const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: `${PROJECT_ID}-default`,
  projectId: PROJECT_ID,
  name: "Default",
  slots: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

function waitForStage(bus: RunEventBus, stage: StageName, status: string): Promise<void> {
  return new Promise((resolve) => {
    // `onEvent` replays already-emitted history synchronously before returning, so a matching
    // event can invoke this listener before `unsubscribe` is assigned (e.g. the repo-reuse path,
    // which emits create_repo's "done" event synchronously). Guard with `?.()` for that case.
    let unsubscribe: (() => void) | undefined;
    unsubscribe = bus.onEvent((event) => {
      if (event.stage === stage && event.status === status) {
        unsubscribe?.();
        resolve();
      }
    });
  });
}

function makeRunStore(): RunStore {
  const records = new Map<string, Run>();
  return {
    list: () => Array.from(records.values()),
    get: (id) => records.get(id),
    create: (item) => {
      records.set(item.id, item);
    },
    update: (id, item) => {
      records.set(id, item);
    },
    delete: (id) => {
      records.delete(id);
    },
    appendEvent: (id, event) => {
      const record = records.get(id);
      if (record) records.set(id, { ...record, events: [...record.events, event] });
    },
    listByProject: (projectId) => Array.from(records.values()).filter((r) => r.projectId === projectId),
  };
}

function makeProjectStore(projects: Project[] = []): ProjectStore {
  const records = new Map<string, Project>(projects.map((p) => [p.id, p]));
  return {
    list: () => Array.from(records.values()),
    get: (id) => records.get(id),
    create: (item) => {
      records.set(item.id, item);
    },
    update: (id, item) => {
      records.set(id, item);
    },
    delete: (id) => {
      records.delete(id);
    },
  };
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
    projectId: PROJECT_ID,
    owner: "org",
    starterDir: "/templates/starter",
    githubToken: "test-token",
    agentStore: makeAgentStore(),
    workflowStore: makeWorkflowStore([DEFAULT_WORKFLOW]),
    runStore: makeRunStore(),
    projectStore: makeProjectStore([
      { id: PROJECT_ID, name: "Todo app project", repoName: "todo-app-abc123", createdAt: "2026-01-01T00:00:00.000Z" },
    ]),
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
  it("creates a run record with the idea text, workflow id, and the project's repo name when a run starts", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("Build a todo app");
    const runId = controller.getCurrentRunId();

    expect(runId).toBeDefined();
    const record = config.runStore.get(runId!);
    expect(record?.projectId).toBe(PROJECT_ID);
    expect(record?.ideaText).toBe("Build a todo app");
    expect(record?.workflowId).toBe(DEFAULT_WORKFLOW.id);
    await controller.getRunPromise();
  });

  it("has no current run id before any run starts", () => {
    const controller = new RunController(makeConfig());

    expect(controller.getCurrentRunId()).toBeUndefined();
  });

  it("appends every emitted event to the run record, including across a stop/resume cycle", async () => {
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
    const runId = controller.getCurrentRunId()!;
    await waitForStage(controller.eventBus, "developer", "running");
    controller.stop();
    await controller.getRunPromise();
    controller.resume();
    await controller.getRunPromise();

    const record = config.runStore.get(runId);
    expect(record?.events.length).toBeGreaterThan(0);
    expect(record?.events.some((e) => e.stage === "deploy" && e.status === "done")).toBe(true);
  });

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

  it("throws when starting with another project's workflow id", () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      { id: "other-default", projectId: "other-project", name: "Default", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const controller = new RunController(config);

    expect(() => controller.start("Build a todo app", "other-default")).toThrow("Unknown workflow: other-default");
  });

  it("throws when a workflow references an unknown agent id", () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      { id: "broken", projectId: PROJECT_ID, name: "Broken", slots: { analyst: ["missing-agent"] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const controller = new RunController(config);

    expect(() => controller.start("Build a todo app", "broken")).toThrow("Unknown agent: missing-agent");
  });

  it("does not swap the event bus when a second start() fails validation after a prior run completed", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      { id: "broken", projectId: PROJECT_ID, name: "Broken", slots: { analyst: ["missing-agent"] }, createdAt: "2026-01-01T00:00:00.000Z" },
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
      { id: "with-review", projectId: PROJECT_ID, name: "With security review", slots: { analyst: ["sec-1"] }, createdAt: "2026-01-01T00:00:00.000Z" },
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

  it("pauses at a gate placed via workflow slots, then approves and continues to completion", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      { id: "with-gate", projectId: PROJECT_ID, name: "With a gate", slots: { analyst: ["gate:g1"] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-gate");
    await waitForStage(controller.eventBus, "gate:g1", "stopped");
    const stoppedOutcome = await controller.getRunPromise();

    expect(stoppedOutcome?.status).toBe("stopped");
    expect(controller.getStatus()).toBe("stopped");

    controller.decideGate("g1", "approved");
    const finalOutcome = await controller.getRunPromise();

    expect(finalOutcome?.status).toBe("deployed");
  });

  it("ends the run blocked when a gate is rejected", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      { id: "with-gate", projectId: PROJECT_ID, name: "With a gate", slots: { analyst: ["gate:g1"] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-gate");
    await waitForStage(controller.eventBus, "gate:g1", "stopped");
    await controller.getRunPromise();
    controller.decideGate("g1", "rejected");
    const finalOutcome = await controller.getRunPromise();

    expect(finalOutcome).toEqual({ status: "gate_rejected", stage: "gate:g1" });
    expect(controller.getStatus()).toBe("done");
  });

  it("throws when decideGate is called with no stopped run", () => {
    const controller = new RunController(makeConfig());
    expect(() => controller.decideGate("g1", "approved")).toThrow("No stopped run to decide");
  });

  it("throws when decideGate is called for a gate that isn't the run's current stopped stage", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      { id: "with-gate", projectId: PROJECT_ID, name: "With a gate", slots: { analyst: ["gate:g1"] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-gate");
    await waitForStage(controller.eventBus, "gate:g1", "stopped");
    await controller.getRunPromise();

    expect(() => controller.decideGate("other-gate", "approved")).toThrow(
      "Gate other-gate is not the run's current stopped stage",
    );
  });

  it("keeps two sequential runs' run records distinct, both owned by the same project", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("First idea");
    const firstRunId = controller.getCurrentRunId()!;
    await controller.getRunPromise();

    controller.start("Second idea");
    const secondRunId = controller.getCurrentRunId()!;
    await controller.getRunPromise();

    expect(secondRunId).not.toBe(firstRunId);

    const firstRecord = config.runStore.get(firstRunId)!;
    const secondRecord = config.runStore.get(secondRunId)!;

    expect(firstRecord.projectId).toBe(PROJECT_ID);
    expect(secondRecord.projectId).toBe(PROJECT_ID);
    expect(firstRecord.events.length).toBeGreaterThan(0);
    expect(secondRecord.events.length).toBeGreaterThan(0);
    expect(secondRecord.events).not.toEqual(firstRecord.events);
    expect(firstRecord.ideaText).toBe("First idea");
    expect(secondRecord.ideaText).toBe("Second idea");
  });

  it("uses the project's fixed repoName for every run instead of generating a new one", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("Build a todo app");
    await controller.getRunPromise();

    expect(config.deps.github.createRepoFromStarter).toHaveBeenCalledWith(
      expect.objectContaining({ repoName: "todo-app-abc123" }),
    );
  });

  it("creates the repo on the first run, persists it onto the project, and reuses it on a second run", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("First idea");
    await waitForStage(controller.eventBus, "create_repo", "done");
    await controller.getRunPromise();

    expect(config.deps.github.createRepoFromStarter).toHaveBeenCalledTimes(1);
    const projectAfterFirstRun = config.projectStore.get(PROJECT_ID)!;
    expect(projectAfterFirstRun.repo).toEqual({
      owner: "org",
      htmlUrl: "https://github.com/org/app",
      cloneUrl: "https://github.com/org/app.git",
    });

    controller.start("Second idea");
    const secondRunId = controller.getCurrentRunId()!;
    await waitForStage(controller.eventBus, "create_repo", "done");
    await controller.getRunPromise();

    expect(config.deps.github.createRepoFromStarter).toHaveBeenCalledTimes(1);
    const secondRunRecord = config.runStore.get(secondRunId)!;
    expect(
      secondRunRecord.events.some((e) => e.stage === "create_repo" && e.message === "Reusing existing repo"),
    ).toBe(true);
  });
});
