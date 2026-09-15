import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { RunEvent } from "./types.js";

export interface Run {
  id: string;
  projectId: string;
  ideaText: string;
  workflowId: string;
  createdAt: string;
  events: RunEvent[];
}

export type RunSummary = Omit<Run, "events">;

export type RunStore = JsonStore<Run> & {
  appendEvent(id: string, event: RunEvent): void;
  listByProject(projectId: string): Run[];
};

export function createRunStore(filePath: string): RunStore {
  const base = createJsonStore<Run>(filePath, []);
  return {
    ...base,
    appendEvent(id, event) {
      const record = base.get(id);
      if (!record) return;
      base.update(id, { ...record, events: [...record.events, event] });
    },
    listByProject(projectId) {
      return base.list().filter((run) => run.projectId === projectId);
    },
  };
}
