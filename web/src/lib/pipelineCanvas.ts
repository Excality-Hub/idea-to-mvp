import type { Edge, Node } from "@xyflow/react";
import { BACKBONE_STAGES, STAGE_LABELS, STAGE_ORDER, type AgentDefinition, type BackboneStage } from "@/types";

const SPLICEABLE_STAGES = new Set<string>(BACKBONE_STAGES);

export type SlotsState = Partial<Record<BackboneStage, string[]>>;

export const PIPELINE_NODE_X_SPACING = 180;

export interface BackboneNodeData extends Record<string, unknown> {
  stage: BackboneStage;
  label: string;
}

export interface CustomAgentNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
  agentId: string;
  name: string;
}

export interface InsertionPointNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
}

export type EndNodeData = Record<string, unknown>;

export type PipelineNodeData = BackboneNodeData | CustomAgentNodeData | InsertionPointNodeData | EndNodeData;
export type PipelineFlowNode = Node<PipelineNodeData>;

export function buildPipelineGraph(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): { nodes: PipelineFlowNode[]; edges: Edge[] } {
  const nodes: PipelineFlowNode[] = [];
  const edges: Edge[] = [];
  let previousId: string | undefined;
  let x = 0;

  function pushNode(id: string, type: string, data: PipelineNodeData) {
    nodes.push({ id, type, position: { x, y: 0 }, data });
    x += PIPELINE_NODE_X_SPACING;
    if (previousId) {
      edges.push({ id: `${previousId}->${id}`, source: previousId, target: id });
    }
    previousId = id;
  }

  for (const stage of STAGE_ORDER) {
    pushNode(`backbone:${stage}`, "backbone", { stage: stage as BackboneStage, label: STAGE_LABELS[stage as BackboneStage] });
    if (!SPLICEABLE_STAGES.has(stage)) continue; // e.g. tracing_pack: nothing can run after it, so no insertion point
    const backboneStage = stage as BackboneStage;
    const agentIds = slots[backboneStage] ?? [];
    pushNode(`insertion:${backboneStage}:0`, "insertion", { afterStage: backboneStage, index: 0 });
    agentIds.forEach((agentId, index) => {
      pushNode(`custom:${backboneStage}:${index}:${agentId}`, "custom", {
        afterStage: backboneStage,
        index,
        agentId,
        name: agentsById[agentId]?.name ?? agentId,
      });
      pushNode(`insertion:${backboneStage}:${index + 1}`, "insertion", { afterStage: backboneStage, index: index + 1 });
    });
  }
  pushNode("end", "end", {});

  return { nodes, edges };
}

export function insertAgent(slots: SlotsState, afterStage: BackboneStage, index: number, agentId: string): SlotsState {
  const current = slots[afterStage] ?? [];
  const next = [...current.slice(0, index), agentId, ...current.slice(index)];
  return { ...slots, [afterStage]: next };
}

export function removeAgent(slots: SlotsState, afterStage: BackboneStage, agentId: string): SlotsState {
  const current = slots[afterStage] ?? [];
  return { ...slots, [afterStage]: current.filter((id) => id !== agentId) };
}
