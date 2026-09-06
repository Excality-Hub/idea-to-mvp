import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "./events.js";
import type { RunEvent } from "./types.js";

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-06T00:00:00.000Z",
};

describe("RunEventBus", () => {
  it("delivers emitted events to a subscribed listener", () => {
    const bus = new RunEventBus();
    const listener = vi.fn();
    bus.onEvent(listener);

    bus.emit(sampleEvent);

    expect(listener).toHaveBeenCalledWith(sampleEvent);
  });

  it("delivers events to multiple listeners", () => {
    const bus = new RunEventBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    bus.onEvent(listenerA);
    bus.onEvent(listenerB);

    bus.emit(sampleEvent);

    expect(listenerA).toHaveBeenCalledWith(sampleEvent);
    expect(listenerB).toHaveBeenCalledWith(sampleEvent);
  });

  it("stops delivering events after unsubscribe", () => {
    const bus = new RunEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.onEvent(listener);

    unsubscribe();
    bus.emit(sampleEvent);

    expect(listener).not.toHaveBeenCalled();
  });
});
