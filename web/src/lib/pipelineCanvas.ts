import type { Edge, Node } from "@xyflow/react";
import {
  BACKBONE_STAGE_IO,
  BACKBONE_STAGES,
  isGateEntry,
  parseGateId,
  STAGE_LABELS,
  STAGE_ORDER,
  type AgentDefinition,
  type BackboneStage,
  type DataKind,
} from "@/types";

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
  missingInputs: DataKind[];
}

export interface GateNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
  gateId: string;
}

export interface InsertionPointNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
}

export type EndNodeData = Record<string, unknown>;

export type PipelineNodeData = BackboneNodeData | CustomAgentNodeData | GateNodeData | InsertionPointNodeData | EndNodeData;
export type PipelineFlowNode = Node<PipelineNodeData>;

export function computeMissingInputs(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): Map<string, DataKind[]> {
  const missing = new Map<string, DataKind[]>();
  const available = new Set<DataKind>(["idea_text"]);
  for (const stage of BACKBONE_STAGES) {
    BACKBONE_STAGE_IO[stage].outputs.forEach((kind) => available.add(kind));
    const entries = slots[stage] ?? [];
    entries.forEach((entry, index) => {
      if (isGateEntry(entry)) return;
      const agent = agentsById[entry];
      const needed = agent?.inputs ?? [];
      const unmet = needed.filter((kind) => !available.has(kind));
      if (unmet.length > 0) {
        missing.set(`custom:${stage}:${index}:${entry}`, unmet);
      }
      (agent?.outputs ?? []).forEach((kind) => available.add(kind));
    });
  }
  return missing;
}

export function buildPipelineGraph(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): { nodes: PipelineFlowNode[]; edges: Edge[] } {
  const nodes: PipelineFlowNode[] = [];
  const edges: Edge[] = [];
  const missingInputsByNodeId = computeMissingInputs(slots, agentsById);
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
    const entries = slots[backboneStage] ?? [];
    pushNode(`insertion:${backboneStage}:0`, "insertion", { afterStage: backboneStage, index: 0 });
    entries.forEach((entry, index) => {
      if (isGateEntry(entry)) {
        const gateId = parseGateId(entry);
        pushNode(`gate:${backboneStage}:${index}:${gateId}`, "gate", { afterStage: backboneStage, index, gateId });
      } else {
        const nodeId = `custom:${backboneStage}:${index}:${entry}`;
        pushNode(nodeId, "custom", {
          afterStage: backboneStage,
          index,
          agentId: entry,
          name: agentsById[entry]?.name ?? entry,
          missingInputs: missingInputsByNodeId.get(nodeId) ?? [],
        });
      }
      pushNode(`insertion:${backboneStage}:${index + 1}`, "insertion", { afterStage: backboneStage, index: index + 1 });
    });
  }
  pushNode("end", "end", {});

  return { nodes, edges };
}

export function insertEntry(slots: SlotsState, afterStage: BackboneStage, index: number, entry: string): SlotsState {
  const current = slots[afterStage] ?? [];
  const next = [...current.slice(0, index), entry, ...current.slice(index)];
  return { ...slots, [afterStage]: next };
}

export function removeEntry(slots: SlotsState, afterStage: BackboneStage, entry: string): SlotsState {
  const current = slots[afterStage] ?? [];
  const next = current.filter((id) => id !== entry);
  const { [afterStage]: _removed, ...rest } = slots;
  return next.length > 0 ? { ...rest, [afterStage]: next } : rest;
}
