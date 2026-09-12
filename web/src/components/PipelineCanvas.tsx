import { useCallback, useMemo, useState } from "react";
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/hooks/useAgents";
import {
  buildPipelineGraph,
  insertAgent,
  removeAgent,
  type BackboneNodeData,
  type CustomAgentNodeData,
  type InsertionPointNodeData,
  type PipelineFlowNode,
  type SlotsState,
} from "@/lib/pipelineCanvas";
import { cn } from "@/lib/utils";
import type { AgentDefinition, BackboneStage, WorkflowDefinition } from "@/types";

const AGENT_DND_TYPE = "application/x-agent-id";

interface PipelineCanvasProps {
  initial?: WorkflowDefinition;
  onSaved: () => void;
  onCancel: () => void;
}

function BackboneNode({ data }: NodeProps<PipelineFlowNode>) {
  const { label } = data as BackboneNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="nodrag whitespace-nowrap rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground">
        {label}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}

function CustomAgentNode({ data }: NodeProps<PipelineFlowNode>) {
  const { name, onRemove } = data as CustomAgentNodeData & { onRemove: () => void };
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        className="nodrag flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-foreground"
        style={{ pointerEvents: "auto" }}
      >
        <span>{name}</span>
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
          &times;
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}

function InsertionPointNode({ data }: NodeProps<PipelineFlowNode>) {
  const { afterStage, index, onDropAgent } = data as InsertionPointNodeData & { onDropAgent: (agentId: string) => void };
  const [isOver, setIsOver] = useState(false);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        data-testid={`insertion-${afterStage}-${index}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          const agentId = event.dataTransfer.getData(AGENT_DND_TYPE);
          if (agentId) onDropAgent(agentId);
        }}
        className={cn(
          "nodrag flex size-7 items-center justify-center rounded-full border-2 border-dashed text-sm text-muted-foreground",
          isOver ? "border-primary bg-primary/10 text-primary" : "border-border",
        )}
        style={{ pointerEvents: "auto" }}
      >
        +
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}

function EndNode() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="nodrag rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground">
        End
      </div>
    </>
  );
}

const nodeTypes = { backbone: BackboneNode, custom: CustomAgentNode, insertion: InsertionPointNode, end: EndNode };

// Pre-set each node's measured size so React Flow treats it as already
// measured on first render. Without this, nodes stay `visibility: hidden`
// until a ResizeObserver callback fires — which never happens under jsdom in
// tests — hiding their contents from the accessibility tree (role queries).
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  backbone: { width: 140, height: 36 },
  custom: { width: 140, height: 32 },
  insertion: { width: 28, height: 28 },
  end: { width: 70, height: 36 },
};

function PaletteCard({ agent }: { agent: AgentDefinition }) {
  return (
    <div
      draggable
      onDragStart={(event) => event.dataTransfer.setData(AGENT_DND_TYPE, agent.id)}
      className="cursor-grab rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground active:cursor-grabbing"
    >
      {agent.name}
    </div>
  );
}

export function PipelineCanvas({ initial, onSaved, onCancel }: PipelineCanvasProps) {
  const { agents, error: agentsError } = useAgents();
  const [name, setName] = useState(initial?.name ?? "");
  const [slots, setSlots] = useState<SlotsState>(initial?.slots ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const agentsById = useMemo(() => Object.fromEntries(agents.map((agent) => [agent.id, agent])), [agents]);
  const usedAgentIds = useMemo(() => new Set(Object.values(slots).flat()), [slots]);
  const paletteAgents = agents.filter((agent) => !usedAgentIds.has(agent.id));

  const handleInsert = useCallback((afterStage: BackboneStage, index: number, agentId: string) => {
    setSlots((prev) => insertAgent(prev, afterStage, index, agentId));
  }, []);
  const handleRemove = useCallback((afterStage: BackboneStage, agentId: string) => {
    setSlots((prev) => removeAgent(prev, afterStage, agentId));
  }, []);

  const graph = useMemo(() => buildPipelineGraph(slots, agentsById), [slots, agentsById]);
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        const dimensions = NODE_DIMENSIONS[node.type ?? ""];
        if (node.type === "insertion") {
          const data = node.data as InsertionPointNodeData;
          return {
            ...node,
            ...dimensions,
            data: { ...data, onDropAgent: (agentId: string) => handleInsert(data.afterStage, data.index, agentId) },
          };
        }
        if (node.type === "custom") {
          const data = node.data as CustomAgentNodeData;
          return {
            ...node,
            ...dimensions,
            data: { ...data, onRemove: () => handleRemove(data.afterStage, data.agentId) },
          };
        }
        return { ...node, ...dimensions };
      }),
    [graph.nodes, handleInsert, handleRemove],
  );

  async function handleSave() {
    setFormError(undefined);
    setSubmitting(true);
    try {
      const url = initial ? `/api/workflows/${initial.id}` : "/api/workflows";
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slots }),
      });
      if (!res.ok) {
        let message = "Could not save this pipeline";
        try {
          const body = (await res.json()) as { error?: string };
          message = body.error ?? message;
        } catch {
          // response body wasn't JSON (e.g. a proxy's HTML error page) — keep the fallback message
        }
        setFormError(message);
        return;
      }
      onSaved();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="pipeline-name" className="text-sm font-medium text-foreground">
          Name
        </label>
        <input
          id="pipeline-name"
          className="w-full max-w-sm rounded-lg border border-border bg-background p-2 text-sm"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
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
        <div data-testid="agent-palette" className="flex w-56 shrink-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Available agents</h2>
          {agentsError && <p className="text-sm text-destructive">{agentsError}</p>}
          {paletteAgents.map((agent) => (
            <PaletteCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={!name.trim() || submitting}>
          {submitting ? "Saving..." : "Save pipeline"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
