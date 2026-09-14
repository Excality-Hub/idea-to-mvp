import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { RunEvent } from "./types.js";

export interface ProjectRecord {
  id: string;
  ideaText: string;
  repoName: string;
  createdAt: string;
  events: RunEvent[];
}

export type ProjectSummary = Omit<ProjectRecord, "events">;

export type ProjectStore = JsonStore<ProjectRecord> & {
  appendEvent(id: string, event: RunEvent): void;
};

export function createProjectStore(filePath: string): ProjectStore {
  const base = createJsonStore<ProjectRecord>(filePath, []);
  return {
    ...base,
    appendEvent(id, event) {
      const record = base.get(id);
      if (!record) return;
      base.update(id, { ...record, events: [...record.events, event] });
    },
  };
}
