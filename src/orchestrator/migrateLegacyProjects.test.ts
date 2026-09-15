import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { migrateLegacyData } from "./migrateLegacyProjects.js";
import { defaultWorkflowIdFor } from "./workflowStore.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "migration-test-"));
}

function paths(dir: string) {
  return {
    projectsFile: join(dir, "projects.json"),
    workflowsFile: join(dir, "workflows.json"),
    runsFile: join(dir, "runs.json"),
  };
}

describe("migrateLegacyData", () => {
  it("does nothing when no legacy projects file exists", () => {
    const p = paths(tempDir());

    migrateLegacyData(p);

    expect(() => readFileSync(p.projectsFile)).toThrow();
  });

  it("does nothing when the projects file is already in the new Project shape", () => {
    const p = paths(tempDir());
    const alreadyMigrated = [
      { id: "p1", name: "My project", repoName: "my-project-abc12345", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    writeFileSync(p.projectsFile, JSON.stringify(alreadyMigrated));

    migrateLegacyData(p);

    expect(JSON.parse(readFileSync(p.projectsFile, "utf-8"))).toEqual(alreadyMigrated);
    expect(() => readFileSync(p.runsFile)).toThrow();
  });

  it("does nothing when the legacy projects file is an empty array", () => {
    const p = paths(tempDir());
    writeFileSync(p.projectsFile, JSON.stringify([]));

    migrateLegacyData(p);

    expect(JSON.parse(readFileSync(p.projectsFile, "utf-8"))).toEqual([]);
    expect(() => readFileSync(p.runsFile)).toThrow();
  });

  it("skips migration instead of throwing when the legacy projects file is malformed JSON", () => {
    const p = paths(tempDir());
    writeFileSync(p.projectsFile, "{ this is not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => migrateLegacyData(p)).not.toThrow();

    expect(warn).toHaveBeenCalled();
    expect(readFileSync(p.projectsFile, "utf-8")).toBe("{ this is not json");
    expect(() => readFileSync(p.runsFile)).toThrow();
    expect(() => readFileSync(p.workflowsFile)).toThrow();
    warn.mockRestore();
  });

  it("skips migration instead of throwing when the legacy workflows file is malformed JSON", () => {
    const p = paths(tempDir());
    writeFileSync(
      p.projectsFile,
      JSON.stringify([
        { id: "run-1", ideaText: "Build a blog", repoName: "idea-to-mvp-1", createdAt: "2026-09-01T00:00:00.000Z", events: [] },
      ]),
    );
    writeFileSync(p.workflowsFile, "]]not json[[");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => migrateLegacyData(p)).not.toThrow();

    expect(warn).toHaveBeenCalled();
    expect(readFileSync(p.workflowsFile, "utf-8")).toBe("]]not json[[");
    expect(() => readFileSync(p.runsFile)).toThrow();
    expect(JSON.parse(readFileSync(p.projectsFile, "utf-8"))[0]).toMatchObject({ ideaText: "Build a blog" });
    warn.mockRestore();
  });

  it("migrates legacy project records into one Legacy project, a runs file, and re-scoped workflows", () => {
    const p = paths(tempDir());
    const legacyRecords = [
      {
        id: "run-1",
        ideaText: "Build a todo app",
        repoName: "idea-to-mvp-1",
        createdAt: "2026-09-01T00:00:00.000Z",
        events: [{ stage: "analyst", status: "done", message: "done", timestamp: "2026-09-01T00:01:00.000Z" }],
      },
    ];
    const legacyWorkflows = [
      { id: "default", name: "Default", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "custom-1", name: "With review", slots: { qa: ["agent-1"] }, createdAt: "2026-01-02T00:00:00.000Z" },
    ];
    writeFileSync(p.projectsFile, JSON.stringify(legacyRecords));
    writeFileSync(p.workflowsFile, JSON.stringify(legacyWorkflows));

    migrateLegacyData(p);

    const migratedProjects = JSON.parse(readFileSync(p.projectsFile, "utf-8"));
    expect(migratedProjects).toHaveLength(1);
    expect(migratedProjects[0]).toMatchObject({ name: "Legacy" });
    expect(migratedProjects[0].repo).toBeUndefined();
    const legacyProjectId = migratedProjects[0].id;

    const migratedRuns = JSON.parse(readFileSync(p.runsFile, "utf-8"));
    expect(migratedRuns).toEqual([
      {
        id: "run-1",
        projectId: legacyProjectId,
        ideaText: "Build a todo app",
        workflowId: defaultWorkflowIdFor(legacyProjectId),
        createdAt: "2026-09-01T00:00:00.000Z",
        events: legacyRecords[0].events,
      },
    ]);

    const migratedWorkflows = JSON.parse(readFileSync(p.workflowsFile, "utf-8")) as { id: string; projectId: string; name: string }[];
    expect(migratedWorkflows).toHaveLength(2);
    expect(migratedWorkflows.every((w) => w.projectId === legacyProjectId)).toBe(true);
    expect(migratedWorkflows.find((w) => w.id === defaultWorkflowIdFor(legacyProjectId))).toMatchObject({ name: "Default" });
    expect(migratedWorkflows.find((w) => w.id === "custom-1")).toMatchObject({ name: "With review" });
  });

  it("seeds a fresh default workflow when the legacy workflows file has none", () => {
    const p = paths(tempDir());
    writeFileSync(
      p.projectsFile,
      JSON.stringify([
        { id: "run-1", ideaText: "Build a blog", repoName: "idea-to-mvp-1", createdAt: "2026-09-01T00:00:00.000Z", events: [] },
      ]),
    );

    migrateLegacyData(p);

    const legacyProjectId = JSON.parse(readFileSync(p.projectsFile, "utf-8"))[0].id;
    const migratedWorkflows = JSON.parse(readFileSync(p.workflowsFile, "utf-8")) as { id: string }[];
    expect(migratedWorkflows).toEqual([
      expect.objectContaining({ id: defaultWorkflowIdFor(legacyProjectId), name: "Default" }),
    ]);
  });
});
