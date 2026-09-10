import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { StageNode } from "./StageNode";
import { STAGE_NODE_WIDTH, type StageFlowNode } from "@/lib/workflowGraph";

const nodeTypes = { stage: StageNode };

function renderStageNode(node: StageFlowNode) {
  // Give the node explicit dimensions so React Flow treats it as already
  // measured. Without this it stays `visibility: hidden` until a
  // ResizeObserver callback fires, which jsdom's test-env stub never does —
  // that would make every element's accessible name compute as empty.
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 400 }}>
        <ReactFlow nodes={[{ ...node, width: STAGE_NODE_WIDTH, height: 88 }]} edges={[]} nodeTypes={nodeTypes} />
      </div>
    </ReactFlowProvider>,
  );
}

describe("StageNode", () => {
  it("renders the stage label, status, and latest message", () => {
    renderStageNode({
      id: "analyst",
      type: "stage",
      position: { x: 0, y: 0 },
      data: {
        stage: "analyst",
        label: "Analyst",
        status: "done",
        latestEvent: {
          stage: "analyst",
          status: "done",
          message: "Todo app summary",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      },
    });

    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Todo app summary")).toBeInTheDocument();
  });

  it("shows the waiting placeholder for a pending stage with no events", () => {
    renderStageNode({
      id: "deploy",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "deploy", label: "Deploy", status: "pending", latestEvent: undefined },
    });

    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Waiting for this stage to start")).toBeInTheDocument();
  });

  it("shows a Stop button for a running agent stage", () => {
    renderStageNode({
      id: "developer",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "developer", label: "Developer", status: "running", latestEvent: undefined },
    });

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("shows a Resume button for a stopped agent stage", () => {
    renderStageNode({
      id: "developer",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "developer", label: "Developer", status: "stopped", latestEvent: undefined },
    });

    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows no Stop/Resume button for a running non-agent stage", () => {
    renderStageNode({
      id: "deploy",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "deploy", label: "Deploy", status: "running", latestEvent: undefined },
    });

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("posts to /api/run/stop when Stop is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderStageNode({
      id: "developer",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "developer", label: "Developer", status: "running", latestEvent: undefined },
    });

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/run/stop", { method: "POST" });
    vi.unstubAllGlobals();
  });
});
