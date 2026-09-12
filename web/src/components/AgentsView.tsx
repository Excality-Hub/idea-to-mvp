import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgents } from "@/hooks/useAgents";
import type { AgentDefinition } from "@/types";

export function AgentsView() {
  const { agents, loading, error, refetch } = useAgents();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [repoAccess, setRepoAccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [rowError, setRowError] = useState<{ id: string; message: string } | undefined>(undefined);

  async function handleCreate() {
    setFormError(undefined);
    setSubmitting(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions, repoAccess }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFormError(body.error ?? "Could not create this agent");
        return;
      }
      setName("");
      setInstructions("");
      setRepoAccess(false);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(agent: AgentDefinition) {
    setRowError(undefined);
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setRowError({ id: agent.id, message: body.error ?? "Could not delete this agent" });
      return;
    }
    refetch();
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Read-only pipeline steps you can insert into a workflow after Analyst, Architect, or QA.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New agent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="agent-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="agent-name"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="agent-instructions" className="text-sm font-medium text-foreground">
              Instructions
            </label>
            <textarea
              id="agent-instructions"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              style={{ minHeight: 80 }}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={repoAccess}
              onChange={(event) => setRepoAccess(event.target.checked)}
            />
            Give this agent repo read access
          </label>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !instructions.trim() || submitting}
            className="w-fit"
          >
            {submitting ? "Creating..." : "Create agent"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.map((agent) => (
            <li
              key={agent.id}
              data-testid={`agent-row-${agent.id}`}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{agent.name}</span>
                  {agent.repoAccess && <Badge variant="secondary">reads repo</Badge>}
                </div>
                <Button variant="outline" size="sm" onClick={() => handleDelete(agent)}>
                  Delete
                </Button>
              </div>
              <p className="truncate text-sm text-muted-foreground">{agent.instructions}</p>
              {rowError?.id === agent.id && (
                <p className="text-sm text-destructive">{rowError.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
