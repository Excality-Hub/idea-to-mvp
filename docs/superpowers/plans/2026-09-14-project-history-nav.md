# Project Switcher And Run History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every pipeline run as a "project" record and add a project switcher in the header's top-left corner that lets you pick any past project and view its stage timeline read-only, or jump back to the live run.

**Architecture:** A new `ProjectStore` (JSON file, same pattern as the existing agent/workflow stores) holds one `ProjectRecord` per run: idea text, repo name, created-at, and the full list of `RunEvent`s emitted over that run's lifetime. `RunController` creates a record when a run starts and subscribes to its own event bus to append every event to it for the run's whole lifetime (including across stop/resume/gate-decide cycles). Two new read-only API routes expose the list (summaries only) and one full record. On the frontend, the ReactFlow stage graph is extracted out of `WorkflowsView` into a shared `StageFlowGraph` component so it can be reused by a new read-only `ProjectHistoryView`; a `ProjectSwitcher` dropdown in `Header` lets the user pick a past project (rendering `ProjectHistoryView`) or return to the live view (rendering the existing `WorkflowsView`).

**Tech Stack:** TypeScript, Express, React, @xyflow/react (React Flow), radix-ui (DropdownMenu), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-14-project-history-nav-design.md`

## Global Constraints

- One run = one project. Starting a new idea always creates a new project; projects never group multiple runs (per spec Non-goals).
- Past projects are strictly read-only — no resume/stop/gate-decide actions render or are wired up for anything but the live run.
- Persistence is a plain JSON file via the existing `createJsonStore` pattern (`data/projects.json`) — no database.
- No new naming step: a project's display name is always its `ideaText`, truncated to 60 characters with a trailing "…" when longer.
- No changes to the disabled "Runs history" sidebar item (`Sidebar.tsx`) — it stays as-is; the switcher lives only in `Header`.
- No new UI dependency: the dropdown is built on the already-installed `radix-ui` package (same package `sheet.tsx` already builds `Sheet` on top of).

---

### Task 1: Backend `ProjectStore`

**Files:**
- Create: `src/orchestrator/projectStore.ts`
- Test: `src/orchestrator/projectStore.test.ts`

**Interfaces:**
- Produces: `ProjectRecord { id, ideaText, repoName, createdAt, events: RunEvent[] }`, `ProjectSummary = Omit<ProjectRecord, "events">`, `ProjectStore` (a `JsonStore<ProjectRecord>` plus `appendEvent(id, event)`), `createProjectStore(filePath): ProjectStore` — all consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Create `src/orchestrator/projectStore.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "./projectStore.js";
import type { RunEvent } from "./types.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "project-store-test-"));
  return join(dir, "projects.json");
}

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-14T00:00:00.000Z",
};

describe("createProjectStore", () => {
  it("starts empty when the file doesn't exist yet", () => {
    const store = createProjectStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and gets a project record", () => {
    const store = createProjectStore(tempFile());
    const record = {
      id: "p1",
      ideaText: "Build a todo app",
      repoName: "idea-to-mvp-1",
      createdAt: "2026-09-14T00:00:00.000Z",
      events: [],
    };

    store.create(record);

    expect(store.get("p1")).toEqual(record);
    expect(store.list()).toEqual([record]);
  });

  it("appends an event to an existing record's events", () => {
    const store = createProjectStore(tempFile());
    store.create({
      id: "p1",
      ideaText: "Build a todo app",
      repoName: "idea-to-mvp-1",
      createdAt: "2026-09-14T00:00:00.000Z",
      events: [],
    });

    store.appendEvent("p1", sampleEvent);

    expect(store.get("p1")?.events).toEqual([sampleEvent]);
  });

  it("does nothing when appending an event to an unknown project id", () => {
    const store = createProjectStore(tempFile());

    expect(() => store.appendEvent("nope", sampleEvent)).not.toThrow();
    expect(store.get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root): `npx vitest run src/orchestrator/projectStore.test.ts`
Expected: FAIL — `./projectStore.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/orchestrator/projectStore.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/orchestrator/projectStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/projectStore.ts src/orchestrator/projectStore.test.ts
git commit -m "$(cat <<'EOF'
feat: add a JSON-backed ProjectStore for run history

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 2: `RunController` persists every run to a project record

**Files:**
- Modify: `src/orchestrator/runController.ts`
- Modify: `src/orchestrator/runController.test.ts`

**Interfaces:**
- Consumes: `ProjectStore`, `ProjectRecord` from Task 1 (`./projectStore.js`).
- Produces: `RunControllerConfig` gains a required `projectStore: ProjectStore` field; `RunController.getCurrentProjectId(): string | undefined` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `src/orchestrator/runController.test.ts`, add the import and a fake store factory near the existing `makeAgentStore`/`makeWorkflowStore` helpers:

```ts
import type { ProjectRecord } from "./projectStore.js";
import type { ProjectStore } from "./projectStore.js";
```

```ts
function makeProjectStore(): ProjectStore {
  const records = new Map<string, ProjectRecord>();
  return {
    list: () => Array.from(records.values()),
    get: (id) => records.get(id),
    create: (item) => {
      records.set(item.id, item);
    },
    update: (id, item) => {
      records.set(id, item);
    },
    delete: (id) => {
      records.delete(id);
    },
    appendEvent: (id, event) => {
      const record = records.get(id);
      if (record) records.set(id, { ...record, events: [...record.events, event] });
    },
  };
}
```

Add `projectStore: makeProjectStore(),` to the object returned by `makeConfig()` (alongside the existing `agentStore`/`workflowStore` lines).

Then add these tests inside the `describe("RunController", ...)` block:

```ts
  it("creates a project record with the idea text and repo name when a run starts", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("Build a todo app");
    const projectId = controller.getCurrentProjectId();

    expect(projectId).toBeDefined();
    const record = config.projectStore.get(projectId!);
    expect(record?.ideaText).toBe("Build a todo app");
    expect(record?.repoName).toMatch(/^idea-to-mvp-/);
    await controller.getRunPromise();
  });

  it("has no current project id before any run starts", () => {
    const controller = new RunController(makeConfig());

    expect(controller.getCurrentProjectId()).toBeUndefined();
  });

  it("appends every emitted event to the project record, including across a stop/resume cycle", async () => {
    const config = makeConfig();
    let firstAttempt = true;
    vi.mocked(config.deps.agents.developer).mockImplementation(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) => {
        if (!firstAttempt) {
          return Promise.resolve({
            output: { prTitle: "t", prBody: "b" },
            usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.001 },
          });
        }
        firstAttempt = false;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        });
      },
    );
    const controller = new RunController(config);

    controller.start("Build a todo app");
    const projectId = controller.getCurrentProjectId()!;
    await waitForStage(controller.eventBus, "developer", "running");
    controller.stop();
    await controller.getRunPromise();
    controller.resume();
    await controller.getRunPromise();

    const record = config.projectStore.get(projectId);
    expect(record?.events.length).toBeGreaterThan(0);
    expect(record?.events.some((e) => e.stage === "deploy" && e.status === "done")).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/orchestrator/runController.test.ts`
Expected: FAIL — `makeConfig()` doesn't satisfy `RunControllerConfig` (missing `projectStore`) and `getCurrentProjectId` doesn't exist yet.

- [ ] **Step 3: Implement**

In `src/orchestrator/runController.ts`, add the import:

```ts
import { randomUUID } from "node:crypto";
```

(alongside the existing `mkdtempSync`/`EventEmitter`/`tmpdir`/`join` imports at the top of the file)

```ts
import type { ProjectStore } from "./projectStore.js";
```

Add `projectStore: ProjectStore;` to `RunControllerConfig`:

```ts
export interface RunControllerConfig {
  owner: string;
  starterDir: string;
  githubToken: string;
  agentStore: AgentStore;
  workflowStore: WorkflowStore;
  projectStore: ProjectStore;
  deps: Omit<OrchestratorDeps, "eventBus">;
}
```

Add a private field next to the existing ones in the `RunController` class:

```ts
  private currentProjectId: string | undefined;
```

Add the getter next to `getPlan()`:

```ts
  getCurrentProjectId(): string | undefined {
    return this.currentProjectId;
  }
```

In `start()`, right after the existing `const params: OrchestratorParams = { ... };` block and before the existing `this.runFrom(params, undefined);` line, insert:

```ts
    this.currentProjectId = randomUUID();
    this.config.projectStore.create({
      id: this.currentProjectId,
      ideaText,
      repoName: params.repoName,
      createdAt: new Date().toISOString(),
      events: [],
    });
    this.eventBus.onEvent((event) => {
      this.config.projectStore.appendEvent(this.currentProjectId!, event);
    });
```

So `start()`'s tail now reads:

```ts
    const params: OrchestratorParams = {
      ideaText,
      owner: this.config.owner,
      repoName: `idea-to-mvp-${Date.now()}`,
      starterDir: this.config.starterDir,
      workDir: mkdtempSync(join(tmpdir(), "idea-to-mvp-")),
      githubToken: this.config.githubToken,
      resolvedWorkflow,
    };
    this.currentProjectId = randomUUID();
    this.config.projectStore.create({
      id: this.currentProjectId,
      ideaText,
      repoName: params.repoName,
      createdAt: new Date().toISOString(),
      events: [],
    });
    this.eventBus.onEvent((event) => {
      this.config.projectStore.appendEvent(this.currentProjectId!, event);
    });
    this.runFrom(params, undefined);
  }
```

This subscription is created once per `start()` call, on whichever event bus is current at that point (freshly replaced a few lines earlier if the previous run had finished). Since `stop()`/`resume()`/`decideGate()` all reuse the same `this.eventBus` and never call `start()` again, this one subscription captures every event for the run's entire lifetime.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/orchestrator/runController.test.ts`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runController.ts src/orchestrator/runController.test.ts
git commit -m "$(cat <<'EOF'
feat: record every run's events to a project store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 3: `GET /api/projects` and `GET /api/projects/:id`, wired into `cli.ts`

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/server.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `ProjectStore`, `ProjectRecord`, `ProjectSummary` from Task 1; `RunController.getCurrentProjectId()` from Task 2.
- Produces: `createProjectHandlers(projectStore, controller): { list, get }`; `createDashboardServer` gains a required fourth parameter `projectStore: ProjectStore`.

- [ ] **Step 1: Write the failing tests**

In `src/dashboard/server.test.ts`, add imports:

```ts
import type { ProjectRecord } from "../orchestrator/projectStore.js";
import type { ProjectStore } from "../orchestrator/projectStore.js";
import { createProjectHandlers } from "./server.js";
```

Add a fake store helper near the top of the file (same style as the file's existing fakes):

```ts
function makeProjectStore(projects: ProjectRecord[] = []): ProjectStore {
  return {
    list: () => projects,
    get: (id) => projects.find((p) => p.id === id),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    appendEvent: vi.fn(),
  };
}
```

Add this describe block:

```ts
describe("createProjectHandlers", () => {
  const older: ProjectRecord = {
    id: "p-older",
    ideaText: "Build a blog",
    repoName: "idea-to-mvp-1",
    createdAt: "2026-09-13T00:00:00.000Z",
    events: [sampleEvent],
  };
  const newer: ProjectRecord = {
    id: "p-newer",
    ideaText: "Build a todo app",
    repoName: "idea-to-mvp-2",
    createdAt: "2026-09-14T00:00:00.000Z",
    events: [],
  };

  it("lists project summaries newest-first, without their events, plus the current project id", () => {
    const projectStore = makeProjectStore([older, newer]);
    const controller = { getCurrentProjectId: () => "p-newer" };
    const { list } = createProjectHandlers(projectStore, controller);
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith({
      projects: [
        { id: "p-newer", ideaText: "Build a todo app", repoName: "idea-to-mvp-2", createdAt: "2026-09-14T00:00:00.000Z" },
        { id: "p-older", ideaText: "Build a blog", repoName: "idea-to-mvp-1", createdAt: "2026-09-13T00:00:00.000Z" },
      ],
      currentProjectId: "p-newer",
    });
  });

  it("reports currentProjectId as null when no run has started", () => {
    const projectStore = makeProjectStore([]);
    const controller = { getCurrentProjectId: () => undefined };
    const { list } = createProjectHandlers(projectStore, controller);
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith({ projects: [], currentProjectId: null });
  });

  it("gets a single project record including its events", () => {
    const projectStore = makeProjectStore([older]);
    const controller = { getCurrentProjectId: () => undefined };
    const { get } = createProjectHandlers(projectStore, controller);
    const res = makeFakeRes();

    get({ params: { id: "p-older" } } as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(older);
  });

  it("404s for an unknown project id", () => {
    const projectStore = makeProjectStore([]);
    const controller = { getCurrentProjectId: () => undefined };
    const { get } = createProjectHandlers(projectStore, controller);
    const res = makeFakeRes();

    get({ params: { id: "nope" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
```

Note: this reuses the file's existing `sampleEvent` (defined near the top, `stage: "analyst"`) and `makeFakeRes()` helpers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: FAIL — `createProjectHandlers` is not exported from `./server.js`.

- [ ] **Step 3: Implement**

In `src/dashboard/server.ts`, add the import:

```ts
import type { ProjectStore } from "../orchestrator/projectStore.js";
```

Add this function (placed after `createWorkflowHandlers`, before `createDashboardServer`):

```ts
export function createProjectHandlers(
  projectStore: Pick<ProjectStore, "list" | "get">,
  controller: Pick<RunController, "getCurrentProjectId">,
): { list: express.RequestHandler; get: express.RequestHandler } {
  const list: express.RequestHandler = (_req, res) => {
    const projects = projectStore
      .list()
      .map(({ events: _events, ...summary }) => summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ projects, currentProjectId: controller.getCurrentProjectId() ?? null });
  };

  const get: express.RequestHandler = (req, res) => {
    const project = projectStore.get(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  };

  return { list, get };
}
```

Update `createDashboardServer`'s signature and body:

```ts
export function createDashboardServer(
  controller: RunController,
  agentStore: AgentStore,
  workflowStore: WorkflowStore,
  projectStore: ProjectStore,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));
  app.get("/events", createEventsHandler(controller));
  const { start, stop, resume, approveGate, rejectGate } = createRunHandlers(controller);
  app.post("/api/run", start);
  app.post("/api/run/stop", stop);
  app.post("/api/run/resume", resume);
  app.post("/api/run/gates/:id/approve", approveGate);
  app.post("/api/run/gates/:id/reject", rejectGate);
  app.get("/api/run/plan", (_req, res) => {
    res.json(controller.getPlan() ?? []);
  });
  const agentHandlers = createAgentHandlers(agentStore, workflowStore);
  app.get("/api/agents", agentHandlers.list);
  app.post("/api/agents", agentHandlers.create);
  app.delete("/api/agents/:id", agentHandlers.remove);
  const workflowHandlers = createWorkflowHandlers(workflowStore, agentStore);
  app.get("/api/workflows", workflowHandlers.list);
  app.post("/api/workflows", workflowHandlers.create);
  app.put("/api/workflows/:id", workflowHandlers.update);
  app.delete("/api/workflows/:id", workflowHandlers.remove);
  const projectHandlers = createProjectHandlers(projectStore, controller);
  app.get("/api/projects", projectHandlers.list);
  app.get("/api/projects/:id", projectHandlers.get);
  return app;
}
```

In `src/cli.ts`, add the import:

```ts
import { createProjectStore } from "./orchestrator/projectStore.js";
```

Add the store construction next to the existing `workflowStore` line:

```ts
  const projectStore = createProjectStore(fileURLToPath(new URL("../data/projects.json", import.meta.url)));
```

Add `projectStore,` to the `RunController` config object (alongside the existing `agentStore,`/`workflowStore,` lines), and add the fourth argument to `createDashboardServer`:

```ts
  const app = createDashboardServer(controller, agentStore, workflowStore, projectStore);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/dashboard/server.test.ts` (expect PASS), then `npx tsc --noEmit` from repo root (expect no errors — this catches the `cli.ts` call-site update).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts src/cli.ts
git commit -m "$(cat <<'EOF'
feat: add GET /api/projects and /api/projects/:id endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 4: Frontend types + `useProjects` hook

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/hooks/useProjects.ts`
- Test: `web/src/hooks/useProjects.test.ts`

**Interfaces:**
- Produces: `ProjectRecord`, `ProjectSummary` (mirrors Task 1's backend types) added to `web/src/types.ts`; `useProjects(): { projects: ProjectSummary[], currentProjectId: string | null, loading, error, refetch }` — consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/useProjects.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjects } from "./useProjects";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useProjects", () => {
  it("fetches the project list and current project id from /api/projects on mount", async () => {
    const body = {
      projects: [
        { id: "p1", ideaText: "Build a todo app", repoName: "idea-to-mvp-1", createdAt: "2026-09-14T00:00:00.000Z" },
      ],
      currentProjectId: "p1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual(body.projects);
    expect(result.current.currentProjectId).toBe("p1");
    expect(fetch).toHaveBeenCalledWith("/api/projects");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.projects).toEqual([]);
    expect(result.current.currentProjectId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useProjects.test.ts`
Expected: FAIL — `./useProjects` does not exist.

- [ ] **Step 3: Implement**

Append to `web/src/types.ts` (after the existing `WorkflowDefinition` interface):

```ts
export interface ProjectRecord {
  id: string;
  ideaText: string;
  repoName: string;
  createdAt: string;
  events: RunEvent[];
}

export type ProjectSummary = Omit<ProjectRecord, "events">;
```

Create `web/src/hooks/useProjects.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "@/types";

export interface UseProjectsResult {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch("/api/projects")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
        return res.json() as Promise<{ projects: ProjectSummary[]; currentProjectId: string | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setProjects(data.projects);
          setCurrentProjectId(data.currentProjectId);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refetchToken]);

  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  return { projects, currentProjectId, loading, error, refetch };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useProjects.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/hooks/useProjects.ts web/src/hooks/useProjects.test.ts
git commit -m "$(cat <<'EOF'
feat: add ProjectRecord types and a useProjects hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 5: `useProject(id)` hook

**Files:**
- Create: `web/src/hooks/useProject.ts`
- Test: `web/src/hooks/useProject.test.ts`

**Interfaces:**
- Consumes: `ProjectRecord` from Task 4 (`@/types`).
- Produces: `useProject(id: string | null): { project: ProjectRecord | undefined, loading: boolean, error: string | undefined }` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Create `web/src/hooks/useProject.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProject } from "./useProject";

afterEach(() => {
  vi.unstubAllGlobals();
});

const project = {
  id: "p1",
  ideaText: "Build a todo app",
  repoName: "idea-to-mvp-1",
  createdAt: "2026-09-14T00:00:00.000Z",
  events: [],
};

describe("useProject", () => {
  it("does not fetch when id is null", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProject(null));

    expect(result.current.project).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the project from /api/projects/:id when id is set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(project) }));

    const { result } = renderHook(() => useProject("p1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project).toEqual(project);
    expect(fetch).toHaveBeenCalledWith("/api/projects/p1");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const { result } = renderHook(() => useProject("nope"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.project).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/hooks/useProject.test.ts`
Expected: FAIL — `./useProject` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/hooks/useProject.ts`:

```ts
import { useEffect, useState } from "react";
import type { ProjectRecord } from "@/types";

export interface UseProjectResult {
  project: ProjectRecord | undefined;
  loading: boolean;
  error: string | undefined;
}

export function useProject(id: string | null): UseProjectResult {
  const [project, setProject] = useState<ProjectRecord | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!id) {
      setProject(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch(`/api/projects/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load project (${res.status})`);
        return res.json() as Promise<ProjectRecord>;
      })
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { project, loading, error };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/hooks/useProject.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useProject.ts web/src/hooks/useProject.test.ts
git commit -m "$(cat <<'EOF'
feat: add a useProject(id) hook for fetching one project record

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 6: Extract `StageFlowGraph`, refactor `WorkflowsView` to use it

**Files:**
- Create: `web/src/components/StageFlowGraph.tsx`
- Test: `web/src/components/StageFlowGraph.test.tsx`
- Modify: `web/src/components/WorkflowsView.tsx`

**Interfaces:**
- Consumes: `buildStageNodes`, `buildStageEdges` (existing, `@/lib/workflowGraph`), `StageNode` (existing, `@/components/StageNode`), `EventsByStage` (existing, `@/lib/runEvents`).
- Produces: `StageFlowGraph({ eventsByStage, stageOrder, labelFor, onSelectStage })` — consumed by Task 7 and by the refactored `WorkflowsView`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/StageFlowGraph.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StageFlowGraph } from "./StageFlowGraph";
import type { EventsByStage } from "@/lib/runEvents";
import type { StageName } from "@/types";

const eventsByStage: EventsByStage = {
  analyst: [{ stage: "analyst", status: "done", message: "done", timestamp: "2026-01-01T00:00:00.000Z" }],
  architect: [{ stage: "architect", status: "running", message: "working", timestamp: "2026-01-01T00:01:00.000Z" }],
};
const stageOrder: StageName[] = ["analyst", "architect"];
const labelFor = (stage: StageName) => (stage === "analyst" ? "Analyst" : "Architect");

describe("StageFlowGraph", () => {
  it("renders one node per stage in stageOrder, labeled via labelFor", async () => {
    render(
      <StageFlowGraph eventsByStage={eventsByStage} stageOrder={stageOrder} labelFor={labelFor} onSelectStage={vi.fn()} />,
    );

    await screen.findByText("Analyst");
    expect(screen.getByText("Architect")).toBeInTheDocument();
  });

  it("calls onSelectStage with the clicked stage's name", async () => {
    const onSelectStage = vi.fn();
    const user = userEvent.setup();
    render(
      <StageFlowGraph
        eventsByStage={eventsByStage}
        stageOrder={stageOrder}
        labelFor={labelFor}
        onSelectStage={onSelectStage}
      />,
    );
    await screen.findByText("Analyst");

    await user.click(screen.getByText("Analyst"));

    expect(onSelectStage).toHaveBeenCalledWith("analyst");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/components/StageFlowGraph.test.tsx`
Expected: FAIL — `./StageFlowGraph` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/components/StageFlowGraph.tsx`:

```tsx
import { useMemo } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StageNode } from "@/components/StageNode";
import { buildStageEdges, buildStageNodes } from "@/lib/workflowGraph";
import type { EventsByStage } from "@/lib/runEvents";
import type { StageName } from "@/types";

const nodeTypes = { stage: StageNode };

export interface StageFlowGraphProps {
  eventsByStage: EventsByStage;
  stageOrder: StageName[];
  labelFor: (stage: StageName) => string;
  onSelectStage: (stage: StageName) => void;
}

export function StageFlowGraph({ eventsByStage, stageOrder, labelFor, onSelectStage }: StageFlowGraphProps) {
  const nodes = useMemo(() => buildStageNodes(eventsByStage, stageOrder, labelFor), [eventsByStage, stageOrder, labelFor]);
  const edges = useMemo(() => buildStageEdges(eventsByStage, stageOrder), [eventsByStage, stageOrder]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectStage(node.data.stage)}
        fitView
        // Node count varies with the resolved plan; minZoom is lowered so fitView can
        // always zoom out far enough to frame every stage, however many there are.
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
```

Modify `web/src/components/WorkflowsView.tsx`: replace its import block and remove the now-unused `nodeTypes` constant and inlined `nodes`/`edges` memos and `ReactFlow` JSX. The full file becomes:

```tsx
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { StageFlowGraph } from "@/components/StageFlowGraph";
import { useAgents } from "@/hooks/useAgents";
import { useRunPlan } from "@/hooks/useRunPlan";
import { useWorkflows } from "@/hooks/useWorkflows";
import { deriveOverallStatus, deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { getStageLabel } from "@/lib/workflowGraph";
import type { StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const TERMINAL_STATUSES = new Set(["deployed", "blocked", "failed"]);

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [workflowId, setWorkflowId] = useState("default");
  const [starting, setStarting] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);
  const [runGeneration, setRunGeneration] = useState(0);

  const overallStatus = deriveOverallStatus(eventsByStage);
  const isIdle = overallStatus === "idle";
  const isTerminal = TERMINAL_STATUSES.has(overallStatus);
  const showForm = isIdle || (isTerminal && showStartForm);

  const { workflows, error: workflowsError } = useWorkflows();
  const { agents } = useAgents();
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const stageOrder = useRunPlan(isIdle, runGeneration);
  const labelFor = useMemo(() => (stage: StageName) => getStageLabel(stage, agentsById), [agentsById]);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  async function handleStart() {
    setStarting(true);
    try {
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText, workflowId }),
      });
      setRunGeneration((g) => g + 1);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Live pipeline stages for the current run. Click a stage to see its full log.
          </p>
        </div>
        {isTerminal && !showStartForm && (
          <Button variant="outline" size="sm" onClick={() => setShowStartForm(true)}>
            Start a new run
          </Button>
        )}
      </div>
      {showForm ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6">
          <label htmlFor="idea-text" className="text-sm font-medium text-foreground">
            Idea &amp; requirements
          </label>
          <textarea
            id="idea-text"
            className="w-full max-w-lg rounded-lg border border-border bg-background p-3 text-sm"
            style={{ minHeight: 96 }}
            placeholder="Describe what you want to build and any specific requirements..."
            value={ideaText}
            onChange={(event) => setIdeaText(event.target.value)}
          />
          <div className="flex w-full max-w-lg flex-col gap-1">
            <label htmlFor="pipeline-picker" className="text-sm font-medium text-foreground">
              Pipeline
            </label>
            <select
              id="pipeline-picker"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={workflowId}
              onChange={(event) => setWorkflowId(event.target.value)}
            >
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
            {workflowsError && <p className="text-sm text-destructive">{workflowsError}</p>}
          </div>
          <Button onClick={handleStart} disabled={!ideaText.trim() || starting}>
            {starting ? "Starting..." : "Start run"}
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <StageFlowGraph
            eventsByStage={eventsByStage}
            stageOrder={stageOrder}
            labelFor={labelFor}
            onSelectStage={setSelectedStage}
          />
        </div>
      )}
      <StageDetailSheet
        label={selectedStage ? labelFor(selectedStage) : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null && !showForm}
        onOpenChange={(open) => {
          if (!open) setSelectedStage(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/StageFlowGraph.test.tsx src/components/WorkflowsView.test.tsx`
Expected: PASS for both files — `WorkflowsView.test.tsx` is unchanged and should keep passing since this is a pure extraction with no behavior change.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StageFlowGraph.tsx web/src/components/StageFlowGraph.test.tsx web/src/components/WorkflowsView.tsx
git commit -m "$(cat <<'EOF'
refactor: extract StageFlowGraph out of WorkflowsView

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 7: `ProjectHistoryView` (read-only)

**Files:**
- Create: `web/src/components/ProjectHistoryView.tsx`
- Test: `web/src/components/ProjectHistoryView.test.tsx`

**Interfaces:**
- Consumes: `StageFlowGraph` (Task 6), `ProjectRecord` (Task 4), `useAgents` (existing), `groupEventsByStage`/`deriveStageStatus` (existing, `@/lib/runEvents`), `getStageLabel` (existing, `@/lib/workflowGraph`), `StageDetailSheet` (existing).
- Produces: `ProjectHistoryView({ project: ProjectRecord })` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/ProjectHistoryView.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHistoryView } from "./ProjectHistoryView";
import type { ProjectRecord } from "@/types";

function stubFetch(agents: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve(agents) });
      return Promise.reject(new Error(`unexpected fetch to ${url}`));
    }),
  );
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const project: ProjectRecord = {
  id: "p1",
  ideaText: "Build a todo app",
  repoName: "idea-to-mvp-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  events: [
    { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
    { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
    { stage: "architect", status: "done", message: "Plan ready", timestamp: "2026-01-01T00:02:00.000Z" },
  ],
};

describe("ProjectHistoryView", () => {
  it("renders the idea text as the heading and a node per recorded stage, in first-seen order", async () => {
    render(<ProjectHistoryView project={project} />);

    expect(screen.getByRole("heading", { name: "Build a todo app" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("Architect")).toBeInTheDocument();
  });

  it("opens the detail sheet with a stage's recorded events on click, and shows no start form", async () => {
    const user = userEvent.setup();
    render(<ProjectHistoryView project={project} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());

    await user.click(screen.getByText("Analyst"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Analyzing idea")).toBeInTheDocument();
    expect(dialog.getByText("Todo app summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/components/ProjectHistoryView.test.tsx`
Expected: FAIL — `./ProjectHistoryView` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/components/ProjectHistoryView.tsx`:

```tsx
import { useMemo, useState } from "react";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { StageFlowGraph } from "@/components/StageFlowGraph";
import { useAgents } from "@/hooks/useAgents";
import { deriveStageStatus, groupEventsByStage } from "@/lib/runEvents";
import { getStageLabel } from "@/lib/workflowGraph";
import type { ProjectRecord, StageName } from "@/types";

interface ProjectHistoryViewProps {
  project: ProjectRecord;
}

export function ProjectHistoryView({ project }: ProjectHistoryViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const { agents } = useAgents();
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const labelFor = useMemo(() => (stage: StageName) => getStageLabel(stage, agentsById), [agentsById]);
  const eventsByStage = useMemo(() => groupEventsByStage(project.events), [project.events]);
  const stageOrder = useMemo(() => Object.keys(eventsByStage) as StageName[], [eventsByStage]);
  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">{project.ideaText}</h1>
        <p className="text-sm text-muted-foreground">
          Recorded run &middot; {new Date(project.createdAt).toLocaleString()} &middot; read-only
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        <StageFlowGraph
          eventsByStage={eventsByStage}
          stageOrder={stageOrder}
          labelFor={labelFor}
          onSelectStage={setSelectedStage}
        />
      </div>
      <StageDetailSheet
        label={selectedStage ? labelFor(selectedStage) : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedStage(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/ProjectHistoryView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ProjectHistoryView.tsx web/src/components/ProjectHistoryView.test.tsx
git commit -m "$(cat <<'EOF'
feat: add a read-only ProjectHistoryView for past projects

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 8: `ProjectSwitcher` dropdown (top-left)

**Files:**
- Create: `web/src/components/ui/dropdown-menu.tsx`
- Create: `web/src/components/ProjectSwitcher.tsx`
- Test: `web/src/components/ProjectSwitcher.test.tsx`

**Interfaces:**
- Consumes: `useProjects` from Task 4 (`@/hooks/useProjects`).
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` (thin wrapper around `radix-ui`'s `DropdownMenu`, mirroring `ui/sheet.tsx`'s wrapper around `Dialog`); `ProjectSwitcher({ selectedProjectId: string | null, onSelect: (projectId: string | null) => void })` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/ProjectSwitcher.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./ProjectSwitcher";

const body = {
  projects: [
    { id: "p-newer", ideaText: "Build a todo app", repoName: "idea-to-mvp-2", createdAt: "2026-09-14T00:00:00.000Z" },
    { id: "p-older", ideaText: "Build a blog", repoName: "idea-to-mvp-1", createdAt: "2026-09-13T00:00:00.000Z" },
  ],
  currentProjectId: "p-newer",
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectSwitcher", () => {
  it("lists every project, marking the current one Live", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());

    await user.click(screen.getByRole("button"));

    const liveItem = await screen.findByRole("menuitem", { name: /Build a todo app.*Live/s });
    expect(liveItem).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Build a blog/ })).toBeInTheDocument();
  });

  it("calls onSelect with a past project's id when it's clicked", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId={null} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));

    await user.click(await screen.findByRole("menuitem", { name: /Build a blog/ }));

    expect(onSelect).toHaveBeenCalledWith("p-older");
  });

  it("calls onSelect with null when the live entry is clicked", async () => {
    stubFetch();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSwitcher selectedProjectId="p-older" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await user.click(screen.getByRole("button"));

    await user.click(await screen.findByRole("menuitem", { name: /Build a todo app.*Live/s }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/components/ProjectSwitcher.test.tsx`
Expected: FAIL — `./ProjectSwitcher` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/components/ui/dropdown-menu.tsx` (mirrors `ui/sheet.tsx`'s wrapper style around a `radix-ui` primitive):

```tsx
import * as React from "react"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-56 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-sm outline-none data-highlighted:bg-muted data-highlighted:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
}
```

Create `web/src/components/ProjectSwitcher.tsx`:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/hooks/useProjects";

function truncate(text: string, max = 60): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

interface ProjectSwitcherProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
}

export function ProjectSwitcher({ selectedProjectId, onSelect }: ProjectSwitcherProps) {
  const { projects, currentProjectId } = useProjects();
  const viewedId = selectedProjectId ?? currentProjectId;
  const viewedProject = projects.find((p) => p.id === viewedId);
  const label = viewedProject ? truncate(viewedProject.ideaText) : "idea-to-mvp";
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const pastProjects = projects.filter((p) => p.id !== currentProjectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-muted">
        <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {currentProject && (
          <>
            <DropdownMenuItem onSelect={() => onSelect(null)}>
              <span className="font-medium text-foreground">{truncate(currentProject.ideaText)}</span>
              <span className="text-xs text-muted-foreground">Live</span>
            </DropdownMenuItem>
            {pastProjects.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {pastProjects.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
            <span className="font-medium text-foreground">{truncate(project.ideaText)}</span>
            <span className="text-xs text-muted-foreground">{new Date(project.createdAt).toLocaleString()}</span>
          </DropdownMenuItem>
        ))}
        {projects.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">No projects yet</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/ProjectSwitcher.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/dropdown-menu.tsx web/src/components/ProjectSwitcher.tsx web/src/components/ProjectSwitcher.test.tsx
git commit -m "$(cat <<'EOF'
feat: add a ProjectSwitcher dropdown for picking past projects

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 9: Wire `ProjectSwitcher` into `Header`/`App`

**Files:**
- Modify: `web/src/components/Header.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `ProjectSwitcher` (Task 8), `ProjectHistoryView` (Task 7), `useProject` (Task 5).
- Produces: nothing further — this is the final integration task.

There are no existing tests for `Header.tsx` or `App.tsx` (both are thin composition/glue, consistent with the rest of this codebase), so this task is verified by build + manual check rather than a new automated test, per the spec's testing plan.

- [ ] **Step 1: Modify `Header.tsx`**

Replace the whole file with:

```tsx
import { Badge } from "@/components/ui/badge";
import { OVERALL_STATUS_CONFIG } from "@/components/status";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import type { OverallStatus } from "@/types";

interface HeaderProps {
  overallStatus: OverallStatus;
  connected: boolean;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function Header({ overallStatus, connected, selectedProjectId, onSelectProject }: HeaderProps) {
  const status = OVERALL_STATUS_CONFIG[overallStatus];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-baseline gap-2">
        <ProjectSwitcher selectedProjectId={selectedProjectId} onSelect={onSelectProject} />
        <span className="hidden text-sm text-muted-foreground sm:inline">
          idea &rarr; PR &rarr; deploy, watched live
        </span>
      </div>
      <div className="flex items-center gap-3">
        {!connected && (
          <span className="text-xs text-muted-foreground">reconnecting&hellip;</span>
        )}
        <Badge className={`${status.className} border-none font-medium`}>{status.label}</Badge>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Modify `App.tsx`**

Replace the whole file with:

```tsx
import { useState } from "react";
import { AgentsView } from "@/components/AgentsView";
import { Header } from "@/components/Header";
import { PipelinesView } from "@/components/PipelinesView";
import { ProjectHistoryView } from "@/components/ProjectHistoryView";
import { Sidebar, type SidebarView } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useProject } from "@/hooks/useProject";
import { useRunEvents } from "@/hooks/useRunEvents";

export function App() {
  const { eventsByStage, overallStatus, connected } = useRunEvents();
  const [activeView, setActiveView] = useState<SidebarView>("workflows");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { project } = useProject(selectedProjectId);

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        overallStatus={overallStatus}
        connected={connected}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeView={activeView} onSelect={setActiveView} />
        <main className="flex-1 overflow-hidden">
          <div hidden={activeView !== "workflows"} className="h-full">
            {selectedProjectId && project ? (
              <ProjectHistoryView project={project} />
            ) : (
              <WorkflowsView eventsByStage={eventsByStage} />
            )}
          </div>
          <div hidden={activeView !== "agents"} className="h-full">
            <AgentsView />
          </div>
          <div hidden={activeView !== "pipelines"} className="h-full">
            <PipelinesView />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 3: Run the full web test suite**

Run: `cd web && npm test`
Expected: PASS — every existing suite plus all suites added in Tasks 4-8.

- [ ] **Step 4: Run the full backend test suite and typecheck both projects**

Run (from repo root): `npm test && npx tsc --noEmit && npm run build --prefix web`
Expected: PASS — the backend suite (Tasks 1-3), and both projects typecheck/build cleanly.

- [ ] **Step 5: Manual verification**

Run: `npm run build && node dist/cli.js` (from repo root — matches how the app is normally started; use whatever dev command this repo's README documents if different).

1. Start a run with some idea text, let it progress a bit.
2. Start a second run (this requires the first to reach a terminal state — deployed/blocked/failed — first; if you want to test this without waiting for a full run, stub/mock is out of scope for manual verification, so just let a short run finish or use `qa` verdict `blocked` to reach a terminal state quickly).
3. Open the project switcher (top-left, where "idea-to-mvp" used to be) and confirm it lists both runs, with the current one marked "Live".
4. Select the first (now past) project and confirm its stage graph renders read-only: no idea/pipeline start form, no Stop/Resume/Approve/Reject buttons, and clicking a stage node opens its recorded log.
5. Select "Live" from the switcher and confirm the view returns to the current run's live, SSE-driven graph.
6. Confirm the Agents and Pipelines tabs are unaffected by project selection.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Header.tsx web/src/App.tsx
git commit -m "$(cat <<'EOF'
feat: wire the project switcher into the header and app shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** `ProjectRecord`/`ProjectStore` (Task 1), `RunController` persistence (Task 2), API routes + `cli.ts` wiring (Task 3), frontend type mirror + `useProjects`/`useProject` (Tasks 4-5), `StageFlowGraph` extraction (Task 6), `ProjectHistoryView` (Task 7), `ProjectSwitcher` (Task 8), `Header`/`App` wiring (Task 9) — every file listed in the spec's Architecture section has a task.
- **Type consistency:** `ProjectRecord`/`ProjectSummary` field names (`id`, `ideaText`, `repoName`, `createdAt`, `events`) are identical across Task 1 (backend), Task 3 (API), and Task 4 (frontend mirror). `StageFlowGraphProps` field names (`eventsByStage`, `stageOrder`, `labelFor`, `onSelectStage`) match between Task 6's implementation and Task 7's/`WorkflowsView`'s usage.
- **Read-only guarantee:** `ProjectHistoryView` never renders `WorkflowsView`'s start form or posts to any `/api/run/*` route — it only reads `project.events` and renders `StageFlowGraph`/`StageDetailSheet`, both of which are pure display components once past a stage's live-only "running"/"stopped" states (which cannot occur in a persisted, superseded project, since `RunController.start()` refuses to start a new run while the previous one is still "running" or "stopped").
