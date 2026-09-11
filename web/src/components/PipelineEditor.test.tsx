import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineEditor } from "./PipelineEditor";

const agentA = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB = { id: "b", name: "Agent B", instructions: "do b", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" };

function stubFetch(overrides: { agents?: unknown; save?: { ok: boolean; body?: unknown } } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? [agentA, agentB]) });
    }
    const save = overrides.save ?? { ok: true, body: {} };
    return Promise.resolve({ ok: save.ok, json: () => Promise.resolve(save.body ?? {}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelineEditor", () => {
  it("renders the fixed backbone stages", async () => {
    stubFetch();

    render(<PipelineEditor onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("QA review")).toBeInTheDocument();
    expect(screen.getByText("Deploy")).toBeInTheDocument();
  });

  it("shows agents not yet placed in the palette, and excludes a placed one", async () => {
    stubFetch();
    const initial = {
      id: "w1",
      name: "Existing",
      slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    render(<PipelineEditor initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(within(screen.getByTestId("agent-palette")).getByText("Agent B")).toBeInTheDocument());
    expect(within(screen.getByTestId("agent-palette")).queryByText("Agent A")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("after-analyst-slot")).getByText("Agent A")).toBeInTheDocument();
  });

  it("removes a placed agent back to the palette", async () => {
    stubFetch();
    const initial = {
      id: "w1",
      name: "Existing",
      slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const user = userEvent.setup();

    render(<PipelineEditor initial={initial} onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(within(screen.getByTestId("after-analyst-slot")).getByText("Agent A")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Remove Agent A/ }));

    expect(within(screen.getByTestId("after-analyst-slot")).queryByText("Agent A")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("agent-palette")).getByText("Agent A")).toBeInTheDocument();
  });

  it("saves a new pipeline via POST and calls onSaved", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineEditor onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "New Pipeline");
    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Pipeline",
          slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
        }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("saves an edited pipeline via PUT to its id", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const initial = {
      id: "w1",
      name: "Existing",
      slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    render(<PipelineEditor initial={initial} onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue("Existing")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows/w1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Existing",
          slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
        }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces a save error without calling onSaved", async () => {
    stubFetch({ save: { ok: false, body: { error: "boom" } } });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineEditor onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Name"), "X");

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    stubFetch();
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<PipelineEditor onSaved={() => {}} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});
