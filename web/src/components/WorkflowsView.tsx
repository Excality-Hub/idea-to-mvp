import { useState } from "react";
import { StageCard } from "@/components/StageCard";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { STAGE_LABELS, STAGE_ORDER, type StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Live pipeline stages for the current run. Click a stage to see its full log.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {STAGE_ORDER.map((stage) => {
          const events = eventsByStage[stage];
          return (
            <StageCard
              key={stage}
              stage={stage}
              label={STAGE_LABELS[stage]}
              status={deriveStageStatus(events)}
              latestEvent={events?.[events.length - 1]}
              onClick={() => setSelectedStage(stage)}
            />
          );
        })}
      </div>
      <StageDetailSheet
        label={selectedStage ? STAGE_LABELS[selectedStage] : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedStage(null);
        }}
      />
    </div>
  );
}
