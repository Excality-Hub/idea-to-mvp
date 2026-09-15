import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./ProjectSwitcher";

const projects = [
  { id: "p-newer", name: "Todo app", repoName: "todo-app-1", createdAt: "2026-09-14T00:00:00.000Z" },
  { id: "p-older", name: "Blog", repoName: "blog-1", createdAt: "2026-09-13T00:00:00.000Z" },
];

function stubFetch(overrides: { list?: unknown; create?: unknown } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/projects" && !init) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.list ?? projects) });
    }
    if (url === "/api/projects" && init?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            overrides.create ?? { id: "p-new", name: "New one", repoName: "new-one-1", createdAt: "2026-09-15T00:00:00.000Z" },
          ),
      });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectSwitcher", () => {
  it("lists every project and shows the active one's name as the label", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<ProjectSwitcher activeProjectId="p-newer" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());

    expect(screen.getByText("Todo app")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));

    expect(await screen.findByRole("menuitem", { name: /Blog/ })).toBeInTheDocument();
  });

  it("calls onSelect with a project's id when it's clicked", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher activeProjectId={null} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));

    await user.click(await screen.findByRole("menuitem", { name: /Blog/ }));

    expect(onSelect).toHaveBeenCalledWith("p-older");
  });

  it("shows a fallback label and 'No projects yet' when there are none", async () => {
    stubFetch({ list: [] });
    const user = userEvent.setup();
    render(<ProjectSwitcher activeProjectId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    expect(screen.getByText("idea-to-mvp")).toBeInTheDocument();

    await user.click(screen.getByRole("button"));

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("creates a project from the inline 'New project' form and selects it", async () => {
    const fetchMock = stubFetch({
      create: { id: "p-new", name: "New idea", repoName: "new-idea-1", createdAt: "2026-09-15T00:00:00.000Z" },
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher activeProjectId={null} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: /New project/ }));

    await user.type(screen.getByLabelText("Project name"), "New idea");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New idea" }),
      }),
    );
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("p-new"));
  });

  it("refetches the project list every time the dropdown is opened", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<ProjectSwitcher activeProjectId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    const callsAfterMount = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button"));
    await screen.findByRole("menuitem", { name: /Blog/ });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});
