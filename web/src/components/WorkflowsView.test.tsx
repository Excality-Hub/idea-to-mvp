import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkflowsView } from "./WorkflowsView";
import type { EventsByStage } from "@/lib/runEvents";

// jsdom's synthetic mouse events leave `event.view` null, which crashes d3-zoom's
// drag-disable helper (used internally by @xyflow/react's pane pan/zoom) when a
// click on a node bubbles up to the canvas. Real browsers always populate
// `event.view`, so this is a test-environment-only artifact, not a product bug.
window.addEventListener("error", (event) => {
  if (event.error instanceof TypeError && /reading 'document'/.test(event.error.message)) {
    event.preventDefault();
  }
});

const eventsByStage: EventsByStage = {
  analyst: [
    { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
    { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
  ],
};

describe("WorkflowsView", () => {
  it("renders a node for every pipeline stage", () => {
    const { container } = render(<WorkflowsView eventsByStage={eventsByStage} />);
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(11);
  });

  it("opens the detail sheet with the stage's full log on click", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);

    await user.click(screen.getByText("Analyst"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Analyzing idea")).toBeInTheDocument();
    expect(dialog.getByText("Todo app summary")).toBeInTheDocument();
  });

  it("shows a pending, empty-log state for a stage with no events yet", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);

    await user.click(screen.getByText("Deploy"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/hasn.t started/)).toBeInTheDocument();
  });
});
