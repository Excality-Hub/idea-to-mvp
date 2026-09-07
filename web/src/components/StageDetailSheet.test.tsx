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

    expect(screen.getByText(/"ideaText": "Build a todo app"/)).toBeInTheDocument();
    expect(screen.getByText(/"summary": "A todo app"/)).toBeInTheDocument();
  });

  it("omits input/output sections when neither is present", () => {
    const events: RunEvent[] = [baseEvent];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });
});
