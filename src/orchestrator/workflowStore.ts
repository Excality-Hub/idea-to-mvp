import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { WorkflowDefinition } from "./types.js";

export type WorkflowStore = JsonStore<WorkflowDefinition>;

export const DEFAULT_WORKFLOW_ID = "default";

const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: DEFAULT_WORKFLOW_ID,
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: new Date(0).toISOString(),
};

export function createWorkflowStore(filePath: string): WorkflowStore {
  return createJsonStore<WorkflowDefinition>(filePath, [DEFAULT_WORKFLOW]);
}
