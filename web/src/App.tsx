import { useEffect, useState } from "react";
import { AgentsView } from "@/components/AgentsView";
import { Header } from "@/components/Header";
import { PipelinesView } from "@/components/PipelinesView";
import { RunsHistoryView } from "@/components/RunsHistoryView";
import { Sidebar, type SidebarView } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useProjects } from "@/hooks/useProjects";
import { useRunEvents } from "@/hooks/useRunEvents";

function EmptyProjectState() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        Select or create a project from the sidebar to get started.
      </p>
    </div>
  );
}

export function App() {
  const [activeProjectId, setActiveProjectId] = useActiveProject();
  const { eventsByStage, overallStatus, connected } = useRunEvents(activeProjectId);
  const [activeView, setActiveView] = useState<SidebarView>("workflows");
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();

  // The active project id is restored from localStorage, so it can name a project
  // that has since been deleted. Once the real list has loaded, drop an id that
  // isn't in it — otherwise every scoped view 404s and useRunEvents' EventSource
  // reconnects forever against a URL that will never exist.
  useEffect(() => {
    if (projectsLoading || projectsError || !activeProjectId) return;
    if (projects.some((project) => project.id === activeProjectId)) return;
    setActiveProjectId(null);
  }, [projects, projectsLoading, projectsError, activeProjectId, setActiveProjectId]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeView={activeView}
        onSelect={setActiveView}
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Header activeView={activeView} overallStatus={overallStatus} connected={connected} />
        <main className="flex-1 overflow-hidden">
          <div hidden={activeView !== "workflows"} className="h-full">
            {activeProjectId ? (
              <WorkflowsView key={activeProjectId} projectId={activeProjectId} eventsByStage={eventsByStage} />
            ) : (
              <EmptyProjectState />
            )}
          </div>
          <div hidden={activeView !== "agents"} className="h-full">
            <AgentsView />
          </div>
          <div hidden={activeView !== "pipelines"} className="h-full">
            {activeProjectId ? (
              <PipelinesView key={activeProjectId} projectId={activeProjectId} />
            ) : (
              <EmptyProjectState />
            )}
          </div>
          <div hidden={activeView !== "runs"} className="h-full">
            {activeProjectId ? (
              <RunsHistoryView key={activeProjectId} projectId={activeProjectId} />
            ) : (
              <EmptyProjectState />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
