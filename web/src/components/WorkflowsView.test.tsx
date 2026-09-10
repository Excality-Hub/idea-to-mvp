import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

const deployedEventsByStage: EventsByStage = {
  deploy: [
    { stage: "deploy", status: "done", message: "https://app.onrender.com", timestamp: "2026-01-01T00:05:00.000Z" },
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

  it("shows an idea input and Start button when idle (no events yet)", () => {
    render(<WorkflowsView eventsByStage={{}} />);

    expect(screen.getByLabelText("Idea & requirements")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });

  it("posts the idea text to /api/run when Start is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={{}} />);

    await user.type(screen.getByLabelText("Idea & requirements"), "Build a todo app");
    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaText: "Build a todo app" }),
    });
    vi.unstubAllGlobals();
  });

  it("does not show the idea form once a run has started", () => {
    render(<WorkflowsView eventsByStage={eventsByStage} />);

    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });

  it("shows a 'Start a new run' button once the run reaches a terminal outcome", () => {
    render(<WorkflowsView eventsByStage={deployedEventsByStage} />);

    expect(screen.getByRole("button", { name: "Start a new run" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });

  it("reveals the idea form when 'Start a new run' is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={deployedEventsByStage} />);

    await user.click(screen.getByRole("button", { name: "Start a new run" }));

    expect(screen.getByLabelText("Idea & requirements")).toBeInTheDocument();
  });
});
