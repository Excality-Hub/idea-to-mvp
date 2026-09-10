import { Bot, History, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

export type SidebarView = "workflows" | "agents" | "pipelines";

const NAV_ITEMS: { label: string; icon: typeof Workflow; view: SidebarView }[] = [
  { label: "Workflows", icon: Workflow, view: "workflows" },
  { label: "Agents", icon: Bot, view: "agents" },
  { label: "Pipelines", icon: Workflow, view: "pipelines" },
];

const DISABLED_ITEMS = [
  { label: "Runs history", icon: History },
  { label: "Settings", icon: Settings },
];

interface SidebarProps {
  activeView: SidebarView;
  onSelect: (view: SidebarView) => void;
}

export function Sidebar({ activeView, onSelect }: SidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 bg-sidebar px-3 py-4">
      {NAV_ITEMS.map(({ label, icon: Icon, view }) => (
        <button
          type="button"
          key={label}
          aria-current={activeView === view ? "page" : undefined}
          onClick={() => onSelect(view)}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium",
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
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/50"
        >
          <Icon className="size-4" />
          {label}
          <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
            Soon
          </span>
        </div>
      ))}
    </aside>
  );
}
