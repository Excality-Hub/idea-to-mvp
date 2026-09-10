import { useState } from "react";
import { AgentsView } from "@/components/AgentsView";
import { Header } from "@/components/Header";
import { PipelinesView } from "@/components/PipelinesView";
import { Sidebar, type SidebarView } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useRunEvents } from "@/hooks/useRunEvents";

export function App() {
  const { eventsByStage, overallStatus, connected } = useRunEvents();
  const [activeView, setActiveView] = useState<SidebarView>("workflows");

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header overallStatus={overallStatus} connected={connected} />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeView={activeView} onSelect={setActiveView} />
        <main className="flex-1 overflow-hidden">
          {activeView === "workflows" && <WorkflowsView eventsByStage={eventsByStage} />}
          {activeView === "agents" && <AgentsView />}
          {activeView === "pipelines" && <PipelinesView />}
        </main>
      </div>
    </div>
  );
}

export default App;
