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
});
