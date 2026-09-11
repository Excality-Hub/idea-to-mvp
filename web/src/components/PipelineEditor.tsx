import { useState } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { applyDragEnd, type DragActive, type DragOver, type SlotKey, type SlotsState } from "@/lib/pipelineEditor";
import { useAgents } from "@/hooks/useAgents";
import { STAGE_LABELS, type AgentDefinition, type StageName, type WorkflowDefinition } from "@/types";
import { cn } from "@/lib/utils";

interface PipelineEditorProps {
  initial?: WorkflowDefinition;
  onSaved: () => void;
  onCancel: () => void;
}

const EMPTY_SLOTS: SlotsState = { afterAnalyst: [], afterArchitect: [], afterQa: [] };

const SLOT_TESTID: Record<SlotKey, string> = {
  afterAnalyst: "after-analyst",
  afterArchitect: "after-architect",
  afterQa: "after-qa",
};

const SLOT_LABEL: Record<SlotKey, string> = {
  afterAnalyst: "After Analyst",
  afterArchitect: "After Architect",
  afterQa: "After QA",
};

type BackboneStage = Exclude<StageName, `custom:${string}`>;

function BackboneGroup({ stages }: { stages: BackboneStage[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, index) => (
        <div key={stage} className="flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground">&rarr;</span>}
          <div className="whitespace-nowrap rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground">
            {STAGE_LABELS[stage]}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotChip({
  slot,
  agentId,
  name,
  onRemove,
}: {
  slot: SlotKey;
  agentId: string;
  name: string;
  onRemove: (slot: SlotKey, agentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `chip:${slot}:${agentId}`,
    data: { type: "slot-item", slot, agentId } satisfies DragActive,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center justify-between gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
    >
      <span>{name}</span>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onRemove(slot, agentId)}
        aria-label={`Remove ${name} from ${SLOT_LABEL[slot]}`}
      >
        &times;
      </button>
    </div>
  );
}

function SlotZone({
  slotKey,
  agentIds,
  agentsById,
  onRemove,
}: {
  slotKey: SlotKey;
  agentIds: string[];
  agentsById: Record<string, AgentDefinition>;
  onRemove: (slot: SlotKey, agentId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${slotKey}`,
    data: { type: "slot", slot: slotKey } satisfies DragOver,
  });

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-muted-foreground">&rarr;</span>
      <div
        ref={setNodeRef}
        data-testid={`${SLOT_TESTID[slotKey]}-slot`}
        className={cn(
          "flex min-h-16 min-w-32 flex-col gap-1 rounded-lg border-2 border-dashed p-2",
          isOver ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <span className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">
          {SLOT_LABEL[slotKey]}
        </span>
        <SortableContext items={agentIds.map((agentId) => `chip:${slotKey}:${agentId}`)} strategy={verticalListSortingStrategy}>
          {agentIds.map((agentId) => (
            <SlotChip
              key={agentId}
              slot={slotKey}
              agentId={agentId}
              name={agentsById[agentId]?.name ?? agentId}
              onRemove={onRemove}
            />
          ))}
        </SortableContext>
      </div>
      <span className="text-muted-foreground">&rarr;</span>
    </div>
  );
}

function PaletteCard({ agent }: { agent: AgentDefinition }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `palette:${agent.id}`,
    data: { type: "palette", agentId: agent.id } satisfies DragActive,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground active:cursor-grabbing"
    >
      {agent.name}
    </div>
  );
}

export function PipelineEditor({ initial, onSaved, onCancel }: PipelineEditorProps) {
  const { agents, error: agentsError } = useAgents();
  const [name, setName] = useState(initial?.name ?? "");
  const [slots, setSlots] = useState<SlotsState>(initial?.slots ?? EMPTY_SLOTS);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const usedAgentIds = new Set([...slots.afterAnalyst, ...slots.afterArchitect, ...slots.afterQa]);
  const agentsById: Record<string, AgentDefinition> = Object.fromEntries(agents.map((a) => [a.id, a]));
  const paletteAgents = agents.filter((agent) => !usedAgentIds.has(agent.id));

  function removeFromSlot(slot: SlotKey, agentId: string) {
    setSlots((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== agentId) }));
  }

  function handleDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as DragActive | undefined;
    const over = event.over?.data.current as DragOver | undefined;
    if (!active) return;
    setSlots((prev) => applyDragEnd(prev, active, over));
  }

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
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
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

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex gap-6">
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-stretch gap-2 rounded-2xl border border-border bg-card p-4">
              <BackboneGroup stages={["create_repo", "analyst"]} />
              <SlotZone slotKey="afterAnalyst" agentIds={slots.afterAnalyst} agentsById={agentsById} onRemove={removeFromSlot} />
              <BackboneGroup stages={["architect"]} />
              <SlotZone slotKey="afterArchitect" agentIds={slots.afterArchitect} agentsById={agentsById} onRemove={removeFromSlot} />
              <BackboneGroup stages={["open_issue", "developer", "open_pr", "qa"]} />
              <SlotZone slotKey="afterQa" agentIds={slots.afterQa} agentsById={agentsById} onRemove={removeFromSlot} />
              <BackboneGroup stages={["post_review", "merge", "deploy", "tracing_pack"]} />
            </div>
          </div>
          <div data-testid="agent-palette" className="flex w-56 shrink-0 flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">Available agents</h2>
            {agentsError && <p className="text-sm text-destructive">{agentsError}</p>}
            {paletteAgents.map((agent) => (
              <PaletteCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      </DndContext>

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
