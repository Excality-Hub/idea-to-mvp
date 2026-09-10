# Configurable Agents & Workflows — Dashboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dashboard UI for the configurable-agents backend (already merged into this branch): an "Agents" page to create/list/delete agents, a "Pipelines" page to create/list/delete named workflows, a workflow picker on the idle idea-input form, and a plan-driven live canvas that shows custom pipeline stages (instead of the hardcoded 11-stage backbone) with the right agent name as their label.

**Architecture:** `web/src/types.ts`'s `StageName` widens to match the backend's `` `custom:${string}` `` variant, plus new `AgentDefinition`/`WorkflowDefinition` types mirroring the backend (same duplication convention this file already uses). `web/src/lib/workflowGraph.ts`'s `buildStageNodes`/`buildStageEdges` stop importing a hardcoded `STAGE_ORDER` and instead take the stage order as a parameter, plus a label-resolver function that falls back to an agent's name for custom stages. Three new hooks (`useAgents`, `useWorkflows`, `useRunPlan`) each wrap one GET endpoint. Two new page components (`AgentsView`, `PipelinesView`) reuse the existing raw-Tailwind form style already used by `WorkflowsView`'s idea-input box — no new shadcn primitives are added. `Sidebar`/`App` gain real (state-based, not routed) view switching.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Vitest + React Testing Library — matching the existing `web/` app. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-configurable-agents-design.md` (see its "Dashboard UI" section)

## Global Constraints

- No new shadcn/ui primitives — build forms from plain HTML elements styled with Tailwind classes, exactly like the existing idea-input textarea in `WorkflowsView.tsx`. Reuse `Button`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Badge`, `Separator` from `web/src/components/ui/*` where they fit.
- No routing library — view switching is plain React state lifted to `App`, matching this app's existing "no routing" non-goal.
- The Pipelines page must prevent a client from picking the same agent for two different slots in the same draft workflow (the backend rejects this with 400, but the UI should not let a user hit that error in the normal flow — remove an agent from other slot pickers once it's chosen in any one slot).
- `GET /api/run/plan` returning `[]` (no run has started yet, or the endpoint predates any run) must fall back to the existing hardcoded backbone order — never render an empty canvas.
- Every existing `web/` test must keep passing (updated where its assertions are naturally affected by a new fetch call or new prop, never by accepting a behavior regression).
- All new API calls use the existing native `fetch`, matching every other API call in this codebase (`WorkflowsView.tsx`'s `handleStart`, `StageNode.tsx`'s `postRunAction`) — no new HTTP client library.

---

### Task 1: Frontend types — custom stage name, AgentDefinition, WorkflowDefinition

**Files:**
- Modify: `web/src/types.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StageName` includes `` `custom:${string}` ``; `STAGE_LABELS`'s type narrows to exclude that variant; `interface AgentDefinition { id: string; name: string; instructions: string; repoAccess: boolean; createdAt: string; }`; `interface WorkflowDefinition { id: string; name: string; slots: { afterAnalyst: string[]; afterArchitect: string[]; afterQa: string[] }; createdAt: string; }`; `function isCustomStage(stage: StageName): stage is \`custom:${string}\``; `function isAbortableStage(stage: StageName): boolean` (true for the existing `ABORTABLE_STAGES` members OR any custom stage).

No dedicated test file for this task — it's pure type/constant declarations, matching this file's own existing convention (no `types.test.ts` exists for it today).

- [ ] **Step 1: Modify `web/src/types.ts`**

Change the `StageName` union to add the custom variant:

```typescript
export type StageName =
  | "create_repo"
  | "analyst"
  | "architect"
  | "open_issue"
  | "developer"
  | "open_pr"
  | "qa"
  | "post_review"
  | "merge"
  | "deploy"
  | "tracing_pack"
  | `custom:${string}`;
```

Change `STAGE_LABELS`'s type so it only covers the backbone (it's a literal object with exactly those 11 keys, so this is a type-only change — no change to the object's values):

```typescript
export const STAGE_LABELS: Record<Exclude<StageName, `custom:${string}`>, string> = {
  create_repo: "Create repo",
  analyst: "Analyst",
  architect: "Architect",
  open_issue: "Open issue",
  developer: "Developer",
  open_pr: "Open PR",
  qa: "QA review",
  post_review: "Post review",
  merge: "Merge",
  deploy: "Deploy",
  tracing_pack: "Tracing pack",
};
```

Add, at the end of the file:

```typescript
export function isCustomStage(stage: StageName): stage is `custom:${string}` {
  return stage.startsWith("custom:");
}

export function isAbortableStage(stage: StageName): boolean {
  return isCustomStage(stage) || (ABORTABLE_STAGES as StageName[]).includes(stage);
}

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  createdAt: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: {
    afterAnalyst: string[];
    afterArchitect: string[];
    afterQa: string[];
  };
  createdAt: string;
}
```

- [ ] **Step 2: Update `StageNode.tsx` to use the new abortable check**

In `web/src/components/StageNode.tsx`, replace:

```typescript
import { ABORTABLE_STAGES } from "@/types";
```

with:

```typescript
import { isAbortableStage } from "@/types";
```

and replace:

```typescript
const abortable = ABORTABLE_STAGES.includes(stage);
```

with:

```typescript
const abortable = isAbortableStage(stage);
```

- [ ] **Step 3: Run the full frontend test suite and typecheck**

Run: `npm run test:web` (from the repo root) and `npx tsc -b --noEmit` (from `web/`)
Expected: all 43 existing tests still pass; typecheck clean

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/components/StageNode.tsx
git commit -m "feat: add custom stage name support to frontend types"
```

---

### Task 2: Parameterize `workflowGraph.ts`'s stage order and labels

**Files:**
- Modify: `web/src/lib/workflowGraph.ts`
- Modify: `web/src/lib/workflowGraph.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition`, `StageName`, `isCustomStage` from `@/types` (Task 1).
- Produces: `buildStageNodes(eventsByStage, stageOrder, labelFor)`, `buildStageEdges(eventsByStage, stageOrder)`, `function getStageLabel(stage: StageName, agentsById: Record<string, AgentDefinition>): string` — all exported. `STAGE_NODE_WIDTH`/`STAGE_NODE_X_SPACING` are unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the full content of `web/src/lib/workflowGraph.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import { buildStageEdges, buildStageNodes, getStageLabel, STAGE_NODE_X_SPACING } from "./workflowGraph";
import type { EventsByStage } from "./runEvents";
import { STAGE_LABELS, STAGE_ORDER, type AgentDefinition, type StageName } from "@/types";

const labelFor = (stage: StageName) =>
  stage in STAGE_LABELS ? STAGE_LABELS[stage as keyof typeof STAGE_LABELS] : stage;

describe("buildStageNodes", () => {
  it("builds one node per stage in the given order", () => {
    const nodes = buildStageNodes({}, STAGE_ORDER, labelFor);
    expect(nodes).toHaveLength(11);
    expect(nodes[0]).toMatchObject({ id: "create_repo", type: "stage", position: { x: 0, y: 0 } });
    expect(nodes[1].position).toEqual({ x: STAGE_NODE_X_SPACING, y: 0 });
    expect(nodes[10]).toMatchObject({ id: "tracing_pack" });
  });

  it("derives pending status and no latest event for a stage with no events", () => {
    const nodes = buildStageNodes({}, STAGE_ORDER, labelFor);
    const analyst = nodes.find((n) => n.id === "analyst");
    expect(analyst?.data.status).toBe("pending");
    expect(analyst?.data.latestEvent).toBeUndefined();
  });

  it("derives status and latest event from the stage's most recent event", () => {
    const eventsByStage: EventsByStage = {
      analyst: [
        { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
        { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
      ],
    };
    const nodes = buildStageNodes(eventsByStage, STAGE_ORDER, labelFor);
    const analyst = nodes.find((n) => n.id === "analyst");
    expect(analyst?.data.status).toBe("done");
    expect(analyst?.data.latestEvent?.message).toBe("Todo app summary");
  });

  it("builds a node for a custom stage using the given label resolver", () => {
    const order: StageName[] = ["analyst", "custom:sec-1", "architect"];
    const nodes = buildStageNodes({}, order, () => "Security Reviewer");
    expect(nodes[1]).toMatchObject({ id: "custom:sec-1", data: { label: "Security Reviewer" } });
  });
});

describe("buildStageEdges", () => {
  it("connects each stage to the next in the given order", () => {
    const edges = buildStageEdges({}, STAGE_ORDER);
    expect(edges).toHaveLength(10);
    expect(edges[0]).toMatchObject({ source: "create_repo", target: "analyst" });
    expect(edges[9]).toMatchObject({ source: "deploy", target: "tracing_pack" });
  });

  it("colors an edge muted when its source stage hasn't completed", () => {
    const edges = buildStageEdges({}, STAGE_ORDER);
    expect(edges[0]).toMatchObject({ style: { stroke: "var(--border)" } });
  });

  it("colors an edge with the success color once its source stage is done", () => {
    const eventsByStage: EventsByStage = {
      create_repo: [
        { stage: "create_repo", status: "done", message: "Repo created", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const edges = buildStageEdges(eventsByStage, STAGE_ORDER);
    expect(edges[0]).toMatchObject({
      source: "create_repo",
      target: "analyst",
      style: { stroke: "var(--success)" },
    });
  });
});

describe("getStageLabel", () => {
  const agentsById: Record<string, AgentDefinition> = {
    "sec-1": {
      id: "sec-1",
      name: "Security Reviewer",
      instructions: "check for bugs",
      repoAccess: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };

  it("returns the backbone label for a fixed stage", () => {
    expect(getStageLabel("analyst", agentsById)).toBe("Analyst");
  });

  it("returns the agent's name for a custom stage with a known agent", () => {
    expect(getStageLabel("custom:sec-1", agentsById)).toBe("Security Reviewer");
  });

  it("falls back to the raw stage id for a custom stage with an unknown agent", () => {
    expect(getStageLabel("custom:missing", agentsById)).toBe("custom:missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- workflowGraph` (from the repo root)
Expected: FAIL — `buildStageNodes`/`buildStageEdges` still take the old 1-argument signature, `getStageLabel` doesn't exist

- [ ] **Step 3: Modify `web/src/lib/workflowGraph.ts`**

Replace the full file content:

```typescript
import type { Edge, Node } from "@xyflow/react";
import type { StageDisplayStatus } from "@/components/status";
import { deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { isCustomStage, STAGE_LABELS, type AgentDefinition, type RunEvent, type StageName } from "@/types";

export const STAGE_NODE_WIDTH = 240;
export const STAGE_NODE_X_SPACING = 280;

export interface StageNodeData extends Record<string, unknown> {
  stage: StageName;
  label: string;
  status: StageDisplayStatus;
  latestEvent: RunEvent | undefined;
}

export type StageFlowNode = Node<StageNodeData, "stage">;

export function getStageLabel(stage: StageName, agentsById: Record<string, AgentDefinition>): string {
  if (!isCustomStage(stage)) {
    return STAGE_LABELS[stage];
  }
  const agentId = stage.slice("custom:".length);
  return agentsById[agentId]?.name ?? stage;
}

export function buildStageNodes(
  eventsByStage: EventsByStage,
  stageOrder: StageName[],
  labelFor: (stage: StageName) => string,
): StageFlowNode[] {
  return stageOrder.map((stage, index) => {
    const events = eventsByStage[stage];
    return {
      id: stage,
      type: "stage",
      position: { x: index * STAGE_NODE_X_SPACING, y: 0 },
      data: {
        stage,
        label: labelFor(stage),
        status: deriveStageStatus(events),
        latestEvent: events?.[events.length - 1],
      },
    };
  });
}

export function buildStageEdges(eventsByStage: EventsByStage, stageOrder: StageName[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < stageOrder.length - 1; i++) {
    const sourceStage = stageOrder[i];
    const targetStage = stageOrder[i + 1];
    const completed = deriveStageStatus(eventsByStage[sourceStage]) === "done";
    edges.push({
      id: `${sourceStage}-${targetStage}`,
      source: sourceStage,
      target: targetStage,
      style: { stroke: completed ? "var(--success)" : "var(--border)", strokeWidth: 2 },
    });
  }
  return edges;
}
```

`getStageLabel` is self-sufficient: it looks up `STAGE_LABELS` for a backbone stage, and falls back to the agent's name (or the raw stage id if the agent isn't loaded yet) for a custom stage. The test file's separate `labelFor` helper (used only for the generic `buildStageNodes`/`buildStageEdges` tests, which intentionally don't depend on `getStageLabel` at all) stays as written above — it exists to prove `buildStageNodes` works with any label-resolver function, not specifically `getStageLabel`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- workflowGraph`
Expected: PASS (11 tests: 3 buildStageNodes + 1 new custom-stage node test + 3 buildStageEdges + 3 getStageLabel — 10 total, verify exact count when running)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/workflowGraph.ts web/src/lib/workflowGraph.test.ts
git commit -m "feat: parameterize stage order and labels in workflowGraph"
```

---

### Task 3: `useAgents` and `useWorkflows` hooks

**Files:**
- Create: `web/src/hooks/useAgents.ts`
- Create: `web/src/hooks/useAgents.test.ts`
- Create: `web/src/hooks/useWorkflows.ts`
- Create: `web/src/hooks/useWorkflows.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition`, `WorkflowDefinition` from `@/types` (Task 1).
- Produces: `useAgents(): { agents: AgentDefinition[]; loading: boolean; error: string | undefined; refetch: () => void }`; `useWorkflows(): { workflows: WorkflowDefinition[]; loading: boolean; error: string | undefined; refetch: () => void }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/hooks/useAgents.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "./useAgents";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAgents", () => {
  it("fetches agents from /api/agents on mount", async () => {
    const agents = [
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(agents) }),
    );

    const { result } = renderHook(() => useAgents());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toEqual(agents);
    expect(fetch).toHaveBeenCalledWith("/api/agents");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useAgents());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.agents).toEqual([]);
  });

  it("refetch() re-requests the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
          ]),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toEqual([]);

    result.current.refetch();

    await waitFor(() => expect(result.current.agents).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

```typescript
// web/src/hooks/useWorkflows.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflows } from "./useWorkflows";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkflows", () => {
  it("fetches workflows from /api/workflows on mount", async () => {
    const workflows = [
      {
        id: "default",
        name: "Default",
        slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(workflows) }),
    );

    const { result } = renderHook(() => useWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual(workflows);
    expect(fetch).toHaveBeenCalledWith("/api/workflows");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.workflows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- useAgents useWorkflows`
Expected: FAIL — modules don't exist

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/hooks/useAgents.ts
import { useCallback, useEffect, useState } from "react";
import type { AgentDefinition } from "@/types";

export interface UseAgentsResult {
  agents: AgentDefinition[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch("/api/agents")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
        return res.json() as Promise<AgentDefinition[]>;
      })
      .then((data) => {
        if (!cancelled) setAgents(data);
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

  return { agents, loading, error, refetch };
}
```

```typescript
// web/src/hooks/useWorkflows.ts
import { useCallback, useEffect, useState } from "react";
import type { WorkflowDefinition } from "@/types";

export interface UseWorkflowsResult {
  workflows: WorkflowDefinition[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useWorkflows(): UseWorkflowsResult {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch("/api/workflows")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
        return res.json() as Promise<WorkflowDefinition[]>;
      })
      .then((data) => {
        if (!cancelled) setWorkflows(data);
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

  return { workflows, loading, error, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- useAgents useWorkflows`
Expected: PASS (3 tests in useAgents.test.ts, 2 in useWorkflows.test.ts)

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useAgents.ts web/src/hooks/useAgents.test.ts web/src/hooks/useWorkflows.ts web/src/hooks/useWorkflows.test.ts
git commit -m "feat: add useAgents and useWorkflows data-fetching hooks"
```

---

### Task 4: `useRunPlan` hook

**Files:**
- Create: `web/src/hooks/useRunPlan.ts`
- Create: `web/src/hooks/useRunPlan.test.ts`

**Interfaces:**
- Consumes: `STAGE_ORDER`, `StageName` from `@/types` (existing).
- Produces: `useRunPlan(isIdle: boolean): StageName[]`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/hooks/useRunPlan.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunPlan } from "./useRunPlan";
import { STAGE_ORDER } from "@/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRunPlan", () => {
  it("returns the default backbone order while idle, without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRunPlan(true));

    expect(result.current).toEqual(STAGE_ORDER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the plan when isIdle becomes false, and uses it once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(["create_repo", "analyst", "custom:sec-1", "architect"]),
      }),
    );

    const { result, rerender } = renderHook(({ isIdle }) => useRunPlan(isIdle), {
      initialProps: { isIdle: true },
    });
    expect(result.current).toEqual(STAGE_ORDER);

    rerender({ isIdle: false });

    await waitFor(() =>
      expect(result.current).toEqual(["create_repo", "analyst", "custom:sec-1", "architect"]),
    );
    expect(fetch).toHaveBeenCalledWith("/api/run/plan");
  });

  it("falls back to the default backbone order when the plan endpoint returns an empty array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));

    const { result, rerender } = renderHook(({ isIdle }) => useRunPlan(isIdle), {
      initialProps: { isIdle: true },
    });

    rerender({ isIdle: false });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toEqual(STAGE_ORDER);
  });

  it("resets to the default backbone order when isIdle becomes true again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(["create_repo", "analyst"]) }),
    );

    const { result, rerender } = renderHook(({ isIdle }) => useRunPlan(isIdle), {
      initialProps: { isIdle: true },
    });
    rerender({ isIdle: false });
    await waitFor(() => expect(result.current).toEqual(["create_repo", "analyst"]));

    rerender({ isIdle: true });

    expect(result.current).toEqual(STAGE_ORDER);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- useRunPlan`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/hooks/useRunPlan.ts
import { useEffect, useState } from "react";
import { STAGE_ORDER, type StageName } from "@/types";

export function useRunPlan(isIdle: boolean): StageName[] {
  const [plan, setPlan] = useState<StageName[]>(STAGE_ORDER);

  useEffect(() => {
    if (isIdle) {
      setPlan(STAGE_ORDER);
      return;
    }
    let cancelled = false;
    fetch("/api/run/plan")
      .then((res) => (res.ok ? (res.json() as Promise<StageName[]>) : Promise.resolve([])))
      .then((stages) => {
        if (!cancelled) setPlan(stages.length > 0 ? stages : STAGE_ORDER);
      })
      .catch(() => {
        if (!cancelled) setPlan(STAGE_ORDER);
      });
    return () => {
      cancelled = true;
    };
  }, [isIdle]);

  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- useRunPlan`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useRunPlan.ts web/src/hooks/useRunPlan.test.ts
git commit -m "feat: add useRunPlan hook for the plan-driven canvas"
```

---

### Task 5: `AgentsView` page

**Files:**
- Create: `web/src/components/AgentsView.tsx`
- Create: `web/src/components/AgentsView.test.tsx`

**Interfaces:**
- Consumes: `useAgents` (Task 3), `AgentDefinition` from `@/types` (Task 1), `Button`/`Card`/`CardHeader`/`CardTitle`/`CardContent`/`Badge` from `@/components/ui/*` (existing).
- Produces: `export function AgentsView(): JSX.Element` (no props — it owns its own data fetching via `useAgents`).

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/components/AgentsView.test.tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsView } from "./AgentsView";

const agent = {
  id: "a",
  name: "Security Reviewer",
  instructions: "Look for auth bypass issues.",
  repoAccess: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentsView", () => {
  it("lists existing agents with a repo-access indicator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([agent]) }));

    render(<AgentsView />);

    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());
    expect(screen.getByText(/reads repo/i)).toBeInTheDocument();
  });

  it("creates a new agent and shows it in the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial GET
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(agent) }) // POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) }); // refetch GET
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "Security Reviewer");
    await user.type(screen.getByLabelText("Instructions"), "Look for auth bypass issues.");
    await user.click(screen.getByLabelText(/repo read access/i));
    await user.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Security Reviewer",
        instructions: "Look for auth bypass issues.",
        repoAccess: true,
      }),
    });
  });

  it("deletes an agent when its delete button is clicked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) }) // initial GET
      .mockResolvedValueOnce({ ok: true }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }); // refetch GET
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("agent-row-a")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/a", { method: "DELETE" });
  });

  it("shows an error message when deleting an in-use agent fails with 409", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({ error: "Agent is used by a workflow" }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("agent-row-a")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText("Agent is used by a workflow")).toBeInTheDocument());
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- AgentsView`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/components/AgentsView.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgents } from "@/hooks/useAgents";
import type { AgentDefinition } from "@/types";

export function AgentsView() {
  const { agents, loading, refetch } = useAgents();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [repoAccess, setRepoAccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; message: string } | undefined>(undefined);

  async function handleCreate() {
    setSubmitting(true);
    try {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions, repoAccess }),
      });
      setName("");
      setInstructions("");
      setRepoAccess(false);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(agent: AgentDefinition) {
    setRowError(undefined);
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setRowError({ id: agent.id, message: body.error ?? "Could not delete this agent" });
      return;
    }
    refetch();
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Read-only pipeline steps you can insert into a workflow after Analyst, Architect, or QA.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New agent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="agent-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="agent-name"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="agent-instructions" className="text-sm font-medium text-foreground">
              Instructions
            </label>
            <textarea
              id="agent-instructions"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              style={{ minHeight: 80 }}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={repoAccess}
              onChange={(event) => setRepoAccess(event.target.checked)}
            />
            Give this agent repo read access
          </label>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !instructions.trim() || submitting}
            className="w-fit"
          >
            {submitting ? "Creating..." : "Create agent"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.map((agent) => (
            <li
              key={agent.id}
              data-testid={`agent-row-${agent.id}`}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{agent.name}</span>
                  {agent.repoAccess && <Badge variant="secondary">reads repo</Badge>}
                </div>
                <Button variant="outline" size="sm" onClick={() => handleDelete(agent)}>
                  Delete
                </Button>
              </div>
              <p className="truncate text-sm text-muted-foreground">{agent.instructions}</p>
              {rowError?.id === agent.id && (
                <p className="text-sm text-destructive">{rowError.message}</p>
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

Run: `npm run test:web -- AgentsView`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AgentsView.tsx web/src/components/AgentsView.test.tsx
git commit -m "feat: add Agents page"
```

---

### Task 6: `PipelinesView` page

**Files:**
- Create: `web/src/components/PipelinesView.tsx`
- Create: `web/src/components/PipelinesView.test.tsx`

**Interfaces:**
- Consumes: `useAgents` (Task 3), `useWorkflows` (Task 3), `AgentDefinition`/`WorkflowDefinition` from `@/types` (Task 1).
- Produces: `export function PipelinesView(): JSX.Element` (no props).

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/components/PipelinesView.test.tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelinesView } from "./PipelinesView";

const agentA = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB = { id: "b", name: "Agent B", instructions: "do b", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" };
const defaultWorkflow = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function stubFetch(overrides: { agents?: unknown; workflows?: unknown } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? [agentA, agentB]) });
    }
    if (url === "/api/workflows") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.workflows ?? [defaultWorkflow]) });
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
  it("lists existing workflows, showing the default as not deletable", async () => {
    stubFetch();

    render(<PipelinesView />);

    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());
    expect(within(screen.getByTestId("workflow-row-default")).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("adds an agent to a slot, removes it from other slots' pickers, and creates the workflow", async () => {
    const fetchMock = stubFetch({ workflows: [defaultWorkflow] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve([agentA, agentB]) });
      if (url === "/api/workflows" && !init) return Promise.resolve({ ok: true, json: () => Promise.resolve([defaultWorkflow]) });
      if (url === "/api/workflows" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...defaultWorkflow, id: "new" }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    const user = userEvent.setup();

    render(<PipelinesView />);
    await waitFor(() => expect(screen.getByText("Default")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "With Agent A");
    await user.selectOptions(screen.getByLabelText("After Analyst"), "a");
    await user.click(screen.getByRole("button", { name: "Add to After Analyst" }));

    expect(screen.getByTestId("after-analyst-slot")).toHaveTextContent("Agent A");
    expect(within(screen.getByLabelText("After Architect")).queryByRole("option", { name: "Agent A" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "With Agent A",
          slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] },
        }),
      }),
    );
  });

  it("deletes a non-default workflow", async () => {
    const workflow = { ...defaultWorkflow, id: "custom-1", name: "Custom" };
    const fetchMock = stubFetch({ workflows: [defaultWorkflow, workflow] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: () => Promise.resolve([agentA, agentB]) });
      if (url === "/api/workflows" && init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (url === "/api/workflows") return Promise.resolve({ ok: true, json: () => Promise.resolve([defaultWorkflow, workflow]) });
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
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
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/components/PipelinesView.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgents } from "@/hooks/useAgents";
import { useWorkflows } from "@/hooks/useWorkflows";
import type { AgentDefinition, WorkflowDefinition } from "@/types";

type SlotKey = "afterAnalyst" | "afterArchitect" | "afterQa";

const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "afterAnalyst", label: "After Analyst" },
  { key: "afterArchitect", label: "After Architect" },
  { key: "afterQa", label: "After QA" },
];

export function PipelinesView() {
  const { agents } = useAgents();
  const { workflows, loading, refetch } = useWorkflows();
  const [name, setName] = useState("");
  const [slots, setSlots] = useState<Record<SlotKey, string[]>>({
    afterAnalyst: [],
    afterArchitect: [],
    afterQa: [],
  });
  const [pendingPick, setPendingPick] = useState<Record<SlotKey, string>>({
    afterAnalyst: "",
    afterArchitect: "",
    afterQa: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const usedAgentIds = new Set([...slots.afterAnalyst, ...slots.afterArchitect, ...slots.afterQa]);
  const agentsById: Record<string, AgentDefinition> = Object.fromEntries(agents.map((a) => [a.id, a]));

  function addToSlot(slot: SlotKey) {
    const agentId = pendingPick[slot];
    if (!agentId) return;
    setSlots((prev) => ({ ...prev, [slot]: [...prev[slot], agentId] }));
    setPendingPick((prev) => ({ ...prev, [slot]: "" }));
  }

  function removeFromSlot(slot: SlotKey, agentId: string) {
    setSlots((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== agentId) }));
  }

  async function handleCreate() {
    setFormError(undefined);
    setSubmitting(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slots }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFormError(body.error ?? "Could not create this pipeline");
        return;
      }
      setName("");
      setSlots({ afterAnalyst: [], afterArchitect: [], afterQa: [] });
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(workflow: WorkflowDefinition) {
    await fetch(`/api/workflows/${workflow.id}`, { method: "DELETE" });
    refetch();
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Pipelines</h1>
        <p className="text-sm text-muted-foreground">
          Named arrangements of agents around the fixed pipeline backbone.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New pipeline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="pipeline-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="pipeline-name"
              className="rounded-lg border border-border bg-background p-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {SLOTS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`slot-${key}`} className="text-sm font-medium text-foreground">
                {label}
              </label>
              <div className="flex gap-2">
                <select
                  id={`slot-${key}`}
                  className="rounded-lg border border-border bg-background p-2 text-sm"
                  value={pendingPick[key]}
                  onChange={(event) => setPendingPick((prev) => ({ ...prev, [key]: event.target.value }))}
                >
                  <option value="">Select an agent…</option>
                  {agents
                    .filter((agent) => !usedAgentIds.has(agent.id))
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => addToSlot(key)}>
                  {`Add to ${label}`}
                </Button>
              </div>
              <ul data-testid={`${key === "afterAnalyst" ? "after-analyst" : key === "afterArchitect" ? "after-architect" : "after-qa"}-slot`} className="flex flex-wrap gap-2">
                {slots[key].map((agentId) => (
                  <li
                    key={agentId}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    {agentsById[agentId]?.name ?? agentId}
                    <button type="button" onClick={() => removeFromSlot(key, agentId)} aria-label={`Remove ${agentsById[agentId]?.name ?? agentId} from ${label}`}>
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button onClick={handleCreate} disabled={!name.trim() || submitting} className="w-fit">
            {submitting ? "Creating..." : "Create pipeline"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
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
                <Button variant="outline" size="sm" onClick={() => handleDelete(workflow)}>
                  Delete
                </Button>
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
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PipelinesView.tsx web/src/components/PipelinesView.test.tsx
git commit -m "feat: add Pipelines page"
```

---

### Task 7: Sidebar navigation and App view switching

**Files:**
- Modify: `web/src/components/Sidebar.tsx`
- Modify: `web/src/components/Sidebar.test.tsx` (create if it doesn't exist — check first)
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `AgentsView` (Task 5), `PipelinesView` (Task 6).
- Produces: `Sidebar` gains props `{ activeView: "workflows" | "agents" | "pipelines"; onSelect: (view: "workflows" | "agents" | "pipelines") => void }`. `App` owns the `activeView` state.

- [ ] **Step 1: Check whether `web/src/components/Sidebar.test.tsx` already exists**

Run: `ls web/src/components/Sidebar.test.tsx`

If it exists, read it first and adapt the steps below to its existing structure instead of creating a new file from scratch. If it doesn't exist (expected — it isn't in today's file listing), create it fresh as below.

- [ ] **Step 2: Write the failing test**

```typescript
// web/src/components/Sidebar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("marks the active view as current", () => {
    render(<Sidebar activeView="agents" onSelect={() => {}} />);

    expect(screen.getByText("Agents").closest("[aria-current]")).toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect with the clicked view", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar activeView="workflows" onSelect={onSelect} />);

    await user.click(screen.getByText("Pipelines"));

    expect(onSelect).toHaveBeenCalledWith("pipelines");
  });

  it("still shows Runs history and Settings as disabled placeholders", () => {
    render(<Sidebar activeView="workflows" onSelect={() => {}} />);

    expect(screen.getByText("Runs history")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getAllByText("Soon")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:web -- Sidebar`
Expected: FAIL — `Sidebar` doesn't accept props yet, `Agents`/`Pipelines` items don't exist

- [ ] **Step 4: Modify `web/src/components/Sidebar.tsx`**

```typescript
import { Bot, History, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

export type SidebarView = "workflows" | "agents" | "pipelines";

const NAV_ITEMS: { label: string; icon: typeof Workflow; view: SidebarView }[] = [
  { label: "Workflows", icon: Workflow, view: "workflows" },
  { label: "Agents", icon: Bot, view: "agents" },
  { label: "Pipelines", icon: Workflow, view: "pipelines" },
];

const DISABLED_ITEMS = [
  { label: "Runs history", icon: History },
  { label: "Settings", icon: Settings },
];

interface SidebarProps {
  activeView: SidebarView;
  onSelect: (view: SidebarView) => void;
}

export function Sidebar({ activeView, onSelect }: SidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 bg-sidebar px-3 py-4">
      {NAV_ITEMS.map(({ label, icon: Icon, view }) => (
        <button
          type="button"
          key={label}
          aria-current={activeView === view ? "page" : undefined}
          onClick={() => onSelect(view)}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium",
            activeView === view
              ? "bg-sidebar-accent text-sidebar-primary"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
      {DISABLED_ITEMS.map(({ label, icon: Icon }) => (
        <div
          key={label}
          aria-disabled="true"
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/50"
        >
          <Icon className="size-4" />
          {label}
          <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
            Soon
          </span>
        </div>
      ))}
    </aside>
  );
}
```

(`Bot` is confirmed exported by the installed `lucide-react` version — safe to import directly as shown above.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:web -- Sidebar`
Expected: PASS (3 tests)

- [ ] **Step 6: Modify `web/src/App.tsx`**

```typescript
import { useState } from "react";
import { AgentsView } from "@/components/AgentsView";
import { Header } from "@/components/Header";
import { PipelinesView } from "@/components/PipelinesView";
import { Sidebar, type SidebarView } from "@/components/Sidebar";
import { WorkflowsView } from "@/components/WorkflowsView";
import { useRunEvents } from "@/hooks/useRunEvents";

export function App() {
  const { eventsByStage, overallStatus, connected } = useRunEvents();
  const [activeView, setActiveView] = useState<SidebarView>("workflows");

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header overallStatus={overallStatus} connected={connected} />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeView={activeView} onSelect={setActiveView} />
        <main className="flex-1 overflow-hidden">
          {activeView === "workflows" && <WorkflowsView eventsByStage={eventsByStage} />}
          {activeView === "agents" && <AgentsView />}
          {activeView === "pipelines" && <PipelinesView />}
        </main>
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm run test:web`
Expected: all tests pass (existing + new Sidebar tests)

- [ ] **Step 8: Commit**

```bash
git add web/src/components/Sidebar.tsx web/src/components/Sidebar.test.tsx web/src/App.tsx
git commit -m "feat: add Agents/Pipelines navigation to the sidebar"
```

---

### Task 8: Wire the workflow picker and plan-driven canvas into `WorkflowsView`

**Files:**
- Modify: `web/src/components/WorkflowsView.tsx`
- Modify: `web/src/components/WorkflowsView.test.tsx`

**Interfaces:**
- Consumes: `useWorkflows` (Task 3), `useAgents` (Task 3), `useRunPlan` (Task 4), `getStageLabel` and the new `buildStageNodes`/`buildStageEdges` signatures (Task 2).
- Produces: `WorkflowsView`'s external props are unchanged (`{ eventsByStage: EventsByStage }`); internally it now sends `workflowId` with `POST /api/run` and drives the canvas from `useRunPlan`.

- [ ] **Step 1: Add a shared fetch-stubbing helper and update every existing test**

Every existing test in `web/src/components/WorkflowsView.test.tsx` renders a tree that will now call `fetch` for `/api/workflows` (idle form's picker) and/or `/api/run/plan` and `/api/agents` (canvas label resolution) — none of that fetching happened before. Replace the full content of this file with:

```typescript
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowsView } from "./WorkflowsView";
import type { EventsByStage } from "@/lib/runEvents";

// jsdom's synthetic mouse events leave `event.view` null, which crashes d3-zoom's
// drag-disable helper (used internally by @xyflow/react's pane pan/zoom) when a
// click on a node bubbles up to the canvas. Real browsers always populate
// `event.view`, so this is a test-environment-only artifact, not a product bug.
window.addEventListener("error", (event) => {
  if (event.error instanceof TypeError && /reading 'document'/.test(event.error.message)) {
    event.preventDefault();
  }
});

const DEFAULT_WORKFLOW = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function stubFetch(overrides: { plan?: unknown; agents?: unknown; workflows?: unknown; run?: unknown } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/run/plan") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.plan ?? []) });
    }
    if (url === "/api/agents") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.agents ?? []) });
    }
    if (url === "/api/workflows") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.workflows ?? [DEFAULT_WORKFLOW]) });
    }
    if (url === "/api/run" && init?.method === "POST") {
      return Promise.resolve(overrides.run ?? { ok: true });
    }
    return Promise.reject(new Error(`unexpected fetch to ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const eventsByStage: EventsByStage = {
  analyst: [
    { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
    { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
  ],
};

const deployedEventsByStage: EventsByStage = {
  deploy: [
    { stage: "deploy", status: "done", message: "https://app.onrender.com", timestamp: "2026-01-01T00:05:00.000Z" },
  ],
};

describe("WorkflowsView", () => {
  it("renders a node for every pipeline stage", async () => {
    const { container } = render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(11);
  });

  it("opens the detail sheet with the stage's full log on click", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());

    await user.click(screen.getByText("Analyst"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Analyzing idea")).toBeInTheDocument();
    expect(dialog.getByText("Todo app summary")).toBeInTheDocument();
  });

  it("shows a pending, empty-log state for a stage with no events yet", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Deploy")).toBeInTheDocument());

    await user.click(screen.getByText("Deploy"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/hasn.t started/)).toBeInTheDocument();
  });

  it("shows an idea input, a pipeline picker, and Start button when idle", async () => {
    render(<WorkflowsView eventsByStage={{}} />);

    expect(screen.getByLabelText("Idea & requirements")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toBeInTheDocument());
    expect(within(screen.getByLabelText("Pipeline")).getByRole("option", { name: "Default" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });

  it("posts the idea text and selected workflowId to /api/run when Start is clicked", async () => {
    const fetchMock = stubFetch({
      workflows: [DEFAULT_WORKFLOW, { ...DEFAULT_WORKFLOW, id: "with-review", name: "With review" }],
    });
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={{}} />);
    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Idea & requirements"), "Build a todo app");
    await user.selectOptions(screen.getByLabelText("Pipeline"), "with-review");
    await user.click(screen.getByRole("button", { name: "Start run" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText: "Build a todo app", workflowId: "with-review" }),
      }),
    );
  });

  it("does not show the idea form once a run has started", async () => {
    render(<WorkflowsView eventsByStage={eventsByStage} />);
    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());

    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });

  it("shows a 'Start a new run' button once the run reaches a terminal outcome", async () => {
    render(<WorkflowsView eventsByStage={deployedEventsByStage} />);
    await waitFor(() => expect(screen.getByText("Deploy")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Start a new run" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Idea & requirements")).not.toBeInTheDocument();
  });

  it("reveals the idea form when 'Start a new run' is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={deployedEventsByStage} />);
    await waitFor(() => expect(screen.getByText("Deploy")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Start a new run" }));

    expect(screen.getByLabelText("Idea & requirements")).toBeInTheDocument();
  });

  it("renders a custom stage using its agent's name as the label, resolved from /api/run/plan and /api/agents", async () => {
    stubFetch({
      plan: ["create_repo", "analyst", "custom:sec-1", "architect", "open_issue", "developer", "open_pr", "qa", "post_review", "merge", "deploy", "tracing_pack"],
      agents: [{ id: "sec-1", name: "Security Reviewer", instructions: "x", repoAccess: true, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    const customEventsByStage: EventsByStage = {
      ...eventsByStage,
      "custom:sec-1": [
        { stage: "custom:sec-1", status: "running", message: "Running Security Reviewer", timestamp: "2026-01-01T00:02:00.000Z" },
      ],
    };

    render(<WorkflowsView eventsByStage={customEventsByStage} />);

    await waitFor(() => expect(screen.getByText("Security Reviewer")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- WorkflowsView`
Expected: FAIL — component doesn't yet fetch `/api/workflows`/`/api/run/plan`/`/api/agents`, doesn't render a "Pipeline" picker, doesn't send `workflowId`

- [ ] **Step 3: Modify `web/src/components/WorkflowsView.tsx`**

Replace the full file content:

```typescript
import { useMemo, useState } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { StageNode } from "@/components/StageNode";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { useAgents } from "@/hooks/useAgents";
import { useRunPlan } from "@/hooks/useRunPlan";
import { useWorkflows } from "@/hooks/useWorkflows";
import { deriveOverallStatus, deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { buildStageEdges, buildStageNodes, getStageLabel } from "@/lib/workflowGraph";
import type { StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const nodeTypes = { stage: StageNode };
const TERMINAL_STATUSES = new Set(["deployed", "blocked", "failed"]);

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [workflowId, setWorkflowId] = useState("default");
  const [starting, setStarting] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);

  const overallStatus = deriveOverallStatus(eventsByStage);
  const isIdle = overallStatus === "idle";
  const isTerminal = TERMINAL_STATUSES.has(overallStatus);
  const showForm = isIdle || (isTerminal && showStartForm);

  const { workflows } = useWorkflows();
  const { agents } = useAgents();
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const stageOrder = useRunPlan(isIdle);
  const labelFor = useMemo(() => (stage: StageName) => getStageLabel(stage, agentsById), [agentsById]);

  const nodes = useMemo(() => buildStageNodes(eventsByStage, stageOrder, labelFor), [eventsByStage, stageOrder, labelFor]);
  const edges = useMemo(() => buildStageEdges(eventsByStage, stageOrder), [eventsByStage, stageOrder]);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  async function handleStart() {
    setStarting(true);
    try {
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText, workflowId }),
      });
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
          </div>
          <Button onClick={handleStart} disabled={!ideaText.trim() || starting}>
            {starting ? "Starting..." : "Start run"}
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedStage(node.data.stage)}
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

Note the `workflows.map` in the picker will be empty on the very first render (before `useWorkflows`'s fetch resolves) — that's fine, the `<select>` just shows no options briefly; the default `workflowId` state value `"default"` still gets sent even if the picker hasn't populated yet, since the state doesn't depend on the fetched list. `labelFor` here is a thin wrapper around `getStageLabel` (Task 2), which already handles both the backbone-label lookup and the custom-stage agent-name fallback internally — `WorkflowsView` doesn't need its own `STAGE_LABELS` import at all anymore.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- WorkflowsView`
Expected: PASS (10 tests)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npm run test:web` and `npx tsc -b --noEmit` (from `web/`)
Expected: all tests pass, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add web/src/components/WorkflowsView.tsx web/src/components/WorkflowsView.test.tsx
git commit -m "feat: add pipeline picker and plan-driven canvas to Workflows view"
```

---

### Task 9: Full build and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run everything**

Run, from the repo root: `npm run build && npm test && npm run test:web`
Expected: build succeeds (backend + `web/dist`), backend suite passes (139 tests, unaffected by this plan), frontend suite passes (43 existing + all new tests from Tasks 2-8)

- [ ] **Step 2: Manual check**

Boot the dashboard with dummy credentials (`GITHUB_TOKEN=dummy TARGET_GITHUB_OWNER=dummy DEPLOY_TARGET=render RENDER_API_KEY=dummy RENDER_OWNER_ID=dummy PORT=4173 node dist/cli.js`), then in a browser:
1. Click "Agents" in the sidebar, create an agent, confirm it appears in the list.
2. Click "Pipelines", create a workflow placing that agent in "After QA", confirm it appears in the list and the default workflow has no delete button.
3. Click "Workflows", confirm the idle form's "Pipeline" dropdown lists both "Default" and the new pipeline.
4. (Optional, needs real credentials) Start a run with the new pipeline selected and confirm the custom stage appears in the canvas with the agent's name as its label once the run reaches QA.

- [ ] **Step 3: Commit** (only if Step 2 surfaced a fix — otherwise this task has nothing to commit)

## Definition of done

- `npm run build`, `npm test`, and `npm run test:web` all pass.
- Agents and Pipelines are real, working pages reachable from the sidebar.
- The idle idea-input form has a working Pipeline picker that's sent as `workflowId`.
- The live canvas renders whatever stage order `GET /api/run/plan` returns (falling back to the backbone when empty), with custom stages labeled by their agent's name.
