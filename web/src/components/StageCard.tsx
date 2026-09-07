import { STAGE_STATUS_CONFIG, type StageDisplayStatus } from "@/components/status";
import { cn } from "@/lib/utils";
import type { RunEvent, StageName } from "@/types";

interface StageCardProps {
  stage: StageName;
  label: string;
  status: StageDisplayStatus;
  latestEvent: RunEvent | undefined;
  onClick: () => void;
}

export function StageCard({ label, status, latestEvent, onClick }: StageCardProps) {
  const config = STAGE_STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/40",
        status === "running" && "border-primary/40",
      )}
    >
      <Icon className={cn("size-5 shrink-0", config.dotClassName, status === "running" && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          <span className={cn("text-xs font-medium", config.dotClassName)}>{config.label}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {latestEvent ? latestEvent.message : "Waiting for this stage to start"}
        </p>
      </div>
    </button>
  );
}
