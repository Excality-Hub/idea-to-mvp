import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "./projectStore.js";
import type { RunEvent } from "./types.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "project-store-test-"));
  return join(dir, "projects.json");
}

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-14T00:00:00.000Z",
};

describe("createProjectStore", () => {
  it("starts empty when the file doesn't exist yet", () => {
    const store = createProjectStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and gets a project record", () => {
    const store = createProjectStore(tempFile());
    const record = {
      id: "p1",
      ideaText: "Build a todo app",
      repoName: "idea-to-mvp-1",
      createdAt: "2026-09-14T00:00:00.000Z",
      events: [],
    };

    store.create(record);

    expect(store.get("p1")).toEqual(record);
    expect(store.list()).toEqual([record]);
  });

  it("appends an event to an existing record's events", () => {
    const store = createProjectStore(tempFile());
    store.create({
      id: "p1",
      ideaText: "Build a todo app",
      repoName: "idea-to-mvp-1",
      createdAt: "2026-09-14T00:00:00.000Z",
      events: [],
    });

    store.appendEvent("p1", sampleEvent);

    expect(store.get("p1")?.events).toEqual([sampleEvent]);
  });

  it("does nothing when appending an event to an unknown project id", () => {
    const store = createProjectStore(tempFile());

    expect(() => store.appendEvent("nope", sampleEvent)).not.toThrow();
    expect(store.get("nope")).toBeUndefined();
  });
});
