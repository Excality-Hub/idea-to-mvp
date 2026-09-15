import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectStore, generateRepoName } from "./projectStore.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "project-store-test-"));
  return join(dir, "projects.json");
}

describe("createProjectStore", () => {
  it("starts empty when the file doesn't exist yet", () => {
    const store = createProjectStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and gets a project", () => {
    const store = createProjectStore(tempFile());
    const project = {
      id: "p1",
      name: "Todo app project",
      repoName: "todo-app-project-ab12cd34",
      createdAt: "2026-09-15T00:00:00.000Z",
    };

    store.create(project);

    expect(store.get("p1")).toEqual(project);
    expect(store.list()).toEqual([project]);
  });

  it("updates a project to record its repo once the first run creates it", () => {
    const store = createProjectStore(tempFile());
    const project = {
      id: "p1",
      name: "Todo app project",
      repoName: "todo-app-project-ab12cd34",
      createdAt: "2026-09-15T00:00:00.000Z",
    };
    store.create(project);

    store.update("p1", {
      ...project,
      repo: { owner: "org", htmlUrl: "https://github.com/org/app", cloneUrl: "https://github.com/org/app.git" },
    });

    expect(store.get("p1")?.repo).toEqual({
      owner: "org",
      htmlUrl: "https://github.com/org/app",
      cloneUrl: "https://github.com/org/app.git",
    });
  });
});

describe("generateRepoName", () => {
  it("slugifies the project name and appends a random suffix", () => {
    const repoName = generateRepoName("My Todo App!");

    expect(repoName).toMatch(/^my-todo-app-[0-9a-f]{8}$/);
  });

  it("produces different names for the same project name on repeated calls", () => {
    expect(generateRepoName("Same Name")).not.toBe(generateRepoName("Same Name"));
  });

  it("falls back to a generic slug when the name has no alphanumeric characters", () => {
    expect(generateRepoName("!!!")).toMatch(/^project-[0-9a-f]{8}$/);
  });
});
