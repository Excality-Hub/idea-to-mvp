import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ projects: [], currentProjectId: null }) }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sidebar", () => {
  it("marks the active view as current", () => {
    stubFetch();
    render(<Sidebar activeView="agents" onSelect={() => {}} selectedProjectId={null} onSelectProject={() => {}} />);

    expect(screen.getByText("Agents").closest("[aria-current]")).toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect with the clicked view", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Sidebar activeView="workflows" onSelect={onSelect} selectedProjectId={null} onSelectProject={() => {}} />,
    );

    await user.click(screen.getByText("Pipelines"));

    expect(onSelect).toHaveBeenCalledWith("pipelines");
  });

  it("still shows Runs history and Settings as disabled placeholders", () => {
    stubFetch();
    render(
      <Sidebar activeView="workflows" onSelect={() => {}} selectedProjectId={null} onSelectProject={() => {}} />,
    );

    expect(screen.getByText("Runs history")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getAllByText("Soon")).toHaveLength(2);
  });

  it("renders the project switcher in the sidebar header", () => {
    stubFetch();
    render(
      <Sidebar activeView="workflows" onSelect={() => {}} selectedProjectId={null} onSelectProject={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /idea-to-mvp/i })).toBeInTheDocument();
  });
});
