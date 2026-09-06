import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildQaPrompt, runQaAgent } from "./qa.js";

const fakeQaJson = {
  verdict: "pass",
  findings: [
    { severity: "minor", category: "style", summary: "inconsistent quotes", file: "server.js", line: 4 },
  ],
};

describe("buildQaPrompt", () => {
  it("includes the diff and instructs conservative use of critical severity", () => {
    const prompt = buildQaPrompt("diff --git a/server.js b/server.js");
    expect(prompt).toContain("diff --git a/server.js b/server.js");
    expect(prompt).toContain("be conservative");
  });
});

describe("runQaAgent", () => {
  it("runs with read-only tools and returns the parsed verdict and findings", async () => {
    const rawOutput = JSON.stringify({
      result: `Reviewed.\n\`\`\`json\n${JSON.stringify(fakeQaJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runQaAgent("diff --git a/server.js b/server.js", "/tmp/work");

    expect(result).toEqual(fakeQaJson);
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("diff --git a/server.js b/server.js"),
      cwd: "/tmp/work",
      allowedTools: ["Read"],
    });
  });
});
