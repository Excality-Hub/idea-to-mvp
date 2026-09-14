import { useEffect, useState } from "react";
import type { ProjectRecord } from "@/types";

export interface UseProjectResult {
  project: ProjectRecord | undefined;
  loading: boolean;
  error: string | undefined;
}

export function useProject(id: string | null): UseProjectResult {
  const [project, setProject] = useState<ProjectRecord | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!id) {
      setProject(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch(`/api/projects/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load project (${res.status})`);
        return res.json() as Promise<ProjectRecord>;
      })
      .then((data) => {
        if (!cancelled) setProject(data);
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
  }, [id]);

  return { project, loading, error };
}
