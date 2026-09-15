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

/**
 * Reads a JSON array from disk. Returns undefined — rather than throwing — when the
 * file is unparseable or isn't an array, so a corrupt legacy file can't crash the
 * server at startup before it ever listens.
 */
function readJsonArray(filePath: string, label: string): unknown[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.warn(
      `[legacy migration] Skipping migration: could not parse the legacy ${label} file at ${filePath}.`,
      error,
    );
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    console.warn(
      `[legacy migration] Skipping migration: the legacy ${label} file at ${filePath} is not a JSON array.`,
    );
    return undefined;
  }
  return parsed;
}

export function migrateLegacyData(paths: MigrationPaths): void {
  if (!existsSync(paths.projectsFile)) return;
  const raw = readJsonArray(paths.projectsFile, "projects");
  if (!raw) return;
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

  let legacyWorkflows: LegacyWorkflowDefinition[] = [];
  if (existsSync(paths.workflowsFile)) {
    const rawWorkflows = readJsonArray(paths.workflowsFile, "workflows");
    if (!rawWorkflows) return;
    legacyWorkflows = rawWorkflows as LegacyWorkflowDefinition[];
  }
  const migratedWorkflows: WorkflowDefinition[] = legacyWorkflows.map((workflow) =>
    workflow.id === "default"
      ? { ...workflow, id: defaultWorkflowId, projectId: legacyProjectId }
      : { ...workflow, projectId: legacyProjectId },
  );
  if (!migratedWorkflows.some((workflow) => workflow.id === defaultWorkflowId)) {
    migratedWorkflows.unshift(createDefaultWorkflow(legacyProjectId));
  }

  for (const file of [paths.runsFile, paths.workflowsFile, paths.projectsFile]) {
    mkdirSync(dirname(file), { recursive: true });
  }
  // projectsFile doubles as the idempotency guard: once it holds the new Project
  // shape, looksLikeLegacyProjectRecord reports "already migrated" and this never
  // runs again. Write it LAST so a crash mid-migration leaves the legacy records
  // in place to be retried, rather than stranding the run history unrecoverably.
  writeFileSync(paths.runsFile, JSON.stringify(runs, null, 2));
  writeFileSync(paths.workflowsFile, JSON.stringify(migratedWorkflows, null, 2));
  writeFileSync(paths.projectsFile, JSON.stringify([legacyProject], null, 2));
}
