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
    const prompt = buildArchitectPrompt(analystOutput, "render");
    expect(prompt).toContain("A todo app");
    expect(prompt).toContain("branchName");
  });

  it("describes the Express/Render layout by default", () => {
    const prompt = buildArchitectPrompt(analystOutput);
    expect(prompt).toContain("Node/Express starter template");
    expect(prompt).toContain("server.js");
  });

  it("describes the Cloudflare Workers layout and warns against splitting files", () => {
    const prompt = buildArchitectPrompt(analystOutput, "cloudflare");
    expect(prompt).toContain("Cloudflare Workers starter template");
    expect(prompt).toContain("src/index.js");
    expect(prompt).not.toContain("Express app");
    expect(prompt).toContain("only src/index.js is uploaded");
  });
});

describe("runArchitectAgent", () => {
  it("returns the parsed architect output from the claude -p result", async () => {
    const rawOutput = JSON.stringify({
      result: `Plan below.\n\`\`\`json\n${JSON.stringify(fakeArchitectJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runArchitectAgent(analystOutput, "/tmp/work", "render");

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

    await runArchitectAgent(analystOutput, "/tmp/work", "render", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
