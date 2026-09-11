import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsView } from "./AgentsView";

const agent = {
  id: "a",
  name: "Security Reviewer",
  instructions: "Look for auth bypass issues.",
  repoAccess: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentsView", () => {
  it("lists existing agents with a repo-access indicator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([agent]) }));

    render(<AgentsView />);

    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());
    expect(screen.getByText(/reads repo/i)).toBeInTheDocument();
  });

  it("creates a new agent and shows it in the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial GET
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(agent) }) // POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) }); // refetch GET
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "Security Reviewer");
    await user.type(screen.getByLabelText("Instructions"), "Look for auth bypass issues.");
    await user.click(screen.getByLabelText(/repo read access/i));
    await user.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Security Reviewer",
        instructions: "Look for auth bypass issues.",
        repoAccess: true,
      }),
    });
  });

  it("deletes an agent when its delete button is clicked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) }) // initial GET
      .mockResolvedValueOnce({ ok: true }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }); // refetch GET
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("agent-row-a")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/a", { method: "DELETE" });
  });

  it("shows an error message when deleting an in-use agent fails with 409", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({ error: "Agent is used by a workflow" }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("agent-row-a")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText("Agent is used by a workflow")).toBeInTheDocument());
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });
});
