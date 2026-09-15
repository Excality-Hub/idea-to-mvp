import { useState } from "react";
import { Bot, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAgents } from "@/hooks/useAgents";
import { analyzeInstructions, type InstructionAnalysis } from "@/lib/instructionAnalysis";
import { DATA_KINDS, DATA_KIND_LABELS, type AgentDefinition, type DataKind } from "@/types";

interface PillCheckboxProps {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}

function PillCheckbox({ id, checked, onChange, label }: PillCheckboxProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/30 p-2.5 text-sm text-foreground"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

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
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-6 overflow-y-auto p-4 lg:p-7">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only pipeline steps you can insert into a workflow after Analyst, Architect, or QA.
        </p>
      </div>

      <section className="glass-panel grid gap-6 p-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-4">
          <div>
            <label htmlFor="agent-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="agent-name"
              placeholder="Security officer"
              className="mt-2 h-9 w-full rounded-md border border-input bg-background/40 px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="agent-instructions" className="text-sm font-medium text-foreground">
              Instructions / system prompt
            </label>
            <textarea
              id="agent-instructions"
              placeholder="Describe what this agent should inspect, decide, and return..."
              className="mt-2 min-h-40 w-full rounded-md border border-input bg-background/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value);
                setAnalysis(undefined);
              }}
            />
          </div>
          <label htmlFor="agent-repo-access" className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <Checkbox
              id="agent-repo-access"
              checked={repoAccess}
              onCheckedChange={() => {
                setRepoAccess((prev) => !prev);
                setAnalysis(undefined);
              }}
            />
            Give this agent repo read access
          </label>
        </div>

        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-testid="agent-inputs">
              <p className="mb-3 font-mono text-[10px] uppercase text-muted-foreground">Needs</p>
              <div className="grid gap-2">
                {DATA_KINDS.map((kind) => (
                  <PillCheckbox
                    key={kind}
                    id={`agent-input-${kind}`}
                    checked={inputs.includes(kind)}
                    onChange={() => setInputs((prev) => toggle(prev, kind))}
                    label={DATA_KIND_LABELS[kind]}
                  />
                ))}
              </div>
            </div>
            <div data-testid="agent-outputs">
              <p className="mb-3 font-mono text-[10px] uppercase text-muted-foreground">Produces</p>
              <div className="grid gap-2">
                {DATA_KINDS.map((kind) => (
                  <PillCheckbox
                    key={kind}
                    id={`agent-output-${kind}`}
                    checked={outputs.includes(kind)}
                    onChange={() => setOutputs((prev) => toggle(prev, kind))}
                    label={DATA_KIND_LABELS[kind]}
                  />
                ))}
              </div>
            </div>
          </div>

          {analysis && (
            <div className="mt-4 flex flex-col gap-1 rounded-xl border border-border bg-muted/50 p-4 text-sm">
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
          {formError && <p className="mt-4 text-sm text-destructive">{formError}</p>}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="h-9 gap-2 px-4"
              onClick={() => setAnalysis(analyzeInstructions(instructions, repoAccess))}
              disabled={!instructions.trim()}
            >
              <Sparkles className="size-4" />
              Analyze instructions
            </Button>
            <Button className="h-9 gap-2 px-4" onClick={handleCreate} disabled={!name.trim() || !instructions.trim() || submitting}>
              <Bot className="size-4" />
              {submitting ? "Creating..." : "Create agent"}
            </Button>
          </div>
        </div>
      </section>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground">Existing agents</h2>
          <span className="font-mono text-[10px] text-muted-foreground">{agents.length} CUSTOM</span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <article key={agent.id} data-testid={`agent-row-${agent.id}`} className="glass-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bot className="size-4" />
                  </span>
                  {agent.repoAccess && <Badge variant="secondary">reads repo</Badge>}
                </div>
                <h4 className="mt-4 font-heading font-semibold text-foreground">{agent.name}</h4>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{agent.instructions}</p>
                {rowError?.id === agent.id && <p className="mt-2 text-sm text-destructive">{rowError.message}</p>}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(agent)}
                  className="mt-4 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
