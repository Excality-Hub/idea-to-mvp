import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHistoryView } from "./ProjectHistoryView";
import type { ProjectRecord } from "@/types";

function stubFetch(agents: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve(agents) });
      return Promise.reject(new Error(`unexpected fetch to ${url}`));
    }),
  );
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const project: ProjectRecord = {
  id: "p1",
  ideaText: "Build a todo app",
  repoName: "idea-to-mvp-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  events: [
    { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
    { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
    { stage: "architect", status: "done", message: "Plan ready", timestamp: "2026-01-01T00:02:00.000Z" },
  ],
};

describe("ProjectHistoryView", () => {
  it("renders the idea text as the heading and a node per recorded stage, in first-seen order", async () => {
    render(<ProjectHistoryView project={project} />);

    expect(screen.getByRole("heading", { name: "Build a todo app" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("Architect")).toBeInTheDocument();
  });

  it("opens the detail sheet with a stage's recorded events on click, and shows no start form", async () => {
    const user = userEvent.setup();
    render(<ProjectHistoryView project={project} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());

    await user.click(screen.getByText("Analyst"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Analyzing idea")).toBeInTheDocument();
    expect(dialog.getByText("Todo app summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });
});
