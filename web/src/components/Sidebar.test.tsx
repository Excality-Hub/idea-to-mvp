import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("marks the active view as current", () => {
    render(<Sidebar activeView="agents" onSelect={() => {}} />);

    expect(screen.getByText("Agents").closest("[aria-current]")).toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect with the clicked view", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar activeView="workflows" onSelect={onSelect} />);

    await user.click(screen.getByText("Pipelines"));

    expect(onSelect).toHaveBeenCalledWith("pipelines");
  });

  it("still shows Runs history and Settings as disabled placeholders", () => {
    render(<Sidebar activeView="workflows" onSelect={() => {}} />);

    expect(screen.getByText("Runs history")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getAllByText("Soon")).toHaveLength(2);
  });
});
