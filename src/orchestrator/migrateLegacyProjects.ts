import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { generateRepoName, type Project } from "./projectStore.js";
import { createDefaultWorkflow, defaultWorkflowIdFor } from "./workflowStore.js";
import type { RunEvent, WorkflowDefinition } from "./types.js";
import type { Run } from "./runStore.js";

interface LegacyProjectRecord {
  id: string;
  ideaText: string;
  repoName: string;
  createdAt: string;
  events: RunEvent[];
}

interface LegacyWorkflowDefinition {
  id: string;
  name: string;
  slots: WorkflowDefinition["slots"];
  createdAt: string;
}

export interface MigrationPaths {
  projectsFile: string;
  workflowsFile: string;
  runsFile: string;
}

function looksLikeLegacyProjectRecord(item: unknown): item is LegacyProjectRecord {
  return (
    typeof item === "object" &&
    item !== null &&
    "ideaText" in item &&
    "events" in item &&
    !("name" in item)
  );
}

export function migrateLegacyData(paths: MigrationPaths): void {
  if (!existsSync(paths.projectsFile)) return;
  const raw = JSON.parse(readFileSync(paths.projectsFile, "utf-8")) as unknown[];
  if (raw.length === 0 || !raw.every(looksLikeLegacyProjectRecord)) return;
  const legacyRecords = raw as LegacyProjectRecord[];

  const legacyProjectId = randomUUID();
  const legacyProject: Project = {
    id: legacyProjectId,
    name: "Legacy",
    repoName: generateRepoName("legacy"),
    createdAt: new Date(0).toISOString(),
  };
  const defaultWorkflowId = defaultWorkflowIdFor(legacyProjectId);

  const runs: Run[] = legacyRecords.map((record) => ({
    id: record.id,
    projectId: legacyProjectId,
    ideaText: record.ideaText,
    workflowId: defaultWorkflowId,
    createdAt: record.createdAt,
    events: record.events,
  }));

  const legacyWorkflows: LegacyWorkflowDefinition[] = existsSync(paths.workflowsFile)
    ? (JSON.parse(readFileSync(paths.workflowsFile, "utf-8")) as LegacyWorkflowDefinition[])
    : [];
  const migratedWorkflows: WorkflowDefinition[] = legacyWorkflows.map((workflow) =>
    workflow.id === "default"
      ? { ...workflow, id: defaultWorkflowId, projectId: legacyProjectId }
      : { ...workflow, projectId: legacyProjectId },
  );
  if (!migratedWorkflows.some((workflow) => workflow.id === defaultWorkflowId)) {
    migratedWorkflows.unshift(createDefaultWorkflow(legacyProjectId));
  }

  mkdirSync(dirname(paths.projectsFile), { recursive: true });
  writeFileSync(paths.projectsFile, JSON.stringify([legacyProject], null, 2));
  writeFileSync(paths.runsFile, JSON.stringify(runs, null, 2));
  writeFileSync(paths.workflowsFile, JSON.stringify(migratedWorkflows, null, 2));
}
