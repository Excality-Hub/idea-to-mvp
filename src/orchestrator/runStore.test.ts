import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunStore } from "./runStore.js";
import type { RunEvent } from "./types.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "run-store-test-"));
  return join(dir, "runs.json");
}

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-14T00:00:00.000Z",
};

describe("createRunStore", () => {
  it("starts empty when the file doesn't exist yet", () => {
    const store = createRunStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and gets a run", () => {
    const store = createRunStore(tempFile());
    const run = {
      id: "r1",
      projectId: "p1",
      ideaText: "Build a todo app",
      workflowId: "p1-default",
      createdAt: "2026-09-14T00:00:00.000Z",
      events: [],
    };

    store.create(run);

    expect(store.get("r1")).toEqual(run);
    expect(store.list()).toEqual([run]);
  });

  it("appends an event to an existing run's events", () => {
    const store = createRunStore(tempFile());
    store.create({
      id: "r1",
      projectId: "p1",
      ideaText: "Build a todo app",
      workflowId: "p1-default",
      createdAt: "2026-09-14T00:00:00.000Z",
      events: [],
    });

    store.appendEvent("r1", sampleEvent);

    expect(store.get("r1")?.events).toEqual([sampleEvent]);
  });

  it("does nothing when appending an event to an unknown run id", () => {
    const store = createRunStore(tempFile());

    expect(() => store.appendEvent("nope", sampleEvent)).not.toThrow();
    expect(store.get("nope")).toBeUndefined();
  });

  it("lists only the runs belonging to the given project, in store order", () => {
    const store = createRunStore(tempFile());
    store.create({ id: "r1", projectId: "p1", ideaText: "A", workflowId: "p1-default", createdAt: "2026-09-14T00:00:00.000Z", events: [] });
    store.create({ id: "r2", projectId: "p2", ideaText: "B", workflowId: "p2-default", createdAt: "2026-09-14T00:01:00.000Z", events: [] });
    store.create({ id: "r3", projectId: "p1", ideaText: "C", workflowId: "p1-default", createdAt: "2026-09-14T00:02:00.000Z", events: [] });

    expect(store.listByProject("p1").map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(store.listByProject("p2").map((r) => r.id)).toEqual(["r2"]);
    expect(store.listByProject("nope")).toEqual([]);
  });
});
