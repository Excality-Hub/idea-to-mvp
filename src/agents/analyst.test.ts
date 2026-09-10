import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildAnalystPrompt, runAnalystAgent } from "./analyst.js";

const fakeAnalystJson = {
  summary: "A todo app",
  goals: ["let users track tasks"],
  keyFeatures: ["add task", "mark done"],
  nonGoals: ["auth"],
  openQuestions: [],
};

describe("buildAnalystPrompt", () => {
  it("includes the idea text and the expected output shape", () => {
    const prompt = buildAnalystPrompt("Build a todo app");
    expect(prompt).toContain("Build a todo app");
    expect(prompt).toContain("openQuestions");
  });
});

describe("runAnalystAgent", () => {
  it("returns the parsed analyst output and token usage from the claude -p result", async () => {
    const rawOutput = JSON.stringify({
      result: `Some explanation.\n\`\`\`json\n${JSON.stringify(fakeAnalystJson)}\n\`\`\``,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runAnalystAgent("Build a todo app", "/tmp/work");

    expect(result).toEqual({
      output: fakeAnalystJson,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.01,
      },
    });
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Build a todo app"),
      cwd: "/tmp/work",
      allowedTools: [],
    });
  });

  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Some explanation.\n\`\`\`json\n${JSON.stringify(fakeAnalystJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runAnalystAgent("Build a todo app", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
