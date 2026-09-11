import type { OverallStatus, RunEvent, StageName } from "../types";

export type EventsByStage = Partial<Record<StageName, RunEvent[]>>;

export function groupEventsByStage(events: RunEvent[]): EventsByStage {
  const grouped: EventsByStage = {};
  for (const event of events) {
    const forStage = grouped[event.stage];
    if (forStage) {
      forStage.push(event);
    } else {
      grouped[event.stage] = [event];
    }
  }
  return grouped;
}

export function deriveStageStatus(
  events: RunEvent[] | undefined,
): RunEvent["status"] | "pending" {
  if (!events || events.length === 0) return "pending";
  return events[events.length - 1].status;
}

export function deriveOverallStatus(eventsByStage: EventsByStage): OverallStatus {
  const allEvents = Object.values(eventsByStage).filter((v) => v !== undefined).flat();
  if (allEvents.length === 0) return "idle";
  if (allEvents.some((e) => e.status === "failed" && e.stage !== "tracing_pack")) return "failed";
  if (deriveStageStatus(eventsByStage.merge) === "blocked") return "blocked";
  if (deriveStageStatus(eventsByStage.deploy) === "done") return "deployed";
  if (Object.values(eventsByStage).filter((v) => v !== undefined).some((events) => deriveStageStatus(events) === "stopped")) return "stopped";
  return "running";
}
