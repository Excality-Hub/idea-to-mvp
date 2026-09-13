import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentStore } from "./agentStore.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-store-test-"));
  return join(dir, "agents.json");
}

describe("createAgentStore", () => {
  it("starts empty when the file doesn't exist yet", () => {
    const store = createAgentStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and lists an agent", () => {
    const store = createAgentStore(tempFile());
    const agent = {
      id: "sec-1",
      name: "Security Reviewer",
      instructions: "Look for injection and auth bypass issues.",
      repoAccess: true,
      createdAt: "2026-09-10T00:00:00.000Z",
    };

    store.create(agent);

    expect(store.list()).toEqual([agent]);
    expect(store.get("sec-1")).toEqual(agent);
  });
});
