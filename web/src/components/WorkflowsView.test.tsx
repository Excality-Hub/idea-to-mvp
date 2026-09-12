import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const DEFAULT_WORKFLOW = {
  id: "default",
  name: "Default",
  slots: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

function stubFetch(overrides: { plan?: unknown; agents?: unknown; workflows?: unknown; run?: unknown } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/run/plan") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.plan ?? []) });
    }
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? []) });
    }
    if (url === "/api/workflows") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.workflows ?? [DEFAULT_WORKFLOW]) });
    }
    if (url === "/api/run" && init?.method === "POST") {
      return Promise.resolve(overrides.run ?? { ok: true });
    }
    return Promise.reject(new Error(`unexpected fetch to ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  it("renders a node for every pipeline stage", async () => {
    const { container } = render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(11);
  });

  it("opens the detail sheet with the stage's full log on click", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());

    await user.click(screen.getByText("Analyst"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Analyzing idea")).toBeInTheDocument();
    expect(dialog.getByText("Todo app summary")).toBeInTheDocument();
  });

  it("shows a pending, empty-log state for a stage with no events yet", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Deploy")).toBeInTheDocument());

    await user.click(screen.getByText("Deploy"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/hasn.t started/)).toBeInTheDocument();
  });

  it("shows an idea input, a pipeline picker, and Start button when idle", async () => {
    render(<WorkflowsView eventsByStage={{}} />);

    expect(screen.getByLabelText("Idea & requirements")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toBeInTheDocument());
    expect(within(screen.getByLabelText("Pipeline")).getByRole("option", { name: "Default" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });

  it("posts the idea text and selected workflowId to /api/run when Start is clicked", async () => {
    const fetchMock = stubFetch({
      workflows: [DEFAULT_WORKFLOW, { ...DEFAULT_WORKFLOW, id: "with-review", name: "With review" }],
    });
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={{}} />);
    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Idea & requirements"), "Build a todo app");
    await user.selectOptions(screen.getByLabelText("Pipeline"), "with-review");
    await user.click(screen.getByRole("button", { name: "Start run" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText: "Build a todo app", workflowId: "with-review" }),
      }),
    );
  });

  it("does not show the idea form once a run has started", async () => {
    render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());

    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });

  it("shows a 'Start a new run' button once the run reaches a terminal outcome", async () => {
    render(<WorkflowsView eventsByStage={deployedEventsByStage} />);
    await waitFor(() => expect(screen.getByText("Deploy")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Start a new run" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });

  it("reveals the idea form when 'Start a new run' is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={deployedEventsByStage} />);
    await waitFor(() => expect(screen.getByText("Deploy")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Start a new run" }));

    expect(screen.getByLabelText("Idea & requirements")).toBeInTheDocument();
  });

  it("renders a custom stage using its agent's name as the label, resolved from /api/run/plan and /api/agents", async () => {
    stubFetch({
      plan: ["create_repo", "analyst", "custom:sec-1", "architect", "open_issue", "developer", "open_pr", "qa", "post_review", "merge", "deploy", "tracing_pack"],
      agents: [{ id: "sec-1", name: "Security Reviewer", instructions: "x", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    const customEventsByStage: EventsByStage = {
      ...eventsByStage,
      "custom:sec-1": [
        { stage: "custom:sec-1", status: "running", message: "Running Security Reviewer", timestamp: "2026-01-01T00:02:00.000Z" },
      ],
    };

    render(<WorkflowsView eventsByStage={customEventsByStage} />);

    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());
  });
});
