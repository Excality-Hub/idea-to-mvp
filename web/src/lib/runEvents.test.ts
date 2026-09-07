import { describe, expect, it } from "vitest";
import {
  deriveOverallStatus,
  deriveStageStatus,
  groupEventsByStage,
} from "./runEvents";
import type { RunEvent } from "../types";

function event(overrides: Partial<RunEvent>): RunEvent {
  return {
    stage: "analyst",
    status: "running",
    message: "",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupEventsByStage", () => {
  it("returns an empty object for no events", () => {
    expect(groupEventsByStage([])).toEqual({});
  });

  it("groups events under their stage, preserving arrival order", () => {
    const events = [
      event({ stage: "analyst", status: "running", message: "start" }),
      event({ stage: "architect", status: "running", message: "start" }),
      event({ stage: "analyst", status: "done", message: "done" }),
    ];

    const grouped = groupEventsByStage(events);

    expect(grouped.analyst?.map((e) => e.message)).toEqual(["start", "done"]);
    expect(grouped.architect?.map((e) => e.message)).toEqual(["start"]);
  });
});

describe("deriveStageStatus", () => {
  it("is pending when there are no events for the stage", () => {
    expect(deriveStageStatus(undefined)).toBe("pending");
    expect(deriveStageStatus([])).toBe("pending");
  });

  it("is the status of the most recent event", () => {
    const events = [
      event({ status: "running" }),
      event({ status: "done" }),
    ];
    expect(deriveStageStatus(events)).toBe("done");
  });
});

describe("deriveOverallStatus", () => {
  it("is idle when there are no events", () => {
    expect(deriveOverallStatus({})).toBe("idle");
  });

  it("is running while stages are in progress", () => {
    expect(
      deriveOverallStatus({
        analyst: [event({ stage: "analyst", status: "running" })],
      }),
    ).toBe("running");
  });

  it("is failed if any stage failed, even if others finished", () => {
    expect(
      deriveOverallStatus({
        analyst: [event({ stage: "analyst", status: "done" })],
        architect: [event({ stage: "architect", status: "failed" })],
      }),
    ).toBe("failed");
  });

  it("is blocked when merge is blocked", () => {
    expect(
      deriveOverallStatus({
        qa: [event({ stage: "qa", status: "done" })],
        merge: [event({ stage: "merge", status: "blocked" })],
      }),
    ).toBe("blocked");
  });

  it("is deployed once the deploy stage is done", () => {
    expect(
      deriveOverallStatus({
        deploy: [event({ stage: "deploy", status: "done" })],
      }),
    ).toBe("deployed");
  });

  it("is deployed, not failed, when only the bookkeeping tracing_pack stage failed on an otherwise-successful run", () => {
    expect(
      deriveOverallStatus({
        deploy: [event({ stage: "deploy", status: "done" })],
        tracing_pack: [event({ stage: "tracing_pack", status: "failed" })],
      }),
    ).toBe("deployed");
  });

  it("failed takes priority over a later blocked/deployed event", () => {
    expect(
      deriveOverallStatus({
        developer: [event({ stage: "developer", status: "failed" })],
        deploy: [event({ stage: "deploy", status: "done" })],
      }),
    ).toBe("failed");
  });
});
