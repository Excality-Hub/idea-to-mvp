import { useEffect, useState } from "react";
import { deriveOverallStatus, groupEventsByStage, type EventsByStage } from "@/lib/runEvents";
import type { RunEvent } from "@/types";

export interface UseRunEventsResult {
  eventsByStage: EventsByStage;
  overallStatus: ReturnType<typeof deriveOverallStatus>;
  connected: boolean;
}

export function useRunEvents(projectId: string | null): UseRunEventsResult {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    if (!projectId) return;

    const source = new EventSource(`/api/projects/${projectId}/events`);

    source.onopen = () => {
      setEvents([]);
      setConnected(true);
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      setEvents((prev) => [...prev, event]);
    };

    return () => source.close();
  }, [projectId]);

  const eventsByStage = groupEventsByStage(events);

  return {
    eventsByStage,
    overallStatus: deriveOverallStatus(eventsByStage),
    connected,
  };
}
