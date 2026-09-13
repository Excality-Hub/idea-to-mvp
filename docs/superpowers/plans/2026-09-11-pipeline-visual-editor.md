# Pipeline Visual Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Pipelines page's dropdown-based slot form with a drag-and-drop visual editor (backbone strip + 3 slot drop zones + an agent palette, built with `@dnd-kit`), and let it also edit an already-saved pipeline via a new `PUT /api/workflows/:id` endpoint.

**Architecture:** A generic `update(id, item)` method added to `JsonStore<T>` (and thus `WorkflowStore` for free) backs a new `PUT /api/workflows/:id` handler that reuses the existing create-validation logic. On the frontend, a pure `applyDragEnd` reducer (no DOM/React) implements the actual drop-handling rules, fully unit-tested in isolation; `PipelineEditor.tsx` is the drag-and-drop UI built on `@dnd-kit`, taking an optional `initial` workflow to switch between create (`POST`) and edit (`PUT`) modes; `PipelinesView.tsx` keeps its list-of-saved-pipelines rendering but replaces its inline form with buttons that open `PipelineEditor`.

**Tech Stack:** TypeScript, Node 20+, Express, Zod, Vitest (backend); React 19, Vite, Tailwind v4, `@dnd-kit/core`/`@dnd-kit/sortable`/`@dnd-kit/utilities` (new), Vitest + React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-11-pipeline-visual-editor-design.md`

## Global Constraints

- The backbone's shape and the three named slots (`afterAnalyst`, `afterArchitect`, `afterQa`) are unchanged — this plan only changes how a workflow is authored, not what it can express.
- No React Flow in the editor — it's a plain flex/CSS layout, kept separate from `WorkflowsView`'s existing `@xyflow/react` canvas.
- No cross-slot dragging of an already-placed agent — dropping a placed chip on a different slot than its own is a no-op (remove-then-re-add-from-palette is the only way to move an agent between slots).
- The built-in `"default"` workflow can never be edited (`PUT`) or deleted (`DELETE`) — both return 400.
- New frontend dependencies are pinned to `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` (installed via `npm install`, not hand-edited into `package.json`).
- All existing tests must keep passing (with the fixture updates itemized in Task 1, made necessary by widening the `JsonStore<T>` interface).

---

### Task 1: `JsonStore.update()` and its ripple to existing test fixtures

**Files:**
- Modify: `src/jsonStore.ts`
- Modify: `src/jsonStore.test.ts`
- Modify: `src/orchestrator/runController.test.ts`
- Modify: `src/dashboard/server.test.ts`

**Interfaces:**
- Produces: `JsonStore<T>` gains `update(id: string, item: T): void`. `AgentStore`/`WorkflowStore` (type aliases for `JsonStore<...>`) inherit it automatically.

Widening `JsonStore<T>`'s interface means every object literal typed as `AgentStore`/`WorkflowStore` in existing tests must now also provide `update`, or it won't compile. Two other test files build such fakes: `src/orchestrator/runController.test.ts` and `src/dashboard/server.test.ts`, each with a `makeAgentStore`/`makeWorkflowStore` helper.

- [ ] **Step 1: Write the failing tests**

Append to `src/jsonStore.test.ts` (inside the existing `describe("createJsonStore", ...)` block):

```typescript
  it("update() replaces an item by id and persists the change", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);

    store.update("a", { id: "a", name: "A2" });

    expect(store.list()).toEqual([{ id: "a", name: "A2" }, { id: "b", name: "B" }]);
    const reopened = createJsonStore<Widget>(filePath, []);
    expect(reopened.list()).toEqual([{ id: "a", name: "A2" }, { id: "b", name: "B" }]);
  });

  it("update() is a no-op when the id doesn't exist", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, [{ id: "a", name: "A" }]);

    store.update("missing", { id: "missing", name: "X" });

    expect(store.list()).toEqual([{ id: "a", name: "A" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/jsonStore.test.ts`
Expected: FAIL — `store.update is not a function`

- [ ] **Step 3: Modify `src/jsonStore.ts`**

Add `update` to the interface and the implementation:

```typescript
export interface JsonStore<T extends { id: string }> {
  list(): T[];
  get(id: string): T | undefined;
  create(item: T): void;
  update(id: string, item: T): void;
  delete(id: string): void;
}
```

and, in the object `createJsonStore` returns, add:

```typescript
    update: (id, item) => writeAll(readAll().map((existing) => (existing.id === id ? item : existing))),
```

(placed between `create` and `delete` in the returned object, matching the interface's declared order — purely cosmetic, no functional requirement).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/jsonStore.test.ts`
Expected: PASS (7 tests: 5 pre-existing + 2 new)

- [ ] **Step 5: Fix the two other fixture files broken by the interface change**

In `src/orchestrator/runController.test.ts`, both `makeAgentStore` and `makeWorkflowStore` currently return an object literal ending in `create: vi.fn(), delete: vi.fn(),`. Add `update: vi.fn(),` between them in both:

```typescript
function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: () => agents,
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[]): WorkflowStore {
  return {
    list: () => workflows,
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}
```

In `src/dashboard/server.test.ts`, both `makeAgentStore` and `makeWorkflowStore` currently return an object literal with `create: vi.fn((item) => ...push(item)), delete: vi.fn(),`. Add `update: vi.fn(),` between them in both:

```typescript
function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: vi.fn(() => agents),
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn((item) => agents.push(item)),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[] = []): WorkflowStore {
  return {
    list: vi.fn(() => workflows),
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn((item) => workflows.push(item)),
    update: vi.fn(),
    delete: vi.fn(),
  };
}
```

- [ ] **Step 6: Run the full backend suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (including the two files just touched, unchanged in behavior), no type errors

- [ ] **Step 7: Commit**

```bash
git add src/jsonStore.ts src/jsonStore.test.ts src/orchestrator/runController.test.ts src/dashboard/server.test.ts
git commit -m "feat: add update() to JsonStore"
```

---

### Task 2: `PUT /api/workflows/:id`

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `WorkflowStore.update` (Task 1), `WorkflowInputSchema` from `../orchestrator/types.js` (existing), `DEFAULT_WORKFLOW_ID` from `../orchestrator/workflowStore.js` (existing).
- Produces: `createWorkflowHandlers`'s returned object gains an `update: express.RequestHandler`. `createDashboardServer` wires `app.put("/api/workflows/:id", workflowHandlers.update)`.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe("createWorkflowHandlers", ...)` block in `src/dashboard/server.test.ts`:

```typescript
  it("updates a non-default workflow and returns 200", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const existing = {
      id: "w1",
      name: "Old",
      slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const workflowStore = makeWorkflowStore([existing]);
    const { update } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    update(
      {
        params: { id: "w1" },
        body: { name: "New", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] } },
      } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({
        id: "w1",
        name: "New",
        slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects editing the default workflow with 400", () => {
    const workflowStore = makeWorkflowStore();
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update(
      { params: { id: "default" }, body: { name: "X", slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the workflow id doesn't exist", () => {
    const workflowStore = makeWorkflowStore([]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update(
      { params: { id: "missing" }, body: { name: "X", slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when the updated slots reference an unknown agent id", () => {
    const existing = {
      id: "w1",
      name: "Old",
      slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const workflowStore = makeWorkflowStore([existing]);
    const { update } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    update(
      {
        params: { id: "w1" },
        body: { name: "New", slots: { afterAnalyst: ["missing"], afterArchitect: [], afterQa: [] } },
      } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/dashboard/server.test.ts`
Expected: FAIL — `createWorkflowHandlers(...)` doesn't return an `update` property

- [ ] **Step 3: Modify `src/dashboard/server.ts`**

Inside `createWorkflowHandlers`, extract the existing `create` handler's validation into a local helper, then add `update`. Replace the whole function body with:

```typescript
export function createWorkflowHandlers(
  workflowStore: WorkflowStore,
  agentStore: AgentStore,
): {
  list: express.RequestHandler;
  create: express.RequestHandler;
  update: express.RequestHandler;
  remove: express.RequestHandler;
} {
  function validateWorkflowInput(
    body: unknown,
  ): { ok: true; data: { name: string; slots: WorkflowDefinition["slots"] } } | { ok: false; error: string } {
    const parsed = WorkflowInputSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const allIds = [
      ...parsed.data.slots.afterAnalyst,
      ...parsed.data.slots.afterArchitect,
      ...parsed.data.slots.afterQa,
    ];
    const unknownId = allIds.find((id) => !agentStore.get(id));
    if (unknownId) {
      return { ok: false, error: `Unknown agent id: ${unknownId}` };
    }
    if (new Set(allIds).size !== allIds.length) {
      return { ok: false, error: "An agent may appear at most once across a workflow's slots" };
    }
    return { ok: true, data: parsed.data };
  }

  const list: express.RequestHandler = (_req, res) => {
    res.json(workflowStore.list());
  };

  const create: express.RequestHandler = (req, res) => {
    const validation = validateWorkflowInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const workflow: WorkflowDefinition = { id: randomUUID(), ...validation.data, createdAt: new Date().toISOString() };
    workflowStore.create(workflow);
    res.status(201).json(workflow);
  };

  const update: express.RequestHandler = (req, res) => {
    if (req.params.id === DEFAULT_WORKFLOW_ID) {
      res.status(400).json({ error: "Cannot edit the default workflow" });
      return;
    }
    const existing = workflowStore.get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const validation = validateWorkflowInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const workflow: WorkflowDefinition = { ...existing, ...validation.data };
    workflowStore.update(req.params.id, workflow);
    res.status(200).json(workflow);
  };

  const remove: express.RequestHandler = (req, res) => {
    if (req.params.id === DEFAULT_WORKFLOW_ID) {
      res.status(400).json({ error: "Cannot delete the default workflow" });
      return;
    }
    workflowStore.delete(req.params.id);
    res.status(204).end();
  };

  return { list, create, update, remove };
}
```

Then, in `createDashboardServer`, add one line after the existing `POST /api/workflows` route:

```typescript
  app.post("/api/workflows", workflowHandlers.create);
  app.put("/api/workflows/:id", workflowHandlers.update);
  app.delete("/api/workflows/:id", workflowHandlers.remove);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/dashboard/server.test.ts`
Expected: PASS (all pre-existing tests unchanged, plus the 4 new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "feat: add PUT /api/workflows/:id for editing a saved pipeline"
```

---

### Task 3: Pure drag-end reducer (`applyDragEnd`)

**Files:**
- Create: `web/src/lib/pipelineEditor.ts`
- Create: `web/src/lib/pipelineEditor.test.ts`
- Modify: `web/package.json` / `web/package-lock.json` (via `npm install`, not hand-edited)

**Interfaces:**
- Consumes: `arrayMove` from `@dnd-kit/sortable`.
- Produces: `type SlotKey = "afterAnalyst" | "afterArchitect" | "afterQa"`, `interface SlotsState { afterAnalyst: string[]; afterArchitect: string[]; afterQa: string[] }`, `type DragActive = { type: "palette"; agentId: string } | { type: "slot-item"; slot: SlotKey; agentId: string }`, `type DragOver = { type: "slot"; slot: SlotKey } | { type: "slot-item"; slot: SlotKey; agentId: string }`, `function applyDragEnd(slots: SlotsState, active: DragActive, over: DragOver | undefined): SlotsState` — all used by Task 4.

- [ ] **Step 1: Install the new dependencies**

Run, from `web/`:
```bash
npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

- [ ] **Step 2: Write the failing tests**

```typescript
// web/src/lib/pipelineEditor.test.ts
import { describe, expect, it } from "vitest";
import { applyDragEnd, type SlotsState } from "./pipelineEditor";

const EMPTY: SlotsState = { afterAnalyst: [], afterArchitect: [], afterQa: [] };

describe("applyDragEnd", () => {
  it("appends a palette item to an empty slot", () => {
    const result = applyDragEnd(EMPTY, { type: "palette", agentId: "a" }, { type: "slot", slot: "afterAnalyst" });

    expect(result).toEqual({ afterAnalyst: ["a"], afterArchitect: [], afterQa: [] });
  });

  it("appends a palette item to a non-empty slot, preserving existing order", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(slots, { type: "palette", agentId: "b" }, { type: "slot", slot: "afterAnalyst" });

    expect(result.afterAnalyst).toEqual(["a", "b"]);
  });

  it("does not duplicate a palette item already in the target slot", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(slots, { type: "palette", agentId: "a" }, { type: "slot", slot: "afterAnalyst" });

    expect(result).toBe(slots);
  });

  it("reorders within a slot when dropped on another item in the same slot", () => {
    const slots: SlotsState = { afterAnalyst: ["a", "b", "c"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(
      slots,
      { type: "slot-item", slot: "afterAnalyst", agentId: "a" },
      { type: "slot-item", slot: "afterAnalyst", agentId: "c" },
    );

    expect(result.afterAnalyst).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when a slot item is dropped on a different slot", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: ["b"], afterQa: [] };

    const result = applyDragEnd(
      slots,
      { type: "slot-item", slot: "afterAnalyst", agentId: "a" },
      { type: "slot", slot: "afterArchitect" },
    );

    expect(result).toBe(slots);
  });

  it("is a no-op when dropped on the slot's own empty space rather than another item", () => {
    const slots: SlotsState = { afterAnalyst: ["a", "b"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(
      slots,
      { type: "slot-item", slot: "afterAnalyst", agentId: "a" },
      { type: "slot", slot: "afterAnalyst" },
    );

    expect(result).toBe(slots);
  });

  it("is a no-op when there is no drop target", () => {
    const slots: SlotsState = { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] };

    const result = applyDragEnd(slots, { type: "palette", agentId: "b" }, undefined);

    expect(result).toBe(slots);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:web -- pipelineEditor` (from the repo root)
Expected: FAIL — module doesn't exist

- [ ] **Step 4: Write the implementation**

```typescript
// web/src/lib/pipelineEditor.ts
import { arrayMove } from "@dnd-kit/sortable";

export type SlotKey = "afterAnalyst" | "afterArchitect" | "afterQa";

export interface SlotsState {
  afterAnalyst: string[];
  afterArchitect: string[];
  afterQa: string[];
}

export type DragActive =
  | { type: "palette"; agentId: string }
  | { type: "slot-item"; slot: SlotKey; agentId: string };

export type DragOver =
  | { type: "slot"; slot: SlotKey }
  | { type: "slot-item"; slot: SlotKey; agentId: string };

export function applyDragEnd(slots: SlotsState, active: DragActive, over: DragOver | undefined): SlotsState {
  if (!over) return slots;

  if (active.type === "palette") {
    if (slots[over.slot].includes(active.agentId)) return slots;
    return { ...slots, [over.slot]: [...slots[over.slot], active.agentId] };
  }

  if (active.slot !== over.slot) {
    return slots;
  }
  if (over.type === "slot") {
    return slots;
  }
  const fromIndex = slots[active.slot].indexOf(active.agentId);
  const toIndex = slots[over.slot].indexOf(over.agentId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return slots;
  return { ...slots, [active.slot]: arrayMove(slots[active.slot], fromIndex, toIndex) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:web -- pipelineEditor`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full frontend suite and typecheck**

Run: `npm run test:web` and `npx tsc -b --noEmit` (from `web/`)
Expected: all pass, no type errors

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/pipelineEditor.ts web/src/lib/pipelineEditor.test.ts
git commit -m "feat: add @dnd-kit and a pure drag-end reducer for the pipeline editor"
```

---

### Task 4: `PipelineEditor` component

**Files:**
- Create: `web/src/components/PipelineEditor.tsx`
- Create: `web/src/components/PipelineEditor.test.tsx`

**Interfaces:**
- Consumes: `applyDragEnd`, `type SlotsState`, `type SlotKey`, `type DragActive`, `type DragOver` from `@/lib/pipelineEditor` (Task 3); `useAgents` from `@/hooks/useAgents` (existing); `STAGE_LABELS`, `type AgentDefinition`, `type StageName`, `type WorkflowDefinition` from `@/types` (existing); `Button` from `@/components/ui/button` (existing); `cn` from `@/lib/utils` (existing).
- Produces: `export function PipelineEditor({ initial, onSaved, onCancel }: { initial?: WorkflowDefinition; onSaved: () => void; onCancel: () => void }): JSX.Element` — consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/components/PipelineEditor.test.tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineEditor } from "./PipelineEditor";

const agentA = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB = { id: "b", name: "Agent B", instructions: "do b", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" };

function stubFetch(overrides: { agents?: unknown; save?: { ok: boolean; body?: unknown } } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? [agentA, agentB]) });
    }
    const save = overrides.save ?? { ok: true, body: {} };
    return Promise.resolve({ ok: save.ok, json: () => Promise.resolve(save.body ?? {}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelineEditor", () => {
  it("renders the fixed backbone stages", async () => {
    stubFetch();

    render(<PipelineEditor onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("QA review")).toBeInTheDocument();
    expect(screen.getByText("Deploy")).toBeInTheDocument();
  });

  it("shows agents not yet placed in the palette, and excludes a placed one", async () => {
    stubFetch();
    const initial = {
      id: "w1",
      name: "Existing",
      slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    render(<PipelineEditor initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(within(screen.getByTestId("agent-palette")).getByText("Agent B")).toBeInTheDocument());
    expect(within(screen.getByTestId("agent-palette")).queryByText("Agent A")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("after-analyst-slot")).getByText("Agent A")).toBeInTheDocument();
  });

  it("removes a placed agent back to the palette", async () => {
    stubFetch();
    const initial = {
      id: "w1",
      name: "Existing",
      slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const user = userEvent.setup();

    render(<PipelineEditor initial={initial} onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(within(screen.getByTestId("after-analyst-slot")).getByText("Agent A")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Remove Agent A/ }));

    expect(within(screen.getByTestId("after-analyst-slot")).queryByText("Agent A")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("agent-palette")).getByText("Agent A")).toBeInTheDocument();
  });

  it("saves a new pipeline via POST and calls onSaved", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineEditor onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "New Pipeline");
    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Pipeline",
          slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
        }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("saves an edited pipeline via PUT to its id", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const initial = {
      id: "w1",
      name: "Existing",
      slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    render(<PipelineEditor initial={initial} onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue("Existing")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows/w1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Existing",
          slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
        }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces a save error without calling onSaved", async () => {
    stubFetch({ save: { ok: false, body: { error: "boom" } } });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineEditor onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Name"), "X");

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    stubFetch();
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<PipelineEditor onSaved={() => {}} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- PipelineEditor`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/components/PipelineEditor.tsx
import { useState } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { applyDragEnd, type DragActive, type DragOver, type SlotKey, type SlotsState } from "@/lib/pipelineEditor";
import { useAgents } from "@/hooks/useAgents";
import { STAGE_LABELS, type AgentDefinition, type StageName, type WorkflowDefinition } from "@/types";
import { cn } from "@/lib/utils";

interface PipelineEditorProps {
  initial?: WorkflowDefinition;
  onSaved: () => void;
  onCancel: () => void;
}

const EMPTY_SLOTS: SlotsState = { afterAnalyst: [], afterArchitect: [], afterQa: [] };

const SLOT_TESTID: Record<SlotKey, string> = {
  afterAnalyst: "after-analyst",
  afterArchitect: "after-architect",
  afterQa: "after-qa",
};

const SLOT_LABEL: Record<SlotKey, string> = {
  afterAnalyst: "After Analyst",
  afterArchitect: "After Architect",
  afterQa: "After QA",
};

type BackboneStage = Exclude<StageName, `custom:${string}`>;

function BackboneGroup({ stages }: { stages: BackboneStage[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, index) => (
        <div key={stage} className="flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground">&rarr;</span>}
          <div className="whitespace-nowrap rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground">
            {STAGE_LABELS[stage]}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotChip({
  slot,
  agentId,
  name,
  onRemove,
}: {
  slot: SlotKey;
  agentId: string;
  name: string;
  onRemove: (slot: SlotKey, agentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `chip:${slot}:${agentId}`,
    data: { type: "slot-item", slot, agentId } satisfies DragActive,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center justify-between gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
    >
      <span>{name}</span>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onRemove(slot, agentId)}
        aria-label={`Remove ${name} from ${SLOT_LABEL[slot]}`}
      >
        &times;
      </button>
    </div>
  );
}

function SlotZone({
  slotKey,
  agentIds,
  agentsById,
  onRemove,
}: {
  slotKey: SlotKey;
  agentIds: string[];
  agentsById: Record<string, AgentDefinition>;
  onRemove: (slot: SlotKey, agentId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${slotKey}`,
    data: { type: "slot", slot: slotKey } satisfies DragOver,
  });

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-muted-foreground">&rarr;</span>
      <div
        ref={setNodeRef}
        data-testid={`${SLOT_TESTID[slotKey]}-slot`}
        className={cn(
          "flex min-h-16 min-w-32 flex-col gap-1 rounded-lg border-2 border-dashed p-2",
          isOver ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <span className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">
          {SLOT_LABEL[slotKey]}
        </span>
        <SortableContext items={agentIds.map((agentId) => `chip:${slotKey}:${agentId}`)} strategy={verticalListSortingStrategy}>
          {agentIds.map((agentId) => (
            <SlotChip
              key={agentId}
              slot={slotKey}
              agentId={agentId}
              name={agentsById[agentId]?.name ?? agentId}
              onRemove={onRemove}
            />
          ))}
        </SortableContext>
      </div>
      <span className="text-muted-foreground">&rarr;</span>
    </div>
  );
}

function PaletteCard({ agent }: { agent: AgentDefinition }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `palette:${agent.id}`,
    data: { type: "palette", agentId: agent.id } satisfies DragActive,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground active:cursor-grabbing"
    >
      {agent.name}
    </div>
  );
}

export function PipelineEditor({ initial, onSaved, onCancel }: PipelineEditorProps) {
  const { agents } = useAgents();
  const [name, setName] = useState(initial?.name ?? "");
  const [slots, setSlots] = useState<SlotsState>(initial?.slots ?? EMPTY_SLOTS);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const usedAgentIds = new Set([...slots.afterAnalyst, ...slots.afterArchitect, ...slots.afterQa]);
  const agentsById: Record<string, AgentDefinition> = Object.fromEntries(agents.map((a) => [a.id, a]));
  const paletteAgents = agents.filter((agent) => !usedAgentIds.has(agent.id));

  function removeFromSlot(slot: SlotKey, agentId: string) {
    setSlots((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== agentId) }));
  }

  function handleDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as DragActive | undefined;
    const over = event.over?.data.current as DragOver | undefined;
    if (!active) return;
    setSlots((prev) => applyDragEnd(prev, active, over));
  }

  async function handleSave() {
    setFormError(undefined);
    setSubmitting(true);
    try {
      const url = initial ? `/api/workflows/${initial.id}` : "/api/workflows";
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slots }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFormError(body.error ?? "Could not save this pipeline");
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="pipeline-name" className="text-sm font-medium text-foreground">
          Name
        </label>
        <input
          id="pipeline-name"
          className="w-full max-w-sm rounded-lg border border-border bg-background p-2 text-sm"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex gap-6">
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-stretch gap-2 rounded-2xl border border-border bg-card p-4">
              <BackboneGroup stages={["create_repo", "analyst"]} />
              <SlotZone slotKey="afterAnalyst" agentIds={slots.afterAnalyst} agentsById={agentsById} onRemove={removeFromSlot} />
              <BackboneGroup stages={["architect"]} />
              <SlotZone slotKey="afterArchitect" agentIds={slots.afterArchitect} agentsById={agentsById} onRemove={removeFromSlot} />
              <BackboneGroup stages={["open_issue", "developer", "open_pr", "qa"]} />
              <SlotZone slotKey="afterQa" agentIds={slots.afterQa} agentsById={agentsById} onRemove={removeFromSlot} />
              <BackboneGroup stages={["post_review", "merge", "deploy", "tracing_pack"]} />
            </div>
          </div>
          <div data-testid="agent-palette" className="flex w-56 shrink-0 flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">Available agents</h2>
            {paletteAgents.map((agent) => (
              <PaletteCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      </DndContext>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={!name.trim() || submitting}>
          {submitting ? "Saving..." : "Save pipeline"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

Note the `BackboneStage` type alias (`Exclude<StageName, \`custom:${string}\`>`) used for `BackboneGroup`'s `stages` prop instead of the full `StageName`: `STAGE_LABELS` is typed as `Record<BackboneStage, string>` (it deliberately excludes custom stages, since a custom stage's label comes from an agent's name, not this map), so indexing it with a value typed as the full `StageName` fails to typecheck — this exact mismatch has come up twice before in this codebase's other plans. Every array literal passed to `<BackboneGroup stages={[...]} />` in this file only ever contains real backbone stage names, so this narrower prop type costs nothing and needs no cast.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- PipelineEditor`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npm run test:web` and `npx tsc -b --noEmit` (from `web/`)
Expected: all pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PipelineEditor.tsx web/src/components/PipelineEditor.test.tsx
git commit -m "feat: add the drag-and-drop pipeline editor component"
```

---

### Task 5: Wire `PipelineEditor` into `PipelinesView`

**Files:**
- Modify: `web/src/components/PipelinesView.tsx`
- Modify: `web/src/components/PipelinesView.test.tsx`

**Interfaces:**
- Consumes: `PipelineEditor` (Task 4).
- Produces: `PipelinesView`'s external props are unchanged (still no props) — only its internal rendering changes.

- [ ] **Step 1: Replace the full test file content**

```typescript
// web/src/components/PipelinesView.test.tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelinesView } from "./PipelinesView";

const defaultWorkflow = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};
const customWorkflow = { ...defaultWorkflow, id: "custom-1", name: "Custom" };

function stubFetch(overrides: { workflows?: unknown; agents?: unknown } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? []) });
    }
    if (url === "/api/workflows" && !init) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.workflows ?? [defaultWorkflow]) });
    }
    if (init?.method === "DELETE") {
      return Promise.resolve({ ok: true });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelinesView", () => {
  it("lists existing workflows, showing the default with no Edit/Delete buttons", async () => {
    stubFetch({ workflows: [defaultWorkflow] });

    render(<PipelinesView />);

    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());
    const row = within(screen.getByTestId("workflow-row-default"));
    expect(row.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("opens the pipeline editor in create mode from 'New pipeline'", async () => {
    stubFetch({ workflows: [defaultWorkflow] });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New pipeline" }));

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("opens the pipeline editor in edit mode, pre-filled, from a row's 'Edit' button", async () => {
    stubFetch({ workflows: [defaultWorkflow, customWorkflow] });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Custom")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("workflow-row-custom-1")).getByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("Custom")).toBeInTheDocument();
  });

  it("deletes a non-default workflow", async () => {
    const fetchMock = stubFetch({ workflows: [defaultWorkflow, customWorkflow] });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Custom")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("workflow-row-custom-1")).getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/workflows/custom-1", { method: "DELETE" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- PipelinesView`
Expected: FAIL — no "New pipeline"/"Edit" buttons exist yet in the current inline-form implementation

- [ ] **Step 3: Replace the full implementation file content**

```typescript
// web/src/components/PipelinesView.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PipelineEditor } from "@/components/PipelineEditor";
import { useWorkflows } from "@/hooks/useWorkflows";
import type { WorkflowDefinition } from "@/types";

type EditorState = { mode: "list" } | { mode: "create" } | { mode: "edit"; workflow: WorkflowDefinition };

export function PipelinesView() {
  const { workflows, loading, error: workflowsError, refetch } = useWorkflows();
  const [editorState, setEditorState] = useState<EditorState>({ mode: "list" });

  async function handleDelete(workflow: WorkflowDefinition) {
    await fetch(`/api/workflows/${workflow.id}`, { method: "DELETE" });
    refetch();
  }

  function handleSaved() {
    setEditorState({ mode: "list" });
    refetch();
  }

  if (editorState.mode === "create") {
    return <PipelineEditor onSaved={handleSaved} onCancel={() => setEditorState({ mode: "list" })} />;
  }
  if (editorState.mode === "edit") {
    return (
      <PipelineEditor
        initial={editorState.workflow}
        onSaved={handleSaved}
        onCancel={() => setEditorState({ mode: "list" })}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Pipelines</h1>
          <p className="text-sm text-muted-foreground">
            Named arrangements of agents around the fixed pipeline backbone.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditorState({ mode: "create" })}>
          New pipeline
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workflowsError ? (
        <p className="text-sm text-destructive">{workflowsError}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {workflows.map((workflow) => (
            <li
              key={workflow.id}
              data-testid={`workflow-row-${workflow.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="font-medium text-foreground">{workflow.name}</span>
              {workflow.id !== "default" && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditorState({ mode: "edit", workflow })}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(workflow)}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- PipelinesView`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npm run test:web` and `npx tsc -b --noEmit` (from `web/`)
Expected: all pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PipelinesView.tsx web/src/components/PipelinesView.test.tsx
git commit -m "feat: wire the drag-and-drop pipeline editor into the Pipelines page"
```

---

### Task 6: Full build and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run everything**

Run, from the repo root: `npm run build && npm test && npm run test:web`
Expected: build succeeds, backend suite passes (139 + 6 new = 145 tests), frontend suite passes (68 pre-existing, with `PipelinesView.test.tsx`'s 3 old tests replaced by 4 new ones, plus 7 new tests in `pipelineEditor.test.ts` and 7 new tests in `PipelineEditor.test.tsx` — 83 total)

- [ ] **Step 2: Manual check**

Boot the dashboard with dummy credentials (`GITHUB_TOKEN=dummy TARGET_GITHUB_OWNER=dummy DEPLOY_TARGET=render RENDER_API_KEY=dummy RENDER_OWNER_ID=dummy PORT=4176 node dist/cli.js`), then in a browser:
1. Create two agents on the Agents page.
2. Click "Pipelines" → "New pipeline". Drag one agent from the palette into the "After QA" zone. Drag the second agent in too, then drag to reorder them within the zone. Give it a name and click "Save pipeline" — confirm it appears in the list.
3. Click "Edit" on that saved pipeline — confirm the canvas reopens with both agents already placed in "After QA", in the order you left them.
4. Remove one agent (back to the palette) and save again — confirm the change persists after reopening Edit.

- [ ] **Step 3: Commit** (only if Step 2 surfaced a fix — otherwise this task has nothing to commit)

## Definition of done

- `npm run build`, `npm test`, and `npm run test:web` all pass.
- Pipelines can be created and edited by dragging agents from a palette into slot zones and reordering within a zone, with no dropdowns.
- `PUT /api/workflows/:id` exists, rejects the default workflow and unknown/duplicate agent ids the same way `POST` does, and 404s on an unknown id.
