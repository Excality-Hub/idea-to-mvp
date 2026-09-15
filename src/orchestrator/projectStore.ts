import { randomUUID } from "node:crypto";
import { createJsonStore, type JsonStore } from "../jsonStore.js";

export interface Project {
  id: string;
  name: string;
  repoName: string;
  repo?: { owner: string; htmlUrl: string; cloneUrl: string };
  createdAt: string;
}

export type ProjectStore = JsonStore<Project>;

export function createProjectStore(filePath: string): ProjectStore {
  return createJsonStore<Project>(filePath, []);
}

export function generateRepoName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "project"}-${randomUUID().slice(0, 8)}`;
}
