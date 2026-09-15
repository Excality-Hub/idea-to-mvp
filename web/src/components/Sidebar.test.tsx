import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sidebar", () => {
  it("marks the active view as current", () => {
    stubFetch();
    render(<Sidebar activeView="agents" onSelect={() => {}} activeProjectId={null} onSelectProject={() => {}} />);

    expect(screen.getByText("Agents").closest("[aria-current]")).toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect with the clicked view", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar activeView="workflows" onSelect={onSelect} activeProjectId={null} onSelectProject={() => {}} />);

    await user.click(screen.getByText("Pipelines"));

    expect(onSelect).toHaveBeenCalledWith("pipelines");
  });

  it("treats Runs history as a clickable nav item, not a disabled placeholder", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar activeView="workflows" onSelect={onSelect} activeProjectId={null} onSelectProject={() => {}} />);

    await user.click(screen.getByText("Runs history"));

    expect(onSelect).toHaveBeenCalledWith("runs");
  });

  it("still shows Settings as a disabled placeholder", () => {
    stubFetch();
    render(<Sidebar activeView="workflows" onSelect={() => {}} activeProjectId={null} onSelectProject={() => {}} />);

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getAllByText("Soon")).toHaveLength(1);
  });

  it("renders the project switcher in the sidebar header", () => {
    stubFetch();
    render(<Sidebar activeView="workflows" onSelect={() => {}} activeProjectId={null} onSelectProject={() => {}} />);

    expect(screen.getByRole("button", { name: /idea-to-mvp/i })).toBeInTheDocument();
  });
});
