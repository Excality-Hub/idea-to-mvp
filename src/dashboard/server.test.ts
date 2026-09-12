import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../orchestrator/events.js";
import type { RunEvent } from "../orchestrator/types.js";
import { createEventsHandler, createRunHandlers } from "./server.js";
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import type { WorkflowDefinition } from "../orchestrator/types.js";
import type { WorkflowStore } from "../orchestrator/workflowStore.js";
import { createAgentHandlers, createWorkflowHandlers } from "./server.js";

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

describe("createEventsHandler", () => {
  it("streams the session's bus events to the response as SSE data lines", () => {
    const bus = new RunEventBus();
    const session = { eventBus: bus, onBusReplaced: () => () => {} };
    const handler = createEventsHandler(session);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    bus.emit(sampleEvent);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(sampleEvent)}\n\n`);
  });

  it("stops writing once the request closes", () => {
    const bus = new RunEventBus();
    const session = { eventBus: bus, onBusReplaced: () => () => {} };
    const handler = createEventsHandler(session);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    req.emit("close");
    bus.emit(sampleEvent);

    expect(res.write).not.toHaveBeenCalled();
  });

  it("ends open connections when the session's event bus is replaced", () => {
    let busReplacedListener: (() => void) | undefined;
    const session = {
      eventBus: new RunEventBus(),
      onBusReplaced: (listener: () => void) => {
        busReplacedListener = listener;
        return () => {};
      },
    };
    const handler = createEventsHandler(session);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    busReplacedListener?.();

    expect(res.end).toHaveBeenCalled();
  });
});

describe("createRunHandlers", () => {
  it("starts a run with the request body's ideaText and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: { ideaText: "Build a todo app" } } as never, res as never, (() => {}) as never);

    expect(controller.start).toHaveBeenCalledWith("Build a todo app");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 400 when ideaText is missing", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: {} } as never, res as never, (() => {}) as never);

    expect(controller.start).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 409 when starting while a run is already active", () => {
    const controller = {
      start: vi.fn(() => {
        throw new Error("A run is already active");
      }),
      stop: vi.fn(),
      resume: vi.fn(),
    };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: { ideaText: "x" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("stops the current run and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { stop } = createRunHandlers(controller);
    const res = makeFakeRes();

    stop({} as never, res as never, (() => {}) as never);

    expect(controller.stop).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 409 when stop() finds nothing abortable running", () => {
    const controller = {
      start: vi.fn(),
      stop: vi.fn(() => {
        throw new Error("No abortable stage is currently running");
      }),
      resume: vi.fn(),
    };
    const { stop } = createRunHandlers(controller);
    const res = makeFakeRes();

    stop({} as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("resumes a stopped run and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { resume } = createRunHandlers(controller);
    const res = makeFakeRes();

    resume({} as never, res as never, (() => {}) as never);

    expect(controller.resume).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: vi.fn(() => agents),
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn((item) => agents.push(item)),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[] = []): WorkflowStore {
  return {
    list: vi.fn(() => workflows),
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn((item) => workflows.push(item)),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("createAgentHandlers", () => {
  it("lists agents", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { list } = createAgentHandlers(agentStore, makeWorkflowStore());
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(agentStore.list());
  });

  it("creates an agent from a valid body and returns 201", () => {
    const agentStore = makeAgentStore();
    const { create } = createAgentHandlers(agentStore, makeWorkflowStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Security Reviewer", instructions: "check for bugs", repoAccess: true } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(agentStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Security Reviewer", instructions: "check for bugs", repoAccess: true }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when the create body is invalid", () => {
    const { create } = createAgentHandlers(makeAgentStore(), makeWorkflowStore());
    const res = makeFakeRes();

    create({ body: { name: "" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes an agent not referenced by any workflow", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { remove } = createAgentHandlers(agentStore, makeWorkflowStore([]));
    const res = makeFakeRes();

    remove({ params: { id: "a" } } as never, res as never, (() => {}) as never);

    expect(agentStore.delete).toHaveBeenCalledWith("a");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 409 when deleting an agent referenced by a workflow", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore([
      { id: "w1", name: "W1", slots: { analyst: ["a"] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { remove } = createAgentHandlers(agentStore, workflowStore);
    const res = makeFakeRes();

    remove({ params: { id: "a" } } as never, res as never, (() => {}) as never);

    expect(agentStore.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("createWorkflowHandlers", () => {
  it("lists workflows", () => {
    const workflowStore = makeWorkflowStore([
      { id: "default", name: "Default", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { list } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(workflowStore.list());
  });

  it("creates a workflow referencing only existing agents, and returns 201", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    create(
      { body: { name: "With A", slots: { analyst: ["a"] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "With A", slots: { analyst: ["a"] } }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when a slot references an unknown agent id", () => {
    const { create } = createWorkflowHandlers(makeWorkflowStore(), makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Bad", slots: { analyst: ["missing"] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when the same agent id appears in more than one slot", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    create(
      { body: { name: "Dup", slots: { analyst: ["a"], architect: ["a"] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates a workflow with a custom agent after a stage outside the old fixed three", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    create(
      { body: { name: "After repo creation", slots: { create_repo: ["a"] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "After repo creation", slots: { create_repo: ["a"] } }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when a slot key isn't one of the fixed backbone stages", () => {
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Bad stage", slots: { not_a_stage: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when the slot key is tracing_pack, since nothing can run after the pipeline's final step", () => {
    const { create } = createWorkflowHandlers(makeWorkflowStore(), makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Bad", slots: { tracing_pack: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects deleting the default workflow with 400", () => {
    const workflowStore = makeWorkflowStore();
    const { remove } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    remove({ params: { id: "default" } } as never, res as never, (() => {}) as never);

    expect(workflowStore.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes a non-default workflow and returns 204", () => {
    const workflowStore = makeWorkflowStore();
    const { remove } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    remove({ params: { id: "with-review" } } as never, res as never, (() => {}) as never);

    expect(workflowStore.delete).toHaveBeenCalledWith("with-review");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("updates a non-default workflow and returns 200", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const existing = {
      id: "w1",
      name: "Old",
      slots: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const workflowStore = makeWorkflowStore([existing]);
    const { update } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    update(
      {
        params: { id: "w1" },
        body: { name: "New", slots: { analyst: ["a"] } },
      } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({
        id: "w1",
        name: "New",
        slots: { analyst: ["a"] },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects editing the default workflow with 400", () => {
    const workflowStore = makeWorkflowStore();
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update(
      { params: { id: "default" }, body: { name: "X", slots: {} } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the workflow id doesn't exist", () => {
    const workflowStore = makeWorkflowStore([]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update(
      { params: { id: "missing" }, body: { name: "X", slots: {} } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when the updated slots reference an unknown agent id", () => {
    const existing = {
      id: "w1",
      name: "Old",
      slots: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const workflowStore = makeWorkflowStore([existing]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update(
      {
        params: { id: "w1" },
        body: { name: "New", slots: { analyst: ["missing"] } },
      } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("createRunHandlers with a workflowId", () => {
  it("starts a run with the given workflowId when provided", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: { ideaText: "Build a todo app", workflowId: "with-review" } } as never, res as never, (() => {}) as never);

    expect(controller.start).toHaveBeenCalledWith("Build a todo app", "with-review");
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
