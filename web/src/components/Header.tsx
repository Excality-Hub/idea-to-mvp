import { Bell, User } from "lucide-react";
import { OVERALL_STATUS_CONFIG } from "@/components/status";
import type { SidebarView } from "@/components/Sidebar";
import type { OverallStatus } from "@/types";

const VIEW_TITLES: Record<SidebarView, string> = {
  workflows: "Workflows",
  agents: "Agents",
  pipelines: "Pipelines",
  runs: "Runs history",
};

interface HeaderProps {
  activeView: SidebarView;
  overallStatus: OverallStatus;
  connected: boolean;
}

export function Header({ activeView, overallStatus, connected }: HeaderProps) {
  const status = OVERALL_STATUS_CONFIG[overallStatus];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          idea-to-mvp
        </p>
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          {VIEW_TITLES[activeView]}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {!connected && (
          <span className="text-xs text-muted-foreground">reconnecting&hellip;</span>
        )}
        <span
          className={`inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium ${status.className}`}
        >
          <span className={`size-1.5 rounded-full ${status.dotClassName}`} />
          {status.label}
        </span>
        <button
          type="button"
          aria-label="Notifications"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Bell className="size-4" />
        </button>
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="size-4" />
        </span>
      </div>
    </header>
  );
}
