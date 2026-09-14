import { Bot, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useProjects } from "@/hooks/useProjects";

function truncate(text: string, max = 60): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

interface ProjectSwitcherProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  variant?: "header" | "sidebar";
}

export function ProjectSwitcher({ selectedProjectId, onSelect, variant = "header" }: ProjectSwitcherProps) {
  const { projects, currentProjectId, refetch } = useProjects();
  const viewedId = selectedProjectId ?? currentProjectId;
  const viewedProject = projects.find((p) => p.id === viewedId);
  const label = viewedProject ? truncate(viewedProject.ideaText) : "idea-to-mvp";
  const isViewingHistory = viewedId !== null && viewedId !== currentProjectId;
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const pastProjects = projects.filter((p) => p.id !== currentProjectId);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) refetch();
      }}
    >
      <DropdownMenuTrigger
        className={cn(
          variant === "sidebar"
            ? "flex h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-sidebar-accent"
            : "flex items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-muted",
        )}
      >
        {variant === "sidebar" ? (
          <>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bot className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">{label}</span>
              <span className="block truncate font-mono text-[10px] text-sidebar-foreground/60">
                {isViewingHistory ? "history" : "live"}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/60" />
          </>
        ) : (
          <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{label}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={variant === "sidebar" ? "w-64" : undefined}>
        {currentProject && (
          <>
            <DropdownMenuItem onSelect={() => onSelect(null)}>
              <span className="font-medium text-foreground">{truncate(currentProject.ideaText)}</span>
              <span className="text-xs text-muted-foreground">Live</span>
            </DropdownMenuItem>
            {pastProjects.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {!currentProject && selectedProjectId !== null && (
          <>
            <DropdownMenuItem onSelect={() => onSelect(null)}>
              <span className="font-medium text-foreground">Back to live</span>
            </DropdownMenuItem>
            {pastProjects.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {pastProjects.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
            <span className="font-medium text-foreground">{truncate(project.ideaText)}</span>
            <span className="text-xs text-muted-foreground">{new Date(project.createdAt).toLocaleString()}</span>
          </DropdownMenuItem>
        ))}
        {projects.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">No projects yet</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
