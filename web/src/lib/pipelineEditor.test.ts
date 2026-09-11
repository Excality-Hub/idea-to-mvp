import { describe, expect, it } from "vitest";
import { applyDragEnd, type SlotsState } from "./pipelineEditor";

const EMPTY: SlotsState = { afterAnalyst: [], afterArchitect: [], afterQa: [] };

describe("applyDragEnd", () => {
  it("appends a palette item to an empty slot", () => {
    const result = applyDragEnd(EMPTY, { type: "palette", agentId: "a" }, { type: "slot", slot: "afterAnalyst" });

    expect(result).toEqual({ afterAnalyst: ["a"], afterArchitect: [], afterQa: [] });
  });

  it("appends a palette item to a non-empty slot, preserving existing order", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(slots, { type: "palette", agentId: "b" }, { type: "slot", slot: "afterAnalyst" });

    expect(result.afterAnalyst).toEqual(["a", "b"]);
  });

  it("does not duplicate a palette item already in the target slot", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(slots, { type: "palette", agentId: "a" }, { type: "slot", slot: "afterAnalyst" });

    expect(result).toBe(slots);
  });

  it("reorders within a slot when dropped on another item in the same slot", () => {
    const slots: SlotsState = { afterAnalyst: ["a", "b", "c"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(
      slots,
      { type: "slot-item", slot: "afterAnalyst", agentId: "a" },
      { type: "slot-item", slot: "afterAnalyst", agentId: "c" },
    );

    expect(result.afterAnalyst).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when a slot item is dropped on a different slot", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: ["b"], afterQa: [] };

    const result = applyDragEnd(
      slots,
      { type: "slot-item", slot: "afterAnalyst", agentId: "a" },
      { type: "slot", slot: "afterArchitect" },
    );

    expect(result).toBe(slots);
  });

  it("is a no-op when dropped on the slot's own empty space rather than another item", () => {
    const slots: SlotsState = { afterAnalyst: ["a", "b"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(
      slots,
      { type: "slot-item", slot: "afterAnalyst", agentId: "a" },
      { type: "slot", slot: "afterAnalyst" },
    );

    expect(result).toBe(slots);
  });

  it("is a no-op when there is no drop target", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(slots, { type: "palette", agentId: "b" }, undefined);

    expect(result).toBe(slots);
  });
});
