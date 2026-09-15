import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../orchestrator/events.js";
import type { RunEvent } from "../orchestrator/types.js";
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import type { WorkflowDefinition } from "../orchestrator/types.js";
import type { WorkflowStore } from "../orchestrator/workflowStore.js";
import type { Project, ProjectStore } from "../orchestrator/projectStore.js";
import type { Run, RunStore } from "../orchestrator/runStore.js";
import type { RunController } from "../orchestrator/runController.js";
import type { RunControllerRegistry } from "../orchestrator/runControllerRegistry.js";
import {
  createAgentHandlers,
  createEventsHandler,
  createProjectHandlers,
  createRequireProjectMiddleware,
  createRunHandlers,
  createRunsHandlers,
  createWorkflowHandlers,
} from "./server.js";

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-06T00:00:00.000Z",
};

function makeFakeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    json: vi.fn(),
  };
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

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

function makeProjectStore(projects: Project[] = []): ProjectStore {
  const records = new Map(projects.map((p) => [p.id, p]));
  return {
    list: () => Array.from(records.values()),
    get: (id) => records.get(id),
    create: vi.fn((item: Project) => records.set(item.id, item)),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function makeRunStore(runs: Run[] = []): RunStore {
  return {
    list: () => runs,
    get: (id) => runs.find((r) => r.id === id),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    appendEvent: vi.fn(),
    listByProject: (projectId) => runs.filter((r) => r.projectId === projectId),
  };
}

function makeRegistry(controller: Partial<RunController>): Pick<RunControllerRegistry, "get"> {
  return { get: vi.fn().mockReturnValue(controller) };
}

describe("createEventsHandler", () => {
  it("streams the resolved project's bus events to the response as SSE data lines", () => {
    const bus = new RunEventBus();
    const controller = { eventBus: bus, onBusReplaced: () => () => {} };
    const registry = makeRegistry(controller);
    const handler = createEventsHandler(registry);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler({ params: { projectId: "p1" }, on: req.on.bind(req) } as never, res as never, (() => {}) as never);
    bus.emit(sampleEvent);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(sampleEvent)}\n\n`);
    expect(registry.get).toHaveBeenCalledWith("p1");
  });

  it("stops writing once the request closes", () => {
    const bus = new RunEventBus();
    const controller = { eventBus: bus, onBusReplaced: () => () => {} };
    const registry = makeRegistry(controller);
    const handler = createEventsHandler(registry);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler({ params: { projectId: "p1" }, on: req.on.bind(req) } as never, res as never, (() => {}) as never);
    req.emit("close");
    bus.emit(sampleEvent);

    expect(res.write).not.toHaveBeenCalled();
  });

  it("ends the response when the controller's bus is replaced", () => {
    const bus = new RunEventBus();
    let replacedListener: (() => void) | undefined;
    const controller = {
      eventBus: bus,
      onBusReplaced: (listener: () => void) => {
        replacedListener = listener;
        return () => {};
      },
    };
    const registry = makeRegistry(controller);
    const handler = createEventsHandler(registry);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler({ params: { projectId: "p1" }, on: req.on.bind(req) } as never, res as never, (() => {}) as never);
    replacedListener?.();

    expect(res.end).toHaveBeenCalled();
  });
});

describe("createRunHandlers", () => {
  it("starts a run on the resolved project's controller", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn(), decideGate: vi.fn(), getPlan: vi.fn() };
    const registry = makeRegistry(controller);
    const { start } = createRunHandlers(registry);
    const res = makeFakeRes();

    start({ params: { projectId: "p1" }, body: { ideaText: "Build a todo app" } } as never, res as never, (() => {}) as never);

    expect(registry.get).toHaveBeenCalledWith("p1");
    expect(controller.start).toHaveBeenCalledWith("Build a todo app");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("starts a run with the given workflowId when provided", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn(), decideGate: vi.fn(), getPlan: vi.fn() };
    const registry = makeRegistry(controller);
    const { start } = createRunHandlers(registry);
    const res = makeFakeRes();

    start(
      { params: { projectId: "p1" }, body: { ideaText: "Build a todo app", workflowId: "with-review" } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(controller.start).toHaveBeenCalledWith("Build a todo app", "with-review");
  });

  it("400s when ideaText is missing", () => {
    const registry = makeRegistry({ start: vi.fn() });
    const { start } = createRunHandlers(registry);
    const res = makeFakeRes();

    start({ params: { projectId: "p1" }, body: {} } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("409s when the controller throws (e.g. a run is already active)", () => {
    const controller = { start: vi.fn(() => { throw new Error("A run is already active"); }) };
    const registry = makeRegistry(controller);
    const { start } = createRunHandlers(registry);
    const res = makeFakeRes();

    start({ params: { projectId: "p1" }, body: { ideaText: "x" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "A run is already active" });
  });

  it("resolves the gate id and decision through the registry's controller", () => {
    const controller = { decideGate: vi.fn() };
    const registry = makeRegistry(controller);
    const { approveGate, rejectGate } = createRunHandlers(registry);
    const res = makeFakeRes();

    approveGate({ params: { projectId: "p1", gateId: "g1" } } as never, res as never, (() => {}) as never);
    rejectGate({ params: { projectId: "p1", gateId: "g2" } } as never, res as never, (() => {}) as never);

    expect(controller.decideGate).toHaveBeenCalledWith("g1", "approved");
    expect(controller.decideGate).toHaveBeenCalledWith("g2", "rejected");
  });

  it("returns the resolved project's plan", () => {
    const controller = { getPlan: vi.fn().mockReturnValue(["create_repo", "analyst"]) };
    const registry = makeRegistry(controller);
    const { plan } = createRunHandlers(registry);
    const res = makeFakeRes();

    plan({ params: { projectId: "p1" } } as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(["create_repo", "analyst"]);
  });
});

describe("createAgentHandlers", () => {
  it("lists all agents, unscoped by project", () => {
    const agent: AgentDefinition = { id: "a1", name: "A", instructions: "x", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
    const { list } = createAgentHandlers(makeAgentStore([agent]), makeWorkflowStore([]));
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith([agent]);
  });
});

describe("createWorkflowHandlers", () => {
  const defaultWorkflow: WorkflowDefinition = { id: "p1-default", projectId: "p1", name: "Default", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };

  it("lists only the given project's workflows", () => {
    const other: WorkflowDefinition = { id: "p2-default", projectId: "p2", name: "Default", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };
    const { list } = createWorkflowHandlers(makeWorkflowStore([defaultWorkflow, other]), makeAgentStore());
    const res = makeFakeRes();

    list({ params: { projectId: "p1" } } as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith([defaultWorkflow]);
  });

  it("creates a workflow owned by the project in the URL", () => {
    const workflowStore = makeWorkflowStore([defaultWorkflow]);
    const { create } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    create({ params: { projectId: "p1" }, body: { name: "With review", slots: {} } } as never, res as never, (() => {}) as never);

    expect(workflowStore.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", name: "With review" }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("400s when a workflow references an unknown agent id", () => {
    const workflowStore = makeWorkflowStore([defaultWorkflow]);
    const { create } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    create({ params: { projectId: "p1" }, body: { name: "Broken", slots: { analyst: ["missing"] } } } as never, res as never, (() => {}) as never);

    expect(workflowStore.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates a workflow whose slots contain a gate entry, without requiring it to resolve to an agent", () => {
    const workflowStore = makeWorkflowStore([defaultWorkflow]);
    const { create } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    create({ params: { projectId: "p1" }, body: { name: "With a gate", slots: { analyst: ["gate:g1"] } } } as never, res as never, (() => {}) as never);

    expect(workflowStore.create).toHaveBeenCalledWith(expect.objectContaining({ slots: { analyst: ["gate:g1"] } }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("404s updating an unknown workflow id", () => {
    const workflowStore = makeWorkflowStore([defaultWorkflow]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update({ params: { projectId: "p1", workflowId: "nope" }, body: { name: "New", slots: {} } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s updating a workflow that belongs to a different project", () => {
    const other: WorkflowDefinition = { id: "w-other", projectId: "p2", name: "Other", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };
    const workflowStore = makeWorkflowStore([defaultWorkflow, other]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update({ params: { projectId: "p1", workflowId: "w-other" }, body: { name: "New", slots: {} } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("400s updating the project's default workflow", () => {
    const workflowStore = makeWorkflowStore([defaultWorkflow]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update({ params: { projectId: "p1", workflowId: "p1-default" }, body: { name: "New", slots: {} } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Cannot edit the default workflow" });
  });

  it("updates a non-default workflow belonging to the project", () => {
    const custom: WorkflowDefinition = { id: "w1", projectId: "p1", name: "Custom", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };
    const workflowStore = makeWorkflowStore([defaultWorkflow, custom]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update({ params: { projectId: "p1", workflowId: "w1" }, body: { name: "Renamed", slots: {} } } as never, res as never, (() => {}) as never);

    expect(workflowStore.update).toHaveBeenCalledWith("w1", expect.objectContaining({ name: "Renamed" }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("400s deleting the project's default workflow", () => {
    const workflowStore = makeWorkflowStore([defaultWorkflow]);
    const { remove } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    remove({ params: { projectId: "p1", workflowId: "p1-default" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes a non-default workflow belonging to the project", () => {
    const custom: WorkflowDefinition = { id: "w1", projectId: "p1", name: "Custom", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };
    const workflowStore = makeWorkflowStore([defaultWorkflow, custom]);
    const { remove } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    remove({ params: { projectId: "p1", workflowId: "w1" } } as never, res as never, (() => {}) as never);

    expect(workflowStore.delete).toHaveBeenCalledWith("w1");
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe("createRequireProjectMiddleware", () => {
  it("404s when the project doesn't exist", () => {
    const middleware = createRequireProjectMiddleware(makeProjectStore([]));
    const res = makeFakeRes();
    const next = vi.fn();

    middleware({ params: { projectId: "nope" } } as never, res as never, next as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the project exists", () => {
    const project: Project = { id: "p1", name: "P1", repoName: "p1-repo", createdAt: "2026-01-01T00:00:00.000Z" };
    const middleware = createRequireProjectMiddleware(makeProjectStore([project]));
    const res = makeFakeRes();
    const next = vi.fn();

    middleware({ params: { projectId: "p1" } } as never, res as never, next as never);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("createProjectHandlers", () => {
  const older: Project = { id: "p-older", name: "Blog", repoName: "blog-1", createdAt: "2026-09-13T00:00:00.000Z" };
  const newer: Project = { id: "p-newer", name: "Todo app", repoName: "todo-app-1", createdAt: "2026-09-14T00:00:00.000Z" };

  it("lists projects newest-first", () => {
    const { list } = createProjectHandlers(makeProjectStore([older, newer]), { create: vi.fn() });
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith([newer, older]);
  });

  it("gets a single project", () => {
    const { get } = createProjectHandlers(makeProjectStore([older]), { create: vi.fn() });
    const res = makeFakeRes();

    get({ params: { projectId: "p-older" } } as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(older);
  });

  it("404s for an unknown project id", () => {
    const { get } = createProjectHandlers(makeProjectStore([]), { create: vi.fn() });
    const res = makeFakeRes();

    get({ params: { projectId: "nope" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("creates a project with a generated repoName and seeds its default workflow", () => {
    const projectStore = makeProjectStore([]);
    const workflowStore = { create: vi.fn() };
    const { create } = createProjectHandlers(projectStore, workflowStore);
    const res = makeFakeRes();

    create({ body: { name: "My Todo App" } } as never, res as never, (() => {}) as never);

    expect(projectStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Todo App", repoName: expect.stringMatching(/^my-todo-app-[0-9a-f]{8}$/) }),
    );
    expect(workflowStore.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Default" }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("400s creating a project with a blank name", () => {
    const { create } = createProjectHandlers(makeProjectStore([]), { create: vi.fn() });
    const res = makeFakeRes();

    create({ body: { name: "" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("createRunsHandlers", () => {
  const run: Run = {
    id: "r1",
    projectId: "p1",
    ideaText: "Build a todo app",
    workflowId: "p1-default",
    createdAt: "2026-09-14T00:00:00.000Z",
    events: [sampleEvent],
  };
  const otherRun: Run = { ...run, id: "r2", projectId: "p1", ideaText: "Build a blog", createdAt: "2026-09-13T00:00:00.000Z" };

  it("lists run summaries for the project, newest first, without events", () => {
    const { list } = createRunsHandlers(makeRunStore([otherRun, run]));
    const res = makeFakeRes();

    list({ params: { projectId: "p1" } } as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith([
      { id: "r1", projectId: "p1", ideaText: "Build a todo app", workflowId: "p1-default", createdAt: "2026-09-14T00:00:00.000Z" },
      { id: "r2", projectId: "p1", ideaText: "Build a blog", workflowId: "p1-default", createdAt: "2026-09-13T00:00:00.000Z" },
    ]);
  });

  it("gets a single run including its events", () => {
    const { get } = createRunsHandlers(makeRunStore([run]));
    const res = makeFakeRes();

    get({ params: { projectId: "p1", runId: "r1" } } as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(run);
  });

  it("404s getting a run that belongs to a different project", () => {
    const { get } = createRunsHandlers(makeRunStore([run]));
    const res = makeFakeRes();

    get({ params: { projectId: "p2", runId: "r1" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s getting an unknown run id", () => {
    const { get } = createRunsHandlers(makeRunStore([]));
    const res = makeFakeRes();

    get({ params: { projectId: "p1", runId: "nope" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
