import { render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { StageNode } from "./StageNode";
import type { StageFlowNode } from "@/lib/workflowGraph";

const nodeTypes = { stage: StageNode };

function renderStageNode(node: StageFlowNode) {
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 400 }}>
        <ReactFlow nodes={[node]} edges={[]} nodeTypes={nodeTypes} />
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
});
