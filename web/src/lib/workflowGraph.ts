import type { Edge, Node } from "@xyflow/react";
import type { StageDisplayStatus } from "@/components/status";
import { deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { isCustomStage, STAGE_LABELS, type AgentDefinition, type RunEvent, type StageName } from "@/types";

export const STAGE_NODE_WIDTH = 240;
export const STAGE_NODE_X_SPACING = 280;

export interface StageNodeData extends Record<string, unknown> {
  stage: StageName;
  label: string;
  status: StageDisplayStatus;
  latestEvent: RunEvent | undefined;
}

export type StageFlowNode = Node<StageNodeData, "stage">;

export function getStageLabel(stage: StageName, agentsById: Record<string, AgentDefinition>): string {
  if (!isCustomStage(stage)) {
    return STAGE_LABELS[stage];
  }
  const agentId = stage.slice("custom:".length);
  return agentsById[agentId]?.name ?? stage;
}

export function buildStageNodes(
  eventsByStage: EventsByStage,
  stageOrder: StageName[],
  labelFor: (stage: StageName) => string,
): StageFlowNode[] {
  return stageOrder.map((stage, index) => {
    const events = eventsByStage[stage];
    return {
      id: stage,
      type: "stage",
      position: { x: index * STAGE_NODE_X_SPACING, y: 0 },
      data: {
        stage,
        label: labelFor(stage),
        status: deriveStageStatus(events),
        latestEvent: events?.[events.length - 1],
      },
    };
  });
}

export function buildStageEdges(eventsByStage: EventsByStage, stageOrder: StageName[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < stageOrder.length - 1; i++) {
    const sourceStage = stageOrder[i];
    const targetStage = stageOrder[i + 1];
    const completed = deriveStageStatus(eventsByStage[sourceStage]) === "done";
    edges.push({
      id: `${sourceStage}-${targetStage}`,
      source: sourceStage,
      target: targetStage,
      style: { stroke: completed ? "var(--success)" : "var(--border)", strokeWidth: 2 },
    });
  }
  return edges;
}
