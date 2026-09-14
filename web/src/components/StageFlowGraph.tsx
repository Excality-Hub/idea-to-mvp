import { useMemo } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StageNode } from "@/components/StageNode";
import { buildStageEdges, buildStageNodes } from "@/lib/workflowGraph";
import type { EventsByStage } from "@/lib/runEvents";
import type { StageName } from "@/types";

const nodeTypes = { stage: StageNode };

export interface StageFlowGraphProps {
  eventsByStage: EventsByStage;
  stageOrder: StageName[];
  labelFor: (stage: StageName) => string;
  onSelectStage: (stage: StageName) => void;
  readOnly?: boolean;
}

export function StageFlowGraph({ eventsByStage, stageOrder, labelFor, onSelectStage, readOnly = false }: StageFlowGraphProps) {
  const nodes = useMemo(
    () => buildStageNodes(eventsByStage, stageOrder, labelFor, readOnly),
    [eventsByStage, stageOrder, labelFor, readOnly],
  );
  const edges = useMemo(() => buildStageEdges(eventsByStage, stageOrder), [eventsByStage, stageOrder]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectStage(node.data.stage)}
        fitView
        // Node count varies with the resolved plan; minZoom is lowered so fitView can
        // always zoom out far enough to frame every stage, however many there are.
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
