import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildCustomAgentPrompt, runCustomAgent } from "./custom.js";
import type { AgentDefinition } from "./types.js";

const agent: AgentDefinition = {
  id: "sec-1",
  name: "Security Reviewer",
  instructions: "Look for injection and auth bypass issues.",
  repoAccess: true,
  createdAt: "2026-09-10T00:00:00.000Z",
};

describe("buildCustomAgentPrompt", () => {
  it("includes the agent's name, instructions, and the given context", () => {
    const prompt = buildCustomAgentPrompt(agent, "IDEA:\nBuild a todo app");

    expect(prompt).toContain("Security Reviewer");
    expect(prompt).toContain("Look for injection and auth bypass issues.");
    expect(prompt).toContain("Build a todo app");
  });
});

describe("runCustomAgent", () => {
  it("returns the claude -p result text as output.text, with token usage", async () => {
    const rawOutput = JSON.stringify({
      result: "No injection issues found.",
      total_cost_usd: 0.02,
      usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runCustomAgent(agent, "IDEA:\nBuild a todo app", "/tmp/work");

    expect(result).toEqual({
      output: { text: "No injection issues found." },
      usage: {
        inputTokens: 200,
        outputTokens: 40,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.02,
      },
    });
  });

  it("requests the Read tool when repoAccess is true, and no tools when false", async () => {
    vi.mocked(runClaudeAgent).mockResolvedValue(JSON.stringify({ result: "ok" }));

    await runCustomAgent(agent, "context", "/tmp/work");
    expect(runClaudeAgent).toHaveBeenCalledWith(expect.objectContaining({ allowedTools: ["Read"] }));

    await runCustomAgent({ ...agent, repoAccess: false }, "context", "/tmp/work");
    expect(runClaudeAgent).toHaveBeenCalledWith(expect.objectContaining({ allowedTools: [] }));
  });

  it("forwards the abort signal to runClaudeAgent", async () => {
    vi.mocked(runClaudeAgent).mockResolvedValue(JSON.stringify({ result: "ok" }));
    const controller = new AbortController();

    await runCustomAgent(agent, "context", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});
