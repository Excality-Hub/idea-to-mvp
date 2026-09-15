import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/types";

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
  createProject: (name: string) => Promise<Project>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
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
        return res.json() as Promise<Project[]>;
      })
      .then((data) => {
        if (!cancelled) setProjects(data);
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

  const createProject = useCallback(async (name: string): Promise<Project> => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create project (${res.status})`);
    }
    const project = (await res.json()) as Project;
    setProjects((prev) => [project, ...prev]);
    return project;
  }, []);

  return { projects, loading, error, refetch, createProject };
}
