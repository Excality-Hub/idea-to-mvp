import { useMemo, useState } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { StageNode } from "@/components/StageNode";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { useAgents } from "@/hooks/useAgents";
import { useRunPlan } from "@/hooks/useRunPlan";
import { useWorkflows } from "@/hooks/useWorkflows";
import { deriveOverallStatus, deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { buildStageEdges, buildStageNodes, getStageLabel } from "@/lib/workflowGraph";
import type { StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const nodeTypes = { stage: StageNode };
const TERMINAL_STATUSES = new Set(["deployed", "blocked", "failed"]);

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [workflowId, setWorkflowId] = useState("default");
  const [starting, setStarting] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);
  const [runGeneration, setRunGeneration] = useState(0);

  const overallStatus = deriveOverallStatus(eventsByStage);
  const isIdle = overallStatus === "idle";
  const isTerminal = TERMINAL_STATUSES.has(overallStatus);
  const showForm = isIdle || (isTerminal && showStartForm);

  const { workflows, error: workflowsError } = useWorkflows();
  const { agents } = useAgents();
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const stageOrder = useRunPlan(isIdle, runGeneration);
  const labelFor = useMemo(() => (stage: StageName) => getStageLabel(stage, agentsById), [agentsById]);

  const nodes = useMemo(() => buildStageNodes(eventsByStage, stageOrder, labelFor), [eventsByStage, stageOrder, labelFor]);
  const edges = useMemo(() => buildStageEdges(eventsByStage, stageOrder), [eventsByStage, stageOrder]);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  async function handleStart() {
    setStarting(true);
    try {
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText, workflowId }),
      });
      setRunGeneration((g) => g + 1);
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
          <div className="flex w-full max-w-lg flex-col gap-1">
            <label htmlFor="pipeline-picker" className="text-sm font-medium text-foreground">
              Pipeline
            </label>
            <select
              id="pipeline-picker"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={workflowId}
              onChange={(event) => setWorkflowId(event.target.value)}
            >
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
            {workflowsError && <p className="text-sm text-destructive">{workflowsError}</p>}
          </div>
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
        </div>
      )}
      <StageDetailSheet
        label={selectedStage ? labelFor(selectedStage) : undefined}
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
