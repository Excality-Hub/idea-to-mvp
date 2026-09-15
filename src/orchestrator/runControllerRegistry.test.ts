import { describe, expect, it, vi } from "vitest";
import { RunControllerRegistry } from "./runControllerRegistry.js";
import { RunController } from "./runController.js";
import type { WorkflowStore } from "./workflowStore.js";
import type { Run, RunStore } from "./runStore.js";
import type { Project, ProjectStore } from "./projectStore.js";

describe("RunControllerRegistry", () => {
  it("lazily creates one controller per project id, reusing it on subsequent lookups", () => {
    const factory = vi.fn((projectId: string) => ({ projectId }) as unknown as RunController);
    const registry = new RunControllerRegistry(factory);

    const first = registry.get("p1");
    const second = registry.get("p1");

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("p1");
  });

  it("gives each project id its own independent controller", () => {
    const factory = vi.fn((projectId: string) => ({ projectId }) as unknown as RunController);
    const registry = new RunControllerRegistry(factory);

    const forP1 = registry.get("p1");
    const forP2 = registry.get("p2");

    expect(forP1).not.toBe(forP2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("lets two different projects each run concurrently, independent of one another", async () => {
    function makeRunController(projectId: string): RunController {
      const workflow = {
        id: `${projectId}-default`,
        projectId,
        name: "Default",
        slots: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const workflowStore: WorkflowStore = {
        list: () => [workflow],
        get: (id) => (id === workflow.id ? workflow : undefined),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        listByProject: (pid) => (pid === projectId ? [workflow] : []),
      };
      const project: Project = { id: projectId, name: projectId, repoName: `${projectId}-repo`, createdAt: "2026-01-01T00:00:00.000Z" };
      const projects = new Map<string, Project>([[projectId, project]]);
      const projectStore: ProjectStore = {
        list: () => Array.from(projects.values()),
        get: (id) => projects.get(id),
        create: vi.fn(),
        update: (id, item) => {
          projects.set(id, item);
        },
        delete: vi.fn(),
      };
      const runs = new Map<string, Run>();
      const runStore: RunStore = {
        list: () => Array.from(runs.values()),
        get: (id) => runs.get(id),
        create: (item) => {
          runs.set(item.id, item);
        },
        update: (id, item) => {
          runs.set(id, item);
        },
        delete: vi.fn(),
        appendEvent: (id, event) => {
          const record = runs.get(id);
          if (record) runs.set(id, { ...record, events: [...record.events, event] });
        },
        listByProject: (pid) => Array.from(runs.values()).filter((r) => r.projectId === pid),
      };
      const usage = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 };
      return new RunController({
        projectId,
        owner: "org",
        starterDir: "/templates/starter",
        githubToken: "token",
        agentStore: { list: () => [], get: () => undefined, create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        workflowStore,
        runStore,
        projectStore,
        deps: {
          github: {
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
            commitFile: vi.fn().mockResolvedValue({ sha: "s" }),
          } as never,
          deploy: { label: "Render", deploy: vi.fn().mockResolvedValue({ url: "https://app.onrender.com" }) } as never,
          git: {
            cloneRepo: vi.fn().mockResolvedValue(undefined),
            createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
            resetWorkingTree: vi.fn().mockResolvedValue(undefined),
            pushBranch: vi.fn().mockResolvedValue(undefined),
            diffAgainstBase: vi.fn().mockResolvedValue("diff"),
          } as never,
          agents: {
            analyst: vi.fn().mockResolvedValue({ output: { summary: "s", goals: [], keyFeatures: [], nonGoals: [], openQuestions: [] }, usage }),
            architect: vi.fn().mockResolvedValue({ output: { issueTitle: "t", issueBody: "b", branchName: "feature/x" }, usage }),
            developer: vi.fn().mockResolvedValue({ output: { prTitle: "t", prBody: "b" }, usage }),
            qa: vi.fn().mockResolvedValue({ output: { verdict: "pass", findings: [] }, usage }),
            custom: vi.fn(),
          } as never,
          readStarterFiles: vi.fn().mockReturnValue([{ path: "package.json", content: "{}" }]),
        },
      });
    }

    const registry = new RunControllerRegistry(makeRunController);

    const p1Controller = registry.get("p1");
    const p2Controller = registry.get("p2");
    p1Controller.start("Idea for p1");
    p2Controller.start("Idea for p2");

    expect(p1Controller.getStatus()).toBe("running");
    expect(p2Controller.getStatus()).toBe("running");
    expect(() => registry.get("p1").start("Another idea for p1")).toThrow("A run is already active");

    await p1Controller.getRunPromise();
    await p2Controller.getRunPromise();

    expect(p1Controller.getStatus()).toBe("done");
    expect(p2Controller.getStatus()).toBe("done");
  });
});
