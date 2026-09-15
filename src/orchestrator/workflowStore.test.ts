import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultWorkflow, createWorkflowStore, defaultWorkflowIdFor } from "./workflowStore.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-store-test-"));
  return join(dir, "workflows.json");
}

describe("createWorkflowStore", () => {
  it("starts empty when the file doesn't exist yet (no more global auto-seeding)", () => {
    const store = createWorkflowStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and lists workflows scoped by project", () => {
    const store = createWorkflowStore(tempFile());
    store.create({ id: "w1", projectId: "p1", name: "With review", slots: { architect: ["sec-1"] }, createdAt: "2026-09-10T00:00:00.000Z" });
    store.create({ id: "w2", projectId: "p2", name: "Other project's", slots: {}, createdAt: "2026-09-10T00:01:00.000Z" });

    expect(store.listByProject("p1").map((w) => w.id)).toEqual(["w1"]);
    expect(store.listByProject("p2").map((w) => w.id)).toEqual(["w2"]);
    expect(store.listByProject("nope")).toEqual([]);
  });
});

describe("defaultWorkflowIdFor", () => {
  it("derives a deterministic id from the project id", () => {
    expect(defaultWorkflowIdFor("p1")).toBe("p1-default");
  });
});

describe("createDefaultWorkflow", () => {
  it("builds a fresh Default workflow owned by the given project, with empty slots", () => {
    const workflow = createDefaultWorkflow("p1");

    expect(workflow.id).toBe("p1-default");
    expect(workflow.projectId).toBe("p1");
    expect(workflow.name).toBe("Default");
    expect(workflow.slots).toEqual({});
  });
});
