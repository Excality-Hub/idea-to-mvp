import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineCanvas } from "./PipelineCanvas";

const agentA = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB = { id: "b", name: "Agent B", instructions: "do b", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" };
const agentC = {
  id: "c",
  name: "PR Reviewer",
  instructions: "review the diff",
  repoAccess: false,
  inputs: ["pull_request"],
  outputs: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

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

function dataTransferWith(agentId: string) {
  return { getData: () => agentId, setData: () => {} } as unknown as DataTransfer;
}

function gateDataTransfer() {
  return {
    getData: (type: string) => (type === "application/x-gate" ? "gate" : ""),
    setData: () => {},
  } as unknown as DataTransfer;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelineCanvas", () => {
  it("renders all 11 fixed backbone stages and the End node", async () => {
    stubFetch();

    render(<PipelineCanvas projectId="p1" onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("Create repo")).toBeInTheDocument();
    expect(screen.getByText("QA review")).toBeInTheDocument();
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
    expect(screen.getByText("End")).toBeInTheDocument();
  });

  it("shows agents not yet placed in the palette, and excludes a placed one", async () => {
    stubFetch();
    const initial = { id: "w1", projectId: "p1", name: "Existing", slots: { analyst: ["a"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas projectId="p1" initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(within(screen.getByTestId("agent-palette")).getByText("Agent B")).toBeInTheDocument());
    expect(within(screen.getByTestId("agent-palette")).queryByText("Agent A")).not.toBeInTheDocument();
    expect(screen.getByText("Agent A")).toBeInTheDocument();
  });

  it("drops a palette agent onto an insertion point after create_repo", async () => {
    stubFetch();

    render(<PipelineCanvas projectId="p1" onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-create_repo-0")).toBeInTheDocument());

    fireEvent.drop(screen.getByTestId("insertion-create_repo-0"), { dataTransfer: dataTransferWith("a") });

    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-palette")).queryByText("Agent A")).not.toBeInTheDocument();
  });

  it("removes a placed agent back to the palette", async () => {
    stubFetch();
    const initial = { id: "w1", projectId: "p1", name: "Existing", slots: { analyst: ["a"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas projectId="p1" initial={initial} onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText("Agent A")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: /Remove Agent A/ }));

    expect(within(screen.getByTestId("agent-palette")).getByText("Agent A")).toBeInTheDocument();
  });

  it("drops the Approval gate palette card onto an insertion point", async () => {
    stubFetch();

    render(<PipelineCanvas projectId="p1" onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-create_repo-0")).toBeInTheDocument());

    fireEvent.drop(screen.getByTestId("insertion-create_repo-0"), { dataTransfer: gateDataTransfer() });

    expect(screen.getByRole("button", { name: /Remove gate/ })).toBeInTheDocument();
  });

  it("removes a placed gate", async () => {
    stubFetch();

    render(<PipelineCanvas projectId="p1" onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-create_repo-0")).toBeInTheDocument());
    fireEvent.drop(screen.getByTestId("insertion-create_repo-0"), { dataTransfer: gateDataTransfer() });
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove gate/ })).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: /Remove gate/ }));

    expect(screen.queryByRole("button", { name: /Remove gate/ })).not.toBeInTheDocument();
  });

  it("saves a new pipeline via POST and calls onSaved", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas projectId="p1" onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "New Pipeline");
    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Pipeline", slots: {} }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("saves an edited pipeline via PUT to its id, including a dropped agent", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const initial = { id: "w1", projectId: "p1", name: "Existing", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas projectId="p1" initial={initial} onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-qa-0")).toBeInTheDocument());
    fireEvent.drop(screen.getByTestId("insertion-qa-0"), { dataTransfer: dataTransferWith("b") });

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/workflows/w1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Existing", slots: { qa: ["b"] } }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces a save error without calling onSaved", async () => {
    stubFetch({ save: { ok: false, body: { error: "boom" } } });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas projectId="p1" onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Name"), "X");

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("surfaces a fallback error and does not call onSaved when the save request rejects", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/agents") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([agentA, agentB]) });
      }
      return Promise.reject(new Error("network down"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas projectId="p1" onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Name"), "X");

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(screen.getByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the agents fetch error inside the palette", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    render(<PipelineCanvas projectId="p1" onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() =>
      expect(within(screen.getByTestId("agent-palette")).getByText("Failed to load agents (undefined)")).toBeInTheDocument(),
    );
  });

  it("shows a warning badge on a custom agent placed before its declared input is available", async () => {
    stubFetch({ agents: [agentA, agentB, agentC] });
    const initial = { id: "w1", projectId: "p1", name: "Existing", slots: { create_repo: ["c"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas projectId="p1" initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("PR Reviewer")).toBeInTheDocument());
    expect(screen.getByTitle(/missing: pull request/i)).toBeInTheDocument();
  });

  it("shows no warning badge once the custom agent is placed after its declared input is available", async () => {
    stubFetch({ agents: [agentA, agentB, agentC] });
    const initial = { id: "w1", projectId: "p1", name: "Existing", slots: { qa: ["c"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas projectId="p1" initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("PR Reviewer")).toBeInTheDocument());
    expect(screen.queryByTitle(/missing:/i)).not.toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    stubFetch();
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas projectId="p1" onSaved={() => {}} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});
