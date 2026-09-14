import { Badge } from "@/components/ui/badge";
import { OVERALL_STATUS_CONFIG } from "@/components/status";
import type { OverallStatus } from "@/types";

interface HeaderProps {
  overallStatus: OverallStatus;
  connected: boolean;
}

export function Header({ overallStatus, connected }: HeaderProps) {
  const status = OVERALL_STATUS_CONFIG[overallStatus];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <span className="text-sm text-muted-foreground">idea &rarr; PR &rarr; deploy, watched live</span>
      <div className="flex items-center gap-3">
        {!connected && (
          <span className="text-xs text-muted-foreground">reconnecting&hellip;</span>
        )}
        <Badge className={`${status.className} border-none font-medium`}>{status.label}</Badge>
      </div>
    </header>
  );
}
