import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useRunEvents } from "@/hooks/useRunEvents";

export function App() {
  const { eventsByStage, overallStatus, connected } = useRunEvents();

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header overallStatus={overallStatus} connected={connected} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <WorkflowsView eventsByStage={eventsByStage} />
        </main>
      </div>
    </div>
  );
}

export default App;
