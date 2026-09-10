import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageDetailSheet } from "./StageDetailSheet";
import type { RunEvent } from "@/types";

const baseEvent: RunEvent = {
  stage: "analyst",
  status: "done",
  message: "A todo app",
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("StageDetailSheet", () => {
  it("renders input and output as pretty-printed JSON when present", () => {
    const events: RunEvent[] = [
      { ...baseEvent, input: { ideaText: "Build a todo app" }, output: { summary: "A todo app" } },
    ];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("ideaText:")).toBeInTheDocument();
    expect(screen.getByText('"Build a todo app"')).toBeInTheDocument();
    expect(screen.getByText("summary:")).toBeInTheDocument();
    expect(screen.getByText('"A todo app"')).toBeInTheDocument();
  });

  it("omits input/output sections when neither is present", () => {
    const events: RunEvent[] = [baseEvent];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("renders token usage and cost when present", () => {
    const events: RunEvent[] = [
      {
        ...baseEvent,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 20,
          costUsd: 0.0123,
        },
      },
    ];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText(/100 in/)).toBeInTheDocument();
    expect(screen.getByText(/50 out/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0123/)).toBeInTheDocument();
  });

  it("omits the Tokens section when usage is not present", () => {
    const events: RunEvent[] = [baseEvent];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
  });
});
