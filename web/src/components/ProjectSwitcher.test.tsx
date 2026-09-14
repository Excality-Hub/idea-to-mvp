import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./ProjectSwitcher";

const body = {
  projects: [
    { id: "p-newer", ideaText: "Build a todo app", repoName: "idea-to-mvp-2", createdAt: "2026-09-14T00:00:00.000Z" },
    { id: "p-older", ideaText: "Build a blog", repoName: "idea-to-mvp-1", createdAt: "2026-09-13T00:00:00.000Z" },
  ],
  currentProjectId: "p-newer",
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectSwitcher", () => {
  it("lists every project, marking the current one Live", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());

    await user.click(screen.getByRole("button"));

    const liveItem = await screen.findByRole("menuitem", { name: /Build a todo app.*Live/s });
    expect(liveItem).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Build a blog/ })).toBeInTheDocument();
  });

  it("calls onSelect with a past project's id when it's clicked", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId={null} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));

    await user.click(await screen.findByRole("menuitem", { name: /Build a blog/ }));

    expect(onSelect).toHaveBeenCalledWith("p-older");
  });

  it("calls onSelect with null when the live entry is clicked", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId="p-older" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));

    await user.click(await screen.findByRole("menuitem", { name: /Build a todo app.*Live/s }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("refetches the project list every time the dropdown is opened", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    const callsAfterMount = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button"));
    await screen.findByRole("menuitem", { name: /Build a blog/ });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
    const callsAfterFirstOpen = fetchMock.mock.calls.length;

    // Close the menu, then reopen it — this should trigger yet another fetch.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button"));
    await screen.findByRole("menuitem", { name: /Build a blog/ });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstOpen);
  });

  it("offers a way back to live view when viewing history and no run is currently live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            projects: [
              {
                id: "p-older",
                ideaText: "Build a blog",
                repoName: "idea-to-mvp-1",
                createdAt: "2026-09-13T00:00:00.000Z",
              },
            ],
            currentProjectId: null,
          }),
      }),
    );
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId="p-older" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));

    const backItem = await screen.findByRole("menuitem", { name: /back to live/i });
    await user.click(backItem);

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
