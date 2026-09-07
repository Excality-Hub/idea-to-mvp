import { History, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Workflows", icon: Workflow, active: true },
  { label: "Runs history", icon: History, active: false },
  { label: "Settings", icon: Settings, active: false },
] as const;

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 bg-sidebar px-3 py-4">
      {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
        <div
          key={label}
          aria-current={active ? "page" : undefined}
          aria-disabled={active ? undefined : true}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium",
            active
              ? "bg-sidebar-accent text-sidebar-primary"
              : "text-sidebar-foreground/50",
          )}
        >
          <Icon className="size-4" />
          {label}
          {!active && (
            <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
              Soon
            </span>
          )}
        </div>
      ))}
    </aside>
  );
}
