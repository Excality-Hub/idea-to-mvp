import { describe, expect, it } from "vitest";
import { ABORTABLE_STAGES, isGateEntry, parseGateId } from "./types.js";

describe("ABORTABLE_STAGES", () => {
  it("lists exactly the four LLM-driven agent stages", () => {
    expect(ABORTABLE_STAGES).toEqual(["analyst", "architect", "developer", "qa"]);
  });
});

describe("isGateEntry", () => {
  it("is true for a gate-prefixed id", () => {
    expect(isGateEntry("gate:abc-123")).toBe(true);
  });

  it("is false for a plain agent id", () => {
    expect(isGateEntry("abc-123")).toBe(false);
  });
});

describe("parseGateId", () => {
  it("strips the gate: prefix", () => {
    expect(parseGateId("gate:abc-123")).toBe("abc-123");
  });
});
