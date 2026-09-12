import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflowStore, DEFAULT_WORKFLOW_ID } from "./workflowStore.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-store-test-"));
  return join(dir, "workflows.json");
}

describe("createWorkflowStore", () => {
  it("seeds a default workflow with empty slots when the file doesn't exist yet", () => {
    const store = createWorkflowStore(tempFile());

    const workflows = store.list();
    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      id: DEFAULT_WORKFLOW_ID,
      name: "Default",
      slots: {},
    });
  });

  it("creates and lists an additional workflow alongside the default", () => {
    const store = createWorkflowStore(tempFile());
    const workflow = {
      id: "with-review",
      name: "With security review",
      slots: { architect: ["sec-1"] },
      createdAt: "2026-09-10T00:00:00.000Z",
    };

    store.create(workflow);

    expect(store.list().map((w) => w.id)).toEqual([DEFAULT_WORKFLOW_ID, "with-review"]);
    expect(store.get("with-review")).toEqual(workflow);
  });
});
