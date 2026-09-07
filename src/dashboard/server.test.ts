import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../orchestrator/events.js";
import type { RunEvent } from "../orchestrator/types.js";
import { createEventsHandler } from "./server.js";

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-06T00:00:00.000Z",
};

function makeFakeRes() {
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
  };
}

describe("createEventsHandler", () => {
  it("streams bus events to the response as SSE data lines", () => {
    const bus = new RunEventBus();
    const handler = createEventsHandler(bus);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    bus.emit(sampleEvent);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(sampleEvent)}\n\n`);
  });

  it("stops writing once the request closes", () => {
    const bus = new RunEventBus();
    const handler = createEventsHandler(bus);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    req.emit("close");
    bus.emit(sampleEvent);

    expect(res.write).not.toHaveBeenCalled();
  });
});
