import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PipelineCanvas } from "@/components/PipelineCanvas";
import { useWorkflows } from "@/hooks/useWorkflows";
import { defaultWorkflowIdFor, type WorkflowDefinition } from "@/types";

type EditorState = { mode: "list" } | { mode: "create" } | { mode: "edit"; workflow: WorkflowDefinition };

interface PipelinesViewProps {
  projectId: string;
}

export function PipelinesView({ projectId }: PipelinesViewProps) {
  const { workflows, loading, error: workflowsError, refetch } = useWorkflows(projectId);
  const [editorState, setEditorState] = useState<EditorState>({ mode: "list" });
  const defaultWorkflowId = defaultWorkflowIdFor(projectId);

  async function handleDelete(workflow: WorkflowDefinition) {
    await fetch(`/api/projects/${projectId}/workflows/${workflow.id}`, { method: "DELETE" });
    refetch();
  }

  function handleSaved() {
    setEditorState({ mode: "list" });
    refetch();
  }

  if (editorState.mode === "create") {
    return <PipelineCanvas projectId={projectId} onSaved={handleSaved} onCancel={() => setEditorState({ mode: "list" })} />;
  }
  if (editorState.mode === "edit") {
    return (
      <PipelineCanvas
        projectId={projectId}
        initial={editorState.workflow}
        onSaved={handleSaved}
        onCancel={() => setEditorState({ mode: "list" })}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Pipelines</h1>
          <p className="text-sm text-muted-foreground">
            Named arrangements of agents around the fixed pipeline backbone.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditorState({ mode: "create" })}>
          New pipeline
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workflowsError ? (
        <p className="text-sm text-destructive">{workflowsError}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {workflows.map((workflow) => (
            <li
              key={workflow.id}
              data-testid={`workflow-row-${workflow.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="font-medium text-foreground">{workflow.name}</span>
              {workflow.id !== defaultWorkflowId && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditorState({ mode: "edit", workflow })}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(workflow)}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
