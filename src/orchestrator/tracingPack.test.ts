import { describe, expect, it } from "vitest";
import { formatTracingPackMarkdown, type TracingPackEntry } from "./tracingPack.js";

describe("formatTracingPackMarkdown", () => {
  it("renders one section per entry with input/output as fenced JSON", () => {
    const entries: TracingPackEntry[] = [
      {
        stage: "analyst",
        status: "done",
        input: { ideaText: "Build a todo app" },
        output: { summary: "A todo app" },
      },
    ];

    const markdown = formatTracingPackMarkdown(entries, "deployed");

    expect(markdown).toContain("# Tracing Pack");
    expect(markdown).toContain("Outcome: **deployed**");
    expect(markdown).toContain("## analyst");
    expect(markdown).toContain("Status: `done`");
    expect(markdown).toContain('"ideaText": "Build a todo app"');
    expect(markdown).toContain('"summary": "A todo app"');
  });

  it("renders _none_ for a field that has no value yet", () => {
    const entries: TracingPackEntry[] = [
      { stage: "deploy", status: "running", input: { name: "app-1" } },
    ];

    const markdown = formatTracingPackMarkdown(entries, "failed");

    expect(markdown).toContain("**Output**\n\n_none_");
  });

  it("renders an empty tracing pack when there are no entries", () => {
    const markdown = formatTracingPackMarkdown([], "failed");

    expect(markdown).toContain("# Tracing Pack");
    expect(markdown).toContain("Outcome: **failed**");
  });

  it("renders token usage and cost for an entry that has it", () => {
    const entries: TracingPackEntry[] = [
      {
        stage: "analyst",
        status: "done",
        input: { ideaText: "Build a todo app" },
        output: { summary: "A todo app" },
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 20,
          costUsd: 0.0123,
        },
      },
    ];

    const markdown = formatTracingPackMarkdown(entries, "deployed");

    expect(markdown).toContain("**Tokens**");
    expect(markdown).toContain("input: 100");
    expect(markdown).toContain("output: 50");
    expect(markdown).toContain("cache read: 20");
    expect(markdown).toContain("cache write: 10");
    expect(markdown).toContain("cost: $0.0123");
  });

  it("omits the Tokens section for an entry with no usage", () => {
    const entries: TracingPackEntry[] = [{ stage: "create_repo", status: "done", output: { htmlUrl: "x" } }];

    const markdown = formatTracingPackMarkdown(entries, "deployed");

    expect(markdown).not.toContain("**Tokens**");
  });
});
