import { useState } from "react";
import { AgentsView } from "@/components/AgentsView";
import { Header } from "@/components/Header";
import { PipelinesView } from "@/components/PipelinesView";
import { RunsHistoryView } from "@/components/RunsHistoryView";
import { Sidebar, type SidebarView } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useActiveProject } from "@/hooks/useActiveProject";
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
              <WorkflowsView projectId={activeProjectId} eventsByStage={eventsByStage} />
            ) : (
              <EmptyProjectState />
            )}
          </div>
          <div hidden={activeView !== "agents"} className="h-full">
            <AgentsView />
          </div>
          <div hidden={activeView !== "pipelines"} className="h-full">
            {activeProjectId ? <PipelinesView projectId={activeProjectId} /> : <EmptyProjectState />}
          </div>
          <div hidden={activeView !== "runs"} className="h-full">
            {activeProjectId ? <RunsHistoryView projectId={activeProjectId} /> : <EmptyProjectState />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
