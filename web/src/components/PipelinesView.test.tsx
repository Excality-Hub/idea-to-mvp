import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelinesView } from "./PipelinesView";

const defaultWorkflow = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};
const customWorkflow = { ...defaultWorkflow, id: "custom-1", name: "Custom" };

function stubFetch(overrides: { workflows?: unknown; agents?: unknown } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? []) });
    }
    if (url === "/api/workflows" && !init) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.workflows ?? [defaultWorkflow]) });
    }
    if (init?.method === "DELETE") {
      return Promise.resolve({ ok: true });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelinesView", () => {
  it("lists existing workflows, showing the default with no Edit/Delete buttons", async () => {
    stubFetch({ workflows: [defaultWorkflow] });

    render(<PipelinesView />);

    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());
    const row = within(screen.getByTestId("workflow-row-default"));
    expect(row.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("opens the pipeline editor in create mode from 'New pipeline'", async () => {
    stubFetch({ workflows: [defaultWorkflow] });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New pipeline" }));

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("opens the pipeline editor in edit mode, pre-filled, from a row's 'Edit' button", async () => {
    stubFetch({ workflows: [defaultWorkflow, customWorkflow] });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Custom")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("workflow-row-custom-1")).getByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("Custom")).toBeInTheDocument();
  });

  it("deletes a non-default workflow", async () => {
    const fetchMock = stubFetch({ workflows: [defaultWorkflow, customWorkflow] });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Custom")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("workflow-row-custom-1")).getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/workflows/custom-1", { method: "DELETE" });
  });
});
