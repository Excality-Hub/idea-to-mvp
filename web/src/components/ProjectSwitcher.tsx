import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/hooks/useProjects";

function truncate(text: string, max = 60): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

interface ProjectSwitcherProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
}

export function ProjectSwitcher({ selectedProjectId, onSelect }: ProjectSwitcherProps) {
  const { projects, currentProjectId } = useProjects();
  const viewedId = selectedProjectId ?? currentProjectId;
  const viewedProject = projects.find((p) => p.id === viewedId);
  const label = viewedProject ? truncate(viewedProject.ideaText) : "idea-to-mvp";
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const pastProjects = projects.filter((p) => p.id !== currentProjectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-muted">
        <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {currentProject && (
          <>
            <DropdownMenuItem onSelect={() => onSelect(null)}>
              <span className="font-medium text-foreground">{truncate(currentProject.ideaText)}</span>
              <span className="text-xs text-muted-foreground">Live</span>
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
