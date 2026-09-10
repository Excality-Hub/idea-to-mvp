import { describe, expect, it } from "vitest";
import { buildStageEdges, buildStageNodes, STAGE_NODE_X_SPACING } from "./workflowGraph";
import type { EventsByStage } from "./runEvents";

describe("buildStageNodes", () => {
  it("builds one node per pipeline stage, left-to-right by STAGE_ORDER", () => {
    const nodes = buildStageNodes({});
    expect(nodes).toHaveLength(11);
    expect(nodes[0]).toMatchObject({ id: "create_repo", type: "stage", position: { x: 0, y: 0 } });
    expect(nodes[1].position).toEqual({ x: STAGE_NODE_X_SPACING, y: 0 });
    expect(nodes[10]).toMatchObject({ id: "tracing_pack" });
  });

  it("derives pending status and no latest event for a stage with no events", () => {
    const nodes = buildStageNodes({});
    const analyst = nodes.find((n) => n.id === "analyst");
    expect(analyst?.data.status).toBe("pending");
    expect(analyst?.data.latestEvent).toBeUndefined();
  });

  it("derives status and latest event from the stage's most recent event", () => {
    const eventsByStage: EventsByStage = {
      analyst: [
        { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
        { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
      ],
    };
    const nodes = buildStageNodes(eventsByStage);
    const analyst = nodes.find((n) => n.id === "analyst");
    expect(analyst?.data.status).toBe("done");
    expect(analyst?.data.latestEvent?.message).toBe("Todo app summary");
  });
});

describe("buildStageEdges", () => {
  it("connects each stage to the next in STAGE_ORDER", () => {
    const edges = buildStageEdges({});
    expect(edges).toHaveLength(10);
    expect(edges[0]).toMatchObject({ source: "create_repo", target: "analyst" });
    expect(edges[9]).toMatchObject({ source: "deploy", target: "tracing_pack" });
  });

  it("colors an edge muted when its source stage hasn't completed", () => {
    const edges = buildStageEdges({});
    expect(edges[0].style).toMatchObject({ stroke: "var(--border)" });
  });

  it("colors an edge with the success color once its source stage is done", () => {
    const eventsByStage: EventsByStage = {
      create_repo: [
        { stage: "create_repo", status: "done", message: "Repo created", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const edges = buildStageEdges(eventsByStage);
    expect(edges[0]).toMatchObject({
      source: "create_repo",
      target: "analyst",
      style: { stroke: "var(--success)" },
    });
  });
});
