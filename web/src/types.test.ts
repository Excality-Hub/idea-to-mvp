import { describe, expect, it } from "vitest";
import { GATE_ID_PREFIX, isGateEntry, isGateStage, parseGateId } from "./types";

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
    expect(parseGateId(`${GATE_ID_PREFIX}abc-123`)).toBe("abc-123");
  });
});

describe("isGateStage", () => {
  it("is true for a gate stage name", () => {
    expect(isGateStage("gate:abc-123")).toBe(true);
  });

  it("is false for a backbone or custom stage name", () => {
    expect(isGateStage("analyst")).toBe(false);
    expect(isGateStage("custom:abc-123")).toBe(false);
  });
});
