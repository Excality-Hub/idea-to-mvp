import { describe, expect, it } from "vitest";
import { buildPipelineGraph, insertAgent, removeAgent, type SlotsState } from "./pipelineCanvas";
import type { AgentDefinition } from "@/types";

const agentA: AgentDefinition = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB: AgentDefinition = { id: "b", name: "Agent B", instructions: "do b", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentsById = { a: agentA, b: agentB };

describe("buildPipelineGraph", () => {
  it("produces 11 backbone nodes, 10 insertion points, and 1 end node for empty slots", () => {
    const { nodes, edges } = buildPipelineGraph({}, agentsById);

    expect(nodes.filter((n) => n.type === "backbone")).toHaveLength(11);
    expect(nodes.filter((n) => n.type === "insertion")).toHaveLength(10);
    expect(nodes.filter((n) => n.type === "custom")).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "end")).toHaveLength(1);
    expect(edges).toHaveLength(nodes.length - 1);
    expect(nodes[0].id).toBe("backbone:create_repo");
    expect(nodes[nodes.length - 1].id).toBe("end");
  });

  it("renders tracing_pack as a backbone box with no insertion point after it — nothing can run past the final step", () => {
    const { nodes } = buildPipelineGraph({}, agentsById);

    const ids = nodes.map((n) => n.id);
    const tracingPackIndex = ids.indexOf("backbone:tracing_pack");
    expect(tracingPackIndex).toBeGreaterThan(-1);
    expect(ids[tracingPackIndex + 1]).toBe("end");
  });

  it("brackets each stage's custom agents with insertion points, in array order", () => {
    const slots: SlotsState = { analyst: ["a", "b"] };

    const { nodes } = buildPipelineGraph(slots, agentsById);

    const ids = nodes.map((n) => n.id);
    const analystIndex = ids.indexOf("backbone:analyst");
    expect(ids.slice(analystIndex, analystIndex + 5)).toEqual([
      "backbone:analyst",
      "insertion:analyst:0",
      "custom:analyst:0:a",
      "insertion:analyst:1",
      "custom:analyst:1:b",
    ]);
    expect(ids[analystIndex + 5]).toBe("insertion:analyst:2");
    expect(ids[analystIndex + 6]).toBe("backbone:architect");
  });

  it("resolves a custom node's display name from agentsById, falling back to the raw id", () => {
    const { nodes } = buildPipelineGraph({ qa: ["a", "unknown-id"] }, agentsById);

    const customNodes = nodes.filter((n) => n.type === "custom");
    expect(customNodes.map((n) => n.data.name)).toEqual(["Agent A", "unknown-id"]);
  });
});

describe("insertAgent", () => {
  it("appends to an empty stage", () => {
    expect(insertAgent({}, "analyst", 0, "a")).toEqual({ analyst: ["a"] });
  });

  it("inserts at a given index within an existing chain", () => {
    const slots: SlotsState = { analyst: ["a"] };
    expect(insertAgent(slots, "analyst", 0, "b")).toEqual({ analyst: ["b", "a"] });
    expect(insertAgent(slots, "analyst", 1, "b")).toEqual({ analyst: ["a", "b"] });
  });

  it("does not mutate other stages", () => {
    const slots: SlotsState = { analyst: ["a"], qa: ["b"] };
    const original = { analyst: ["a"], qa: ["b"] };
    expect(insertAgent(slots, "qa", 1, "a")).toEqual({ analyst: ["a"], qa: ["b", "a"] });
    expect(slots).toEqual(original);
  });
});

describe("removeAgent", () => {
  it("removes an agent from its stage", () => {
    const slots: SlotsState = { analyst: ["a", "b"] };
    expect(removeAgent(slots, "analyst", "a")).toEqual({ analyst: ["b"] });
    expect(removeAgent({ analyst: ["a"] }, "analyst", "a")).toEqual({});
    expect(slots).toEqual({ analyst: ["a", "b"] });
  });

  it("is a no-op when the agent isn't in that stage", () => {
    const slots: SlotsState = { analyst: ["a"] };
    expect(removeAgent(slots, "analyst", "missing")).toEqual({ analyst: ["a"] });
  });
});
