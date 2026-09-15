import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunsHistoryView } from "./RunsHistoryView";

const runSummaries = [
  { id: "r1", projectId: "p1", ideaText: "Build a todo app", workflowId: "p1-default", createdAt: "2026-09-14T00:00:00.000Z" },
  { id: "r2", projectId: "p1", ideaText: "Build a blog", workflowId: "p1-default", createdAt: "2026-09-13T00:00:00.000Z" },
];
const runDetail = {
  ...runSummaries[0],
  events: [{ stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-09-14T00:01:00.000Z" }],
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/projects/p1/runs") return Promise.resolve({ ok: true, json: () => Promise.resolve(runSummaries) });
      if (url === "/api/projects/p1/runs/r1") return Promise.resolve({ ok: true, json: () => Promise.resolve(runDetail) });
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }),
  );
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RunsHistoryView", () => {
  it("lists the project's runs, as given by the API", async () => {
    render(<RunsHistoryView projectId="p1" />);

    await waitFor(() => expect(screen.getByText("Build a todo app")).toBeInTheDocument());
    expect(screen.getByText("Build a blog")).toBeInTheDocument();
  });

  it("opens a run's read-only detail view when a row is clicked", async () => {
    const user = userEvent.setup();
    render(<RunsHistoryView projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId("run-row-r1")).toBeInTheDocument());

    await user.click(screen.getByTestId("run-row-r1"));

    expect(await screen.findByRole("heading", { name: "Build a todo app" })).toBeInTheDocument();
  });

  it("returns to the run list from the detail view's back link", async () => {
    const user = userEvent.setup();
    render(<RunsHistoryView projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId("run-row-r1")).toBeInTheDocument());
    await user.click(screen.getByTestId("run-row-r1"));
    await screen.findByRole("heading", { name: "Build a todo app" });

    await user.click(screen.getByText(/back to runs/i));

    expect(await screen.findByTestId("run-row-r1")).toBeInTheDocument();
  });

  it("shows an empty state when the project has no runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/projects/p1/runs") return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    render(<RunsHistoryView projectId="p1" />);

    await waitFor(() => expect(screen.getByText("No runs yet.")).toBeInTheDocument());
  });
});
