import { useState } from "react";
import { Bot, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  variant?: "header" | "sidebar";
}

export function ProjectSwitcher({ activeProjectId, onSelect, variant = "header" }: ProjectSwitcherProps) {
  const { projects, refetch, createProject } = useProjects();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const label = activeProject ? truncate(activeProject.name) : "idea-to-mvp";

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      const project = await createProject(name);
      onSelect(project.id);
      setNewName("");
      setCreating(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) refetch();
        else setCreating(false);
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
                {activeProject ? "project" : "no project"}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/60" />
          </>
        ) : (
          <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{label}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={variant === "sidebar" ? "w-64" : undefined}>
        {projects.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
            <span className="font-medium text-foreground">{truncate(project.name)}</span>
            <span className="text-xs text-muted-foreground">{new Date(project.createdAt).toLocaleString()}</span>
          </DropdownMenuItem>
        ))}
        {projects.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">No projects yet</div>}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="flex flex-col gap-2 p-2">
            <input
              autoFocus
              aria-label="Project name"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleCreate();
              }}
            />
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreating(true);
            }}
          >
            <Plus className="size-4" />
            <span className="font-medium text-foreground">New project</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
