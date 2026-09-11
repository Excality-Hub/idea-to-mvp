import { useCallback, useEffect, useState } from "react";
import type { WorkflowDefinition } from "@/types";

export interface UseWorkflowsResult {
  workflows: WorkflowDefinition[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useWorkflows(): UseWorkflowsResult {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch("/api/workflows")
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
  }, [refetchToken]);

  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  return { workflows, loading, error, refetch };
}
