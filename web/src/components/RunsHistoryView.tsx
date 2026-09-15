import { useEffect, useState } from "react";
import { RunDetailView } from "@/components/RunDetailView";
import type { Run, RunSummary } from "@/types";

interface RunsHistoryViewProps {
  projectId: string;
}

export function RunsHistoryView({ projectId }: RunsHistoryViewProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedRun, setSelectedRun] = useState<Run | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setSelectedRun(undefined);
    fetch(`/api/projects/${projectId}/runs`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load runs (${res.status})`);
        return res.json() as Promise<RunSummary[]>;
      })
      .then((data) => {
        if (!cancelled) setRuns(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function openRun(runId: string) {
    const res = await fetch(`/api/projects/${projectId}/runs/${runId}`);
    if (!res.ok) return;
    setSelectedRun((await res.json()) as Run);
  }

  if (selectedRun) {
    return (
      <div className="flex h-full w-full flex-col">
        <button
          type="button"
          className="m-4 self-start text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setSelectedRun(undefined)}
        >
          &larr; Back to runs
        </button>
        <RunDetailView run={selectedRun} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Runs history</h1>
        <p className="text-sm text-muted-foreground">Every run started in this project, most recent first.</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                data-testid={`run-row-${run.id}`}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-left hover:bg-muted"
                onClick={() => openRun(run.id)}
              >
                <span className="font-medium text-foreground">{run.ideaText}</span>
                <span className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
