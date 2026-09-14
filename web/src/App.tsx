import { useState } from "react";
import { AgentsView } from "@/components/AgentsView";
import { Header } from "@/components/Header";
import { PipelinesView } from "@/components/PipelinesView";
import { ProjectHistoryView } from "@/components/ProjectHistoryView";
import { Sidebar, type SidebarView } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useProject } from "@/hooks/useProject";
import { useRunEvents } from "@/hooks/useRunEvents";

export function App() {
  const { eventsByStage, overallStatus, connected } = useRunEvents();
  const [activeView, setActiveView] = useState<SidebarView>("workflows");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { project } = useProject(selectedProjectId);

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        overallStatus={overallStatus}
        connected={connected}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeView={activeView} onSelect={setActiveView} />
        <main className="flex-1 overflow-hidden">
          <div hidden={activeView !== "workflows"} className="h-full">
            {selectedProjectId && project ? (
              <ProjectHistoryView project={project} />
            ) : (
              <WorkflowsView eventsByStage={eventsByStage} />
            )}
          </div>
          <div hidden={activeView !== "agents"} className="h-full">
            <AgentsView />
          </div>
          <div hidden={activeView !== "pipelines"} className="h-full">
            <PipelinesView />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
