import { useCallback, useEffect, useState } from "react";
import type { AgentDefinition } from "@/types";

export interface UseAgentsResult {
  agents: AgentDefinition[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch("/api/agents")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
        return res.json() as Promise<AgentDefinition[]>;
      })
      .then((data) => {
        if (!cancelled) setAgents(data);
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

  return { agents, loading, error, refetch };
}
