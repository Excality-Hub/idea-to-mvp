import { useMemo, useState } from "react";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { StageFlowGraph } from "@/components/StageFlowGraph";
import { useAgents } from "@/hooks/useAgents";
import { deriveStageStatus, groupEventsByStage } from "@/lib/runEvents";
import { getStageLabel } from "@/lib/workflowGraph";
import type { ProjectRecord, StageName } from "@/types";

interface ProjectHistoryViewProps {
  project: ProjectRecord;
}

export function ProjectHistoryView({ project }: ProjectHistoryViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const { agents } = useAgents();
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const labelFor = useMemo(() => (stage: StageName) => getStageLabel(stage, agentsById), [agentsById]);
  const eventsByStage = useMemo(() => groupEventsByStage(project.events), [project.events]);
  const stageOrder = useMemo(() => Object.keys(eventsByStage) as StageName[], [eventsByStage]);
  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">{project.ideaText}</h1>
        <p className="text-sm text-muted-foreground">
          Recorded run &middot; {new Date(project.createdAt).toLocaleString()} &middot; read-only
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        <StageFlowGraph
          eventsByStage={eventsByStage}
          stageOrder={stageOrder}
          labelFor={labelFor}
          onSelectStage={setSelectedStage}
        />
      </div>
      <StageDetailSheet
        label={selectedStage ? labelFor(selectedStage) : undefined}
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
