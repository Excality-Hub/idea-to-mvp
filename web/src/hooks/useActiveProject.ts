import { useCallback, useState } from "react";

const STORAGE_KEY = "idea-to-mvp:activeProjectId";

function readStoredProjectId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useActiveProject(): [string | null, (projectId: string | null) => void] {
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(readStoredProjectId);

  const setActiveProjectId = useCallback((projectId: string | null) => {
    setActiveProjectIdState(projectId);
    try {
      if (projectId) {
        window.localStorage.setItem(STORAGE_KEY, projectId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable (e.g. private browsing) — in-memory state still works for this session
    }
  }, []);

  return [activeProjectId, setActiveProjectId];
}
