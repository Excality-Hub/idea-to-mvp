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
  it("runs with read-only tools and returns the parsed verdict, findings, and token usage", async () => {
    const rawOutput = JSON.stringify({
      result: `Reviewed.\n\`\`\`json\n${JSON.stringify(fakeQaJson)}\n\`\`\``,
      total_cost_usd: 0.03,
      usage: { input_tokens: 300, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runQaAgent("diff --git a/server.js b/server.js", "/tmp/work");

    expect(result).toEqual({
      output: fakeQaJson,
      usage: {
        inputTokens: 300,
        outputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.03,
      },
    });
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("diff --git a/server.js b/server.js"),
      cwd: "/tmp/work",
      allowedTools: ["Read"],
    });
  });

  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Reviewed.\n\`\`\`json\n${JSON.stringify(fakeQaJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runQaAgent("diff --git a/server.js b/server.js", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
