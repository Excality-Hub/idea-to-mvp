import { describe, expect, it, vi } from "vitest";
import { AgentStoppedError } from "../claudeAgent.js";
import { RunEventBus } from "./events.js";
import { RunController, type RunControllerConfig } from "./runController.js";
import type { StageName } from "./types.js";

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
  };
  return {
    owner: "org",
    starterDir: "/templates/starter",
    githubToken: "test-token",
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
});
