import { useEffect, useState } from "react";
import { STAGE_ORDER, type StageName } from "@/types";

export function useRunPlan(isIdle: boolean): StageName[] {
  const [plan, setPlan] = useState<StageName[]>(STAGE_ORDER);

  useEffect(() => {
    if (isIdle) {
      setPlan(STAGE_ORDER);
      return;
    }
    let cancelled = false;
    fetch("/api/run/plan")
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
  }, [isIdle]);

  return plan;
}
