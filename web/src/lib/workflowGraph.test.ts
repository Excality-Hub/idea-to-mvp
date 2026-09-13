import { describe, expect, it } from "vitest";
import { buildStageEdges, buildStageNodes, getStageLabel, STAGE_NODE_X_SPACING } from "./workflowGraph";
import type { EventsByStage } from "./runEvents";
import { STAGE_LABELS, STAGE_ORDER, type AgentDefinition, type StageName } from "@/types";

const labelFor = (stage: StageName) =>
  stage in STAGE_LABELS ? STAGE_LABELS[stage as keyof typeof STAGE_LABELS] : stage;

describe("buildStageNodes", () => {
  it("builds one node per stage in the given order", () => {
    const nodes = buildStageNodes({}, STAGE_ORDER, labelFor);
    expect(nodes).toHaveLength(11);
    expect(nodes[0]).toMatchObject({ id: "create_repo", type: "stage", position: { x: 0, y: 0 } });
    expect(nodes[1].position).toEqual({ x: STAGE_NODE_X_SPACING, y: 0 });
    expect(nodes[10]).toMatchObject({ id: "tracing_pack" });
  });

  it("derives pending status and no latest event for a stage with no events", () => {
    const nodes = buildStageNodes({}, STAGE_ORDER, labelFor);
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
    const nodes = buildStageNodes(eventsByStage, STAGE_ORDER, labelFor);
    const analyst = nodes.find((n) => n.id === "analyst");
    expect(analyst?.data.status).toBe("done");
    expect(analyst?.data.latestEvent?.message).toBe("Todo app summary");
  });

  it("builds a node for a custom stage using the given label resolver", () => {
    const order: StageName[] = ["analyst", "custom:sec-1", "architect"];
    const nodes = buildStageNodes({}, order, () => "Security Reviewer");
    expect(nodes[1]).toMatchObject({ id: "custom:sec-1", data: { label: "Security Reviewer" } });
  });
});

describe("buildStageEdges", () => {
  it("connects each stage to the next in the given order", () => {
    const edges = buildStageEdges({}, STAGE_ORDER);
    expect(edges).toHaveLength(10);
    expect(edges[0]).toMatchObject({ source: "create_repo", target: "analyst" });
    expect(edges[9]).toMatchObject({ source: "deploy", target: "tracing_pack" });
  });

  it("colors an edge muted when its source stage hasn't completed", () => {
    const edges = buildStageEdges({}, STAGE_ORDER);
    expect(edges[0]).toMatchObject({ style: { stroke: "var(--border)" } });
  });

  it("colors an edge with the success color once its source stage is done", () => {
    const eventsByStage: EventsByStage = {
      create_repo: [
        { stage: "create_repo", status: "done", message: "Repo created", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const edges = buildStageEdges(eventsByStage, STAGE_ORDER);
    expect(edges[0]).toMatchObject({
      source: "create_repo",
      target: "analyst",
      style: { stroke: "var(--success)" },
    });
  });
});

describe("getStageLabel", () => {
  const agentsById: Record<string, AgentDefinition> = {
    "sec-1": {
      id: "sec-1",
      name: "Security Reviewer",
      instructions: "check for bugs",
      repoAccess: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };

  it("returns the backbone label for a fixed stage", () => {
    expect(getStageLabel("analyst", agentsById)).toBe("Analyst");
  });

  it("returns the agent's name for a custom stage with a known agent", () => {
    expect(getStageLabel("custom:sec-1", agentsById)).toBe("Security Reviewer");
  });

  it("falls back to the raw stage id for a custom stage with an unknown agent", () => {
    expect(getStageLabel("custom:missing", agentsById)).toBe("custom:missing");
  });
});
