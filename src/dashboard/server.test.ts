import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../orchestrator/events.js";
import type { RunEvent } from "../orchestrator/types.js";
import { createEventsHandler, createRunHandlers } from "./server.js";

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
