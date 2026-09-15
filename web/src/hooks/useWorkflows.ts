import { useCallback, useEffect, useState } from "react";
import type { WorkflowDefinition } from "@/types";

export interface UseWorkflowsResult {
  workflows: WorkflowDefinition[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useWorkflows(projectId: string | null): UseWorkflowsResult {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setWorkflows([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch(`/api/projects/${projectId}/workflows`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
        return res.json() as Promise<WorkflowDefinition[]>;
      })
      .then((data) => {
        if (!cancelled) setWorkflows(data);
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
  }, [projectId, refetchToken]);

  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  return { workflows, loading, error, refetch };
}
