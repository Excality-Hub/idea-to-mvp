import { Bot, GitBranch, History, Settings, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { cn } from "@/lib/utils";

export type SidebarView = "workflows" | "agents" | "pipelines";

const NAV_ITEMS: { label: string; icon: typeof Workflow; view: SidebarView }[] = [
  { label: "Workflows", icon: Workflow, view: "workflows" },
  { label: "Agents", icon: Bot, view: "agents" },
  { label: "Pipelines", icon: GitBranch, view: "pipelines" },
];

const DISABLED_ITEMS = [
  { label: "Runs history", icon: History },
  { label: "Settings", icon: Settings },
];

interface SidebarProps {
  activeView: SidebarView;
  onSelect: (view: SidebarView) => void;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function Sidebar({ activeView, onSelect, selectedProjectId, onSelectProject }: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="border-b border-sidebar-border p-3">
        <ProjectSwitcher variant="sidebar" selectedProjectId={selectedProjectId} onSelect={onSelectProject} />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 py-4">
        {NAV_ITEMS.map(({ label, icon: Icon, view }) => (
          <button
            type="button"
            key={label}
            aria-current={activeView === view ? "page" : undefined}
            onClick={() => onSelect(view)}
            className={cn(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium",
              activeView === view
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
        {DISABLED_ITEMS.map(({ label, icon: Icon }) => (
          <div
            key={label}
            aria-disabled="true"
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/50"
          >
            <Icon className="size-4" />
            {label}
            <Badge
              variant="outline"
              className="ml-auto border-sidebar-border px-1.5 font-mono text-[9px] text-sidebar-foreground/60"
            >
              Soon
            </Badge>
          </div>
        ))}
      </nav>
    </aside>
  );
}
