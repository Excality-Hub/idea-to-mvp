import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildDeveloperPrompt, runDeveloperAgent } from "./developer.js";

const fakeDeveloperJson = {
  prTitle: "Add task tracking",
  prBody: "Implemented add/complete task endpoints.",
};

describe("buildDeveloperPrompt", () => {
  it("includes the issue body and instructs the agent not to open a PR itself", () => {
    const prompt = buildDeveloperPrompt("Implement add/complete task endpoints.");
    expect(prompt).toContain("Implement add/complete task endpoints.");
    expect(prompt).toContain("Do not open a pull request yourself");
  });
});

describe("runDeveloperAgent", () => {
  it("runs with file and bash tools enabled and returns the parsed output and token usage", async () => {
    const rawOutput = JSON.stringify({
      result: `Done.\n\`\`\`json\n${JSON.stringify(fakeDeveloperJson)}\n\`\`\``,
      total_cost_usd: 0.05,
      usage: { input_tokens: 500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runDeveloperAgent("Implement add/complete task endpoints.", "/tmp/work");

    expect(result).toEqual({
      output: fakeDeveloperJson,
      usage: {
        inputTokens: 500,
        outputTokens: 300,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.05,
      },
    });
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Implement add/complete task endpoints."),
      cwd: "/tmp/work",
      allowedTools: ["Bash", "Read", "Write", "Edit"],
    });
  });

  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Done.\n\`\`\`json\n${JSON.stringify(fakeDeveloperJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runDeveloperAgent("Implement add/complete task endpoints.", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
