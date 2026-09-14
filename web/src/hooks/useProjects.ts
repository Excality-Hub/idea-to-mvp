import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "@/types";

export interface UseProjectsResult {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch("/api/projects")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
        return res.json() as Promise<{ projects: ProjectSummary[]; currentProjectId: string | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setProjects(data.projects);
          setCurrentProjectId(data.currentProjectId);
        }
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

  return { projects, currentProjectId, loading, error, refetch };
}
