import { useEffect, useState } from "react";
import { STAGE_ORDER, type StageName } from "@/types";

export function useRunPlan(projectId: string | null, isIdle: boolean, runGeneration: number): StageName[] {
  const [plan, setPlan] = useState<StageName[]>(STAGE_ORDER);

  useEffect(() => {
    if (!projectId || isIdle) {
      setPlan(STAGE_ORDER);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${projectId}/run/plan`)
      .then((res) => (res.ok ? (res.json() as Promise<StageName[]>) : Promise.resolve([])))
      .then((stages) => {
        if (!cancelled) setPlan(stages.length > 0 ? stages : STAGE_ORDER);
      })
      .catch(() => {
        if (!cancelled) setPlan(STAGE_ORDER);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, isIdle, runGeneration]);

  return plan;
}
