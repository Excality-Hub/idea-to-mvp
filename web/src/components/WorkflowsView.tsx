import { useMemo, useState } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StageNode } from "@/components/StageNode";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { buildStageEdges, buildStageNodes } from "@/lib/workflowGraph";
import { STAGE_LABELS, type StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const nodeTypes = { stage: StageNode };

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);

  const nodes = useMemo(() => buildStageNodes(eventsByStage), [eventsByStage]);
  const edges = useMemo(() => buildStageEdges(eventsByStage), [eventsByStage]);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Live pipeline stages for the current run. Click a stage to see its full log.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedStage(node.id as StageName)}
            fitView
            // All 11 stage nodes span (11 - 1) * STAGE_NODE_X_SPACING + STAGE_NODE_WIDTH = 3040px at
            // zoom 1. React Flow's default minZoom (0.5) can't zoom out far enough for fitView to fit
            // that span into a typical ~900-1000px canvas pane (would need ~0.33), so it clamps at 0.5
            // and only a subset of stages are visible on first render. Lowering minZoom lets fitView
            // zoom out as far as the math requires, even on a fairly narrow window.
            minZoom={0.1}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Controls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <StageDetailSheet
        label={selectedStage ? STAGE_LABELS[selectedStage] : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedStage(null);
        }}
      />
    </div>
  );
}
