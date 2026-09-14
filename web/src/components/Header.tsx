import { Badge } from "@/components/ui/badge";
import { OVERALL_STATUS_CONFIG } from "@/components/status";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import type { OverallStatus } from "@/types";

interface HeaderProps {
  overallStatus: OverallStatus;
  connected: boolean;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function Header({ overallStatus, connected, selectedProjectId, onSelectProject }: HeaderProps) {
  const status = OVERALL_STATUS_CONFIG[overallStatus];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-baseline gap-2">
        <ProjectSwitcher selectedProjectId={selectedProjectId} onSelect={onSelectProject} />
        <span className="hidden text-sm text-muted-foreground sm:inline">
          idea &rarr; PR &rarr; deploy, watched live
        </span>
      </div>
      <div className="flex items-center gap-3">
        {!connected && (
          <span className="text-xs text-muted-foreground">reconnecting&hellip;</span>
        )}
        <Badge className={`${status.className} border-none font-medium`}>{status.label}</Badge>
      </div>
    </header>
  );
}
