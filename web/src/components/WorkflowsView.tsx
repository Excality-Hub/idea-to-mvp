import { useMemo, useState } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { StageNode } from "@/components/StageNode";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { deriveOverallStatus, deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { buildStageEdges, buildStageNodes } from "@/lib/workflowGraph";
import { STAGE_LABELS, type StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const nodeTypes = { stage: StageNode };
const TERMINAL_STATUSES = new Set(["deployed", "blocked", "failed"]);

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [starting, setStarting] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);

  const nodes = useMemo(() => buildStageNodes(eventsByStage), [eventsByStage]);
  const edges = useMemo(() => buildStageEdges(eventsByStage), [eventsByStage]);
  const overallStatus = deriveOverallStatus(eventsByStage);
  const isIdle = overallStatus === "idle";
  const isTerminal = TERMINAL_STATUSES.has(overallStatus);
  const showForm = isIdle || (isTerminal && showStartForm);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  async function handleStart() {
    setStarting(true);
    try {
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText }),
      });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Live pipeline stages for the current run. Click a stage to see its full log.
          </p>
        </div>
        {isTerminal && !showStartForm && (
          <Button variant="outline" size="sm" onClick={() => setShowStartForm(true)}>
            Start a new run
          </Button>
        )}
      </div>
      {showForm ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6">
          <label htmlFor="idea-text" className="text-sm font-medium text-foreground">
            Idea &amp; requirements
          </label>
          <textarea
            id="idea-text"
            className="w-full max-w-lg rounded-lg border border-border bg-background p-3 text-sm"
            style={{ minHeight: 96 }}
            placeholder="Describe what you want to build and any specific requirements..."
            value={ideaText}
            onChange={(event) => setIdeaText(event.target.value)}
          />
          <Button onClick={handleStart} disabled={!ideaText.trim() || starting}>
            {starting ? "Starting..." : "Start run"}
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedStage(node.data.stage)}
              fitView
              // All 11 stage nodes span (11 - 1) * STAGE_NODE_X_SPACING + STAGE_NODE_WIDTH = 3040px at
              // zoom 1. React Flow's default minZoom (0.5) can't zoom out far enough for fitView to fit
              // that span into a typical ~900-1000px canvas pane (would need ~0.33), so it clamps at 0.5
              // and only a subset of stages are visible on first render. Lowering minZoom lets fitView
              // zoom out as far as the math requires, even on a fairly narrow window.
              minZoom={0.1}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              elementsSelectable={false}
            >
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      )}
      <StageDetailSheet
        label={selectedStage ? STAGE_LABELS[selectedStage as Exclude<StageName, `custom:${string}`>] : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null && !showForm}
        onOpenChange={(open) => {
          if (!open) setSelectedStage(null);
        }}
      />
    </div>
  );
}
