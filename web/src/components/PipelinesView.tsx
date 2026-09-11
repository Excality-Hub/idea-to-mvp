import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgents } from "@/hooks/useAgents";
import { useWorkflows } from "@/hooks/useWorkflows";
import type { AgentDefinition, WorkflowDefinition } from "@/types";

type SlotKey = "afterAnalyst" | "afterArchitect" | "afterQa";

const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "afterAnalyst", label: "After Analyst" },
  { key: "afterArchitect", label: "After Architect" },
  { key: "afterQa", label: "After QA" },
];

export function PipelinesView() {
  const { agents, error: agentsError } = useAgents();
  const { workflows, loading, error: workflowsError, refetch } = useWorkflows();
  const [name, setName] = useState("");
  const [slots, setSlots] = useState<Record<SlotKey, string[]>>({
    afterAnalyst: [],
    afterArchitect: [],
    afterQa: [],
  });
  const [pendingPick, setPendingPick] = useState<Record<SlotKey, string>>({
    afterAnalyst: "",
    afterArchitect: "",
    afterQa: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const usedAgentIds = new Set([...slots.afterAnalyst, ...slots.afterArchitect, ...slots.afterQa]);
  const agentsById: Record<string, AgentDefinition> = Object.fromEntries(agents.map((a) => [a.id, a]));

  function addToSlot(slot: SlotKey) {
    const agentId = pendingPick[slot];
    if (!agentId) return;
    setSlots((prev) => ({ ...prev, [slot]: [...prev[slot], agentId] }));
    setPendingPick((prev) => ({ ...prev, [slot]: "" }));
  }

  function removeFromSlot(slot: SlotKey, agentId: string) {
    setSlots((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== agentId) }));
  }

  async function handleCreate() {
    setFormError(undefined);
    setSubmitting(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slots }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFormError(body.error ?? "Could not create this pipeline");
        return;
      }
      setName("");
      setSlots({ afterAnalyst: [], afterArchitect: [], afterQa: [] });
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(workflow: WorkflowDefinition) {
    await fetch(`/api/workflows/${workflow.id}`, { method: "DELETE" });
    refetch();
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Pipelines</h1>
        <p className="text-sm text-muted-foreground">
          Named arrangements of agents around the fixed pipeline backbone.
        </p>
        {agentsError && <p className="text-sm text-destructive">{agentsError}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New pipeline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="pipeline-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="pipeline-name"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {SLOTS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`slot-${key}`} className="text-sm font-medium text-foreground">
                {label}
              </label>
              <div className="flex gap-2">
                <select
                  id={`slot-${key}`}
                  className="rounded-lg border border-border bg-background p-2 text-sm"
                  value={pendingPick[key]}
                  onChange={(event) => setPendingPick((prev) => ({ ...prev, [key]: event.target.value }))}
                >
                  <option value="">Select an agent…</option>
                  {agents
                    .filter((agent) => !usedAgentIds.has(agent.id))
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => addToSlot(key)}>
                  {`Add to ${label}`}
                </Button>
              </div>
              <ul data-testid={`${key === "afterAnalyst" ? "after-analyst" : key === "afterArchitect" ? "after-architect" : "after-qa"}-slot`} className="flex flex-wrap gap-2">
                {slots[key].map((agentId) => (
                  <li
                    key={agentId}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    {agentsById[agentId]?.name ?? agentId}
                    <button type="button" onClick={() => removeFromSlot(key, agentId)} aria-label={`Remove ${agentsById[agentId]?.name ?? agentId} from ${label}`}>
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button onClick={handleCreate} disabled={!name.trim() || submitting} className="w-fit">
            {submitting ? "Creating..." : "Create pipeline"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workflowsError ? (
        <p className="text-sm text-destructive">{workflowsError}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {workflows.map((workflow) => (
            <li
              key={workflow.id}
              data-testid={`workflow-row-${workflow.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="font-medium text-foreground">{workflow.name}</span>
              {workflow.id !== "default" && (
                <Button variant="outline" size="sm" onClick={() => handleDelete(workflow)}>
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
