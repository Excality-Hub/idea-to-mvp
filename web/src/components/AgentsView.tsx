import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgents } from "@/hooks/useAgents";
import { analyzeInstructions, type InstructionAnalysis } from "@/lib/instructionAnalysis";
import { DATA_KINDS, DATA_KIND_LABELS, type AgentDefinition, type DataKind } from "@/types";

export function AgentsView() {
  const { agents, loading, error, refetch } = useAgents();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [repoAccess, setRepoAccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [rowError, setRowError] = useState<{ id: string; message: string } | undefined>(undefined);
  const [analysis, setAnalysis] = useState<InstructionAnalysis | undefined>(undefined);
  const [inputs, setInputs] = useState<DataKind[]>([]);
  const [outputs, setOutputs] = useState<DataKind[]>([]);

  function toggle(list: DataKind[], kind: DataKind): DataKind[] {
    return list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind];
  }

  async function handleCreate() {
    setFormError(undefined);
    setSubmitting(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions, repoAccess, inputs, outputs }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFormError(body.error ?? "Could not create this agent");
        return;
      }
      setName("");
      setInstructions("");
      setRepoAccess(false);
      setInputs([]);
      setOutputs([]);
      setAnalysis(undefined);
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
              onChange={(event) => {
                setInstructions(event.target.value);
                setAnalysis(undefined);
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={repoAccess}
              onChange={(event) => {
                setRepoAccess(event.target.checked);
                setAnalysis(undefined);
              }}
            />
            Give this agent repo read access
          </label>
          <div data-testid="agent-inputs" className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Needs</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {DATA_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={inputs.includes(kind)}
                    onChange={() => setInputs((prev) => toggle(prev, kind))}
                  />
                  {DATA_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>
          <div data-testid="agent-outputs" className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Produces</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {DATA_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={outputs.includes(kind)}
                    onChange={() => setOutputs((prev) => toggle(prev, kind))}
                  />
                  {DATA_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => setAnalysis(analyzeInstructions(instructions, repoAccess))}
            disabled={!instructions.trim()}
            className="w-fit"
          >
            Analyze instructions
          </Button>
          {analysis && (
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/50 p-3 text-sm">
              <p>~{analysis.tokenEstimate} tokens · {analysis.wordCount} words</p>
              <p>Complexity: {analysis.complexityLabel}</p>
              <p>Clarity: {analysis.clarityScore}/100</p>
              <p>Cost tier: {analysis.costTier}</p>
              {analysis.riskFlags.length === 0 ? (
                <p className="text-muted-foreground">No risk flags detected.</p>
              ) : (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {analysis.riskFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
