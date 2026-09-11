import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { AgentDefinition } from "./types.js";

export type AgentStore = JsonStore<AgentDefinition>;

export function createAgentStore(filePath: string): AgentStore {
  return createJsonStore<AgentDefinition>(filePath, []);
}
