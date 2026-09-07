import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildArchitectPrompt, runArchitectAgent } from "./architect.js";
import type { AnalystOutput } from "./schemas.js";

const analystOutput: AnalystOutput = {
  summary: "A todo app",
  goals: ["let users track tasks"],
  keyFeatures: ["add task", "mark done"],
  nonGoals: ["auth"],
  openQuestions: [],
};

const fakeArchitectJson = {
  issueTitle: "Add task tracking",
  issueBody: "Implement add/complete task endpoints and a simple UI.",
  branchName: "feature/task-tracking",
};

describe("buildArchitectPrompt", () => {
  it("includes the analyst output and the expected output shape", () => {
    const prompt = buildArchitectPrompt(analystOutput);
    expect(prompt).toContain("A todo app");
    expect(prompt).toContain("branchName");
  });
});

describe("runArchitectAgent", () => {
  it("returns the parsed architect output from the claude -p result", async () => {
    const rawOutput = JSON.stringify({
      result: `Plan below.\n\`\`\`json\n${JSON.stringify(fakeArchitectJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runArchitectAgent(analystOutput, "/tmp/work");

    expect(result).toEqual(fakeArchitectJson);
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("A todo app"),
      cwd: "/tmp/work",
      allowedTools: [],
    });
  });

  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Plan below.\n\`\`\`json\n${JSON.stringify(fakeArchitectJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runArchitectAgent(analystOutput, "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
