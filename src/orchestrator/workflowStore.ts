import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { WorkflowDefinition } from "./types.js";

export type WorkflowStore = JsonStore<WorkflowDefinition> & {
  listByProject(projectId: string): WorkflowDefinition[];
};

const DEFAULT_WORKFLOW_SUFFIX = "-default";

export function defaultWorkflowIdFor(projectId: string): string {
  return `${projectId}${DEFAULT_WORKFLOW_SUFFIX}`;
}

export function createDefaultWorkflow(projectId: string): WorkflowDefinition {
  return {
    id: defaultWorkflowIdFor(projectId),
    projectId,
    name: "Default",
    slots: {},
    createdAt: new Date().toISOString(),
  };
}

export function createWorkflowStore(filePath: string): WorkflowStore {
  const base = createJsonStore<WorkflowDefinition>(filePath, []);
  return {
    ...base,
    listByProject(projectId) {
      return base.list().filter((workflow) => workflow.projectId === projectId);
    },
  };
}
