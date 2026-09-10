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
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[] = []): WorkflowStore {
  return {
    list: vi.fn(() => workflows),
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn((item) => workflows.push(item)),
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
      { id: "w1", name: "W1", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
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
      { id: "default", name: "Default", slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
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
      { body: { name: "With A", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "With A", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] } }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when a slot references an unknown agent id", () => {
    const { create } = createWorkflowHandlers(makeWorkflowStore(), makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Bad", slots: { afterAnalyst: ["missing"], afterArchitect: [], afterQa: [] } } } as never,
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
