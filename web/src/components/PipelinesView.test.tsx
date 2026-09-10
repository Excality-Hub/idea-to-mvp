import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelinesView } from "./PipelinesView";

const agentA = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB = { id: "b", name: "Agent B", instructions: "do b", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" };
const defaultWorkflow = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function stubFetch(overrides: { agents?: unknown; workflows?: unknown } = {}) {
  const fetchMock = vi.fn(
    (url: string, _init?: RequestInit): Promise<{ ok: boolean; json?: () => Promise<unknown> }> => {
      if (url === "/api/agents") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? [agentA, agentB]) });
      }
      if (url === "/api/workflows") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.workflows ?? [defaultWorkflow]) });
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelinesView", () => {
  it("lists existing workflows, showing the default as not deletable", async () => {
    stubFetch();

    render(<PipelinesView />);

    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());
    expect(within(screen.getByTestId("workflow-row-default")).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("adds an agent to a slot, removes it from other slots' pickers, and creates the workflow", async () => {
    const fetchMock = stubFetch({ workflows: [defaultWorkflow] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve([agentA, agentB]) });
      if (url === "/api/workflows" && !init) return Promise.resolve({ ok: true, json: () => Promise.resolve([defaultWorkflow]) });
      if (url === "/api/workflows" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...defaultWorkflow, id: "new" }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "With Agent A");
    await user.selectOptions(screen.getByLabelText("After Analyst"), "a");
    await user.click(screen.getByRole("button", { name: "Add to After Analyst" }));

    expect(screen.getByTestId("after-analyst-slot")).toHaveTextContent("Agent A");
    expect(within(screen.getByLabelText("After Architect")).queryByRole("option", { name: "Agent A" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "With Agent A",
          slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
        }),
      }),
    );
  });

  it("deletes a non-default workflow", async () => {
    const workflow = { ...defaultWorkflow, id: "custom-1", name: "Custom" };
    const fetchMock = stubFetch({ workflows: [defaultWorkflow, workflow] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve([agentA, agentB]) });
      if (url === "/api/workflows" && init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (url === "/api/workflows") return Promise.resolve({ ok: true, json: () => Promise.resolve([defaultWorkflow, workflow]) });
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Custom")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("workflow-row-custom-1")).getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/workflows/custom-1", { method: "DELETE" });
  });
});
