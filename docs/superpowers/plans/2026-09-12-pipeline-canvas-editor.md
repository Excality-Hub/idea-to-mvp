# Pipeline Canvas Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-fixed-slot, `@dnd-kit`-based pipeline editor with a React Flow canvas that lets a user splice their own custom agents in after *any* of the 11 fixed backbone stages, chained via drag-and-drop from a palette, capped by an always-present "End" node.

**Architecture:** Generalize `WorkflowDefinition.slots` from three named fields (`afterAnalyst`/`afterArchitect`/`afterQa`) to one array per backbone stage (`Partial<Record<BackboneStage, string[]>>`) on both backend and frontend. The orchestrator's execution model, and the fixed order/identity of the 11 backbone stages, do not change — only where custom agents can be spliced in generalizes from 3 points to 11. The editor UI is rebuilt on `@xyflow/react` (already a dependency, already used for the read-only run canvas) with a pure layout function producing nodes/edges from `SlotsState`, native HTML5 drag-and-drop for palette-to-canvas insertion, and `nodesDraggable={false}` throughout (position is always auto-computed, never persisted).

**Tech Stack:** TypeScript, Express, Zod, React 19, `@xyflow/react` v12, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-pipeline-canvas-editor-design.md`

## Global Constraints

- Linear chain only — every node has at most one outgoing connection; no branching, no parallel paths.
- The 11 backbone stages (`create_repo` … `tracing_pack`) stay fixed, read-only, in their current order — never reordered, added to, or removed.
- No free or persisted node positioning — canvas layout is always auto-computed left-to-right; all nodes render with `nodesDraggable={false}`.
- No drag-to-reorder an already-placed custom agent — remove (×) and re-drop instead.
- The "End" node is always auto-rendered as the final node — never user-created or configured.
- No migration of existing saved pipeline data — the old `{afterAnalyst, afterArchitect, afterQa}` shape is abandoned outright.
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, and `web/src/lib/pipelineEditor.ts`/`web/src/components/PipelineEditor.tsx` (plus their tests) are removed entirely.
- `tracing_pack` is not a valid splice point (10-entry `BACKBONE_STAGES`,
  not 11) — see the spec's Non-goals correction note. Any task text below
  this point that still says 11 insertion points or lists `tracing_pack`
  as a `BACKBONE_STAGES` member predates this finding.

---

### Task 1: Backend — generalize workflow slots from 3 fixed keys to per-backbone-stage

**Files:**
- Modify: `src/orchestrator/types.ts`
- Modify: `src/orchestrator/workflowStore.ts`
- Modify: `src/orchestrator/runOrchestrator.ts`
- Modify: `src/orchestrator/runController.ts`
- Modify: `src/dashboard/server.ts`
- Modify (fixtures only): `src/dashboard/server.test.ts`, `src/orchestrator/runOrchestrator.test.ts`, `src/orchestrator/runController.test.ts`, `src/orchestrator/workflowStore.test.ts`
- Test (new assertions, same files): `src/dashboard/server.test.ts`, `src/orchestrator/runOrchestrator.test.ts`, `src/orchestrator/runController.test.ts`

**Interfaces:**
- Produces: `BACKBONE_STAGES: readonly BackboneStage[]` and `type BackboneStage` (from `src/orchestrator/types.ts`) — the closed set of the 11 fixed stage names, excluding `` `custom:${string}` ``. `WorkflowDefinition.slots: Partial<Record<BackboneStage, string[]>>`. `ResolvedWorkflow` becomes `{ slots: Partial<Record<BackboneStage, AgentDefinition[]>> }`. `buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[]` (signature unchanged, only its internals generalize) — later frontend tasks don't consume this directly, but Task 3's `pipelineCanvas.ts` mirrors `BACKBONE_STAGES`/`BackboneStage` on the frontend with the same 11 literal values, so keep them in this exact order: `create_repo, analyst, architect, open_issue, developer, open_pr, qa, post_review, merge, deploy, tracing_pack`.

This task touches many files because the data model rename is one coherent, non-decomposable unit — a reviewer can't sensibly approve `types.ts`'s new shape while rejecting `server.ts`'s validation matching it. Work through the steps in order; nothing here is independently shippable until the end.

- [ ] **Step 1: Change the core types in `src/orchestrator/types.ts`**

Replace:

```ts
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

export const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  slots: z.object({
    afterAnalyst: z.array(z.string()),
    afterArchitect: z.array(z.string()),
    afterQa: z.array(z.string()),
  }),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export interface ResolvedWorkflow {
  afterAnalyst: AgentDefinition[];
  afterArchitect: AgentDefinition[];
  afterQa: AgentDefinition[];
}
```

with:

```ts
export const BACKBONE_STAGES = [
  "create_repo",
  "analyst",
  "architect",
  "open_issue",
  "developer",
  "open_pr",
  "qa",
  "post_review",
  "merge",
  "deploy",
  "tracing_pack",
] as const;
export type BackboneStage = (typeof BACKBONE_STAGES)[number];

export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: Partial<Record<BackboneStage, string[]>>;
  createdAt: string;
}

export const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  slots: z.record(z.string(), z.array(z.string())),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export interface ResolvedWorkflow {
  slots: Partial<Record<BackboneStage, AgentDefinition[]>>;
}
```

(The schema validates loosely — any string keys mapping to string arrays — because Zod's `z.record` with an enum key doesn't actually enforce key membership at runtime despite what its inferred type implies. `src/dashboard/server.ts`'s handler does the real "is this a known backbone stage" check in Step 5, the same way it already checks "is this a known agent id" — same validation layering, just one more rule.)

- [ ] **Step 2: Update the default workflow in `src/orchestrator/workflowStore.ts`**

Replace:

```ts
const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: DEFAULT_WORKFLOW_ID,
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: new Date(0).toISOString(),
};
```

with:

```ts
const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: DEFAULT_WORKFLOW_ID,
  name: "Default",
  slots: {},
  createdAt: new Date(0).toISOString(),
};
```

- [ ] **Step 3: Generalize the splice logic in `src/orchestrator/runOrchestrator.ts`**

Replace:

```ts
export function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[] {
  const steps: StageStep[] = [];
  for (const step of BACKBONE_STEPS) {
    steps.push(step);
    if (step.name === "analyst") {
      steps.push(...resolvedWorkflow.afterAnalyst.map(buildCustomStep));
    } else if (step.name === "architect") {
      steps.push(...resolvedWorkflow.afterArchitect.map(buildCustomStep));
    } else if (step.name === "qa") {
      steps.push(...resolvedWorkflow.afterQa.map(buildCustomStep));
    }
  }
  return steps;
}
```

with:

```ts
export function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[] {
  const steps: StageStep[] = [];
  for (const step of BACKBONE_STEPS) {
    steps.push(step);
    const afterThisStage = resolvedWorkflow.slots[step.name as BackboneStage] ?? [];
    steps.push(...afterThisStage.map(buildCustomStep));
  }
  return steps;
}
```

Add `BackboneStage` to the existing `import { ABORTABLE_STAGES, type ResolvedWorkflow, type RunEvent, type StageName } from "./types.js";` line (add `type BackboneStage`).

- [ ] **Step 4: Generalize agent resolution in `src/orchestrator/runController.ts`**

Replace:

```ts
    const resolveAgents = (ids: string[]): AgentDefinition[] =>
      ids.map((id) => {
        const agent = this.config.agentStore.get(id);
        if (!agent) throw new Error(`Unknown agent: ${id}`);
        return agent;
      });
    const resolvedWorkflow: ResolvedWorkflow = {
      afterAnalyst: resolveAgents(workflow.slots.afterAnalyst),
      afterArchitect: resolveAgents(workflow.slots.afterArchitect),
      afterQa: resolveAgents(workflow.slots.afterQa),
    };
```

with:

```ts
    const resolveAgents = (ids: string[]): AgentDefinition[] =>
      ids.map((id) => {
        const agent = this.config.agentStore.get(id);
        if (!agent) throw new Error(`Unknown agent: ${id}`);
        return agent;
      });
    const resolvedWorkflow: ResolvedWorkflow = {
      slots: Object.fromEntries(
        BACKBONE_STAGES.map((stage) => [stage, resolveAgents(workflow.slots[stage] ?? [])]),
      ) as Partial<Record<BackboneStage, AgentDefinition[]>>,
    };
```

Change `import type { ResolvedWorkflow, StageName } from "./types.js";` to `import { BACKBONE_STAGES, type BackboneStage, type ResolvedWorkflow, type StageName } from "./types.js";`.

- [ ] **Step 5: Generalize validation in `src/dashboard/server.ts`**

Replace:

```ts
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
```

with:

```ts
  function validateWorkflowInput(
    body: unknown,
  ): { ok: true; data: { name: string; slots: WorkflowDefinition["slots"] } } | { ok: false; error: string } {
    const parsed = WorkflowInputSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const unknownStage = Object.keys(parsed.data.slots).find(
      (stage) => !(BACKBONE_STAGES as readonly string[]).includes(stage),
    );
    if (unknownStage) {
      return { ok: false, error: `Unknown backbone stage: ${unknownStage}` };
    }
    const slots = parsed.data.slots as Partial<Record<BackboneStage, string[]>>;
    const allIds = Object.values(slots).flat();
    const unknownId = allIds.find((id) => !agentStore.get(id));
    if (unknownId) {
      return { ok: false, error: `Unknown agent id: ${unknownId}` };
    }
    if (new Set(allIds).size !== allIds.length) {
      return { ok: false, error: "An agent may appear at most once across a workflow's slots" };
    }
    return { ok: true, data: { name: parsed.data.name, slots } };
  }
```

Change `import { WorkflowInputSchema, type WorkflowDefinition } from "../orchestrator/types.js";` to `import { BACKBONE_STAGES, WorkflowInputSchema, type BackboneStage, type WorkflowDefinition } from "../orchestrator/types.js";`.

- [ ] **Step 6: Fix existing test fixtures to the new shape**

At this point `npm test` fails to typecheck/compile because every fixture in the test files below still uses `{ afterAnalyst, afterArchitect, afterQa }`. Update each occurrence using this mapping — drop any key whose array is empty, rename `afterAnalyst`→`analyst`, `afterArchitect`→`architect`, `afterQa`→`qa`:

  - `slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] }` → `slots: {}`
  - `slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] }` → `slots: { analyst: ["a"] }`
  - `slots: { afterAnalyst: ["missing"], afterArchitect: [], afterQa: [] }` → `slots: { analyst: ["missing"] }`
  - `slots: { afterAnalyst: ["a"], afterArchitect: ["a"], afterQa: [] }` → `slots: { analyst: ["a"], architect: ["a"] }`
  - `slots: { afterAnalyst: [], afterArchitect: ["sec-1"], afterQa: [] }` → `slots: { architect: ["sec-1"] }`
  - `slots: { afterAnalyst: ["missing-agent"], afterArchitect: [], afterQa: [] }` → `slots: { analyst: ["missing-agent"] }`
  - `slots: { afterAnalyst: ["sec-1"], afterArchitect: [], afterQa: [] }` → `slots: { analyst: ["sec-1"] }`

Apply this across `src/dashboard/server.test.ts` (13 occurrences), `src/orchestrator/runController.test.ts` (4 occurrences), `src/orchestrator/workflowStore.test.ts` (2 occurrences). Also in `src/orchestrator/runOrchestrator.test.ts`, replace the `EMPTY_WORKFLOW` constant:

```ts
const EMPTY_WORKFLOW: ResolvedWorkflow = { afterAnalyst: [], afterArchitect: [], afterQa: [] };
```

with:

```ts
const EMPTY_WORKFLOW: ResolvedWorkflow = { slots: {} };
```

and its three `resolvedWorkflow: { afterAnalyst: [ { ...agent } ], afterArchitect: [], afterQa: [] }` literals (in the "inserts a custom agent step after analyst", "clones the repo before running a repoAccess custom agent", and "does not clone the repo for a custom agent without repoAccess" tests) with `resolvedWorkflow: { slots: { analyst: [ { ...agent } ] } }` — keep the agent object itself unchanged, only the wrapping shape changes.

Verify no occurrences remain:

```bash
grep -rn "afterAnalyst\|afterArchitect\|afterQa" src/
```

Expected: no output.

- [ ] **Step 7: Add a test proving generalization beyond the old 3 stages, in `src/dashboard/server.test.ts`**

Add inside `describe("createWorkflowHandlers", ...)`, near the other `create` tests:

```ts
  it("creates a workflow with a custom agent after a stage outside the old fixed three", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    create(
      { body: { name: "After repo creation", slots: { create_repo: ["a"] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "After repo creation", slots: { create_repo: ["a"] } }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when a slot key isn't one of the fixed backbone stages", () => {
    const { create } = createWorkflowHandlers(makeWorkflowStore(), makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Bad stage", slots: { not_a_stage: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
```

- [ ] **Step 8: Add a test proving generalization in `buildStageSteps`, in `src/orchestrator/runOrchestrator.test.ts`**

Add near the existing "inserts a custom agent step after analyst" test:

```ts
  it("inserts a custom agent step after create_repo, before analyst even starts", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "Repo looks good." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          create_repo: [
            {
              id: "repo-checker",
              name: "Repo Checker",
              instructions: "Sanity-check the new repo.",
              repoAccess: false,
              createdAt: "2026-09-10T00:00:00.000Z",
            },
          ],
        },
      },
    };
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("deployed");
    const createRepoIndex = events.indexOf("create_repo:done");
    const analystIndex = events.indexOf("analyst:running");
    expect(events.slice(createRepoIndex + 1, analystIndex)).toEqual([
      "custom:repo-checker:running",
      "custom:repo-checker:done",
    ]);
  });
```

- [ ] **Step 9: Add a test proving generalization in `RunController`, in `src/orchestrator/runController.test.ts`**

Add near the existing "runs a custom agent inserted by a non-default workflow" test:

```ts
  it("runs a custom agent inserted after a backbone stage other than analyst/architect/qa", async () => {
    const config = makeConfig();
    const auditor: AgentDefinition = {
      id: "auditor-1",
      name: "Deploy Auditor",
      instructions: "Double-check the deploy result.",
      repoAccess: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    config.agentStore = makeAgentStore([auditor]);
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "with-audit",
        name: "With deploy audit",
        slots: { deploy: ["auditor-1"] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(config.deps.agents.custom).mockResolvedValue({
      output: { text: "Deploy looks fine." },
      usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.001 },
    });
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-audit");
    const outcome = await controller.getRunPromise();

    expect(outcome.status).toBe("deployed");
    expect(config.deps.agents.custom).toHaveBeenCalledWith(
      expect.objectContaining({ id: "auditor-1" }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
```

- [ ] **Step 10: Run the full backend test suite**

```bash
npm test
```

Expected: all tests pass, including the 4 new tests added above.

- [ ] **Step 11: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/workflowStore.ts src/orchestrator/runOrchestrator.ts src/orchestrator/runController.ts src/dashboard/server.ts src/dashboard/server.test.ts src/orchestrator/runOrchestrator.test.ts src/orchestrator/runController.test.ts src/orchestrator/workflowStore.test.ts
git commit -m "feat: generalize workflow slots to splice custom agents after any backbone stage"
```

---

### Task 2: Frontend — mirror types and build the pure canvas layout module

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/lib/pipelineCanvas.ts`
- Test: `web/src/lib/pipelineCanvas.test.ts`

**Interfaces:**
- Consumes: `STAGE_LABELS` (existing, `web/src/types.ts`), `AgentDefinition` (existing).
- Produces: `SlotsState = Partial<Record<BackboneStage, string[]>>`; `buildPipelineGraph(slots: SlotsState, agentsById: Record<string, AgentDefinition>): { nodes: PipelineFlowNode[]; edges: Edge[] }`; `insertAgent(slots: SlotsState, afterStage: BackboneStage, index: number, agentId: string): SlotsState`; `removeAgent(slots: SlotsState, afterStage: BackboneStage, agentId: string): SlotsState`; node data types `BackboneNodeData`, `CustomAgentNodeData`, `InsertionPointNodeData`, `EndNodeData`, and the union `PipelineNodeData` plus `PipelineFlowNode = Node<PipelineNodeData>` — Task 3's `PipelineCanvas.tsx` imports all of these.

- [ ] **Step 1: Mirror the backend type changes in `web/src/types.ts`**

Find:

```ts
export const STAGE_ORDER: StageName[] = [
```

Directly after the `STAGE_ORDER` array's closing `];`, add:

```ts
export const BACKBONE_STAGES = [
  "create_repo",
  "analyst",
  "architect",
  "open_issue",
  "developer",
  "open_pr",
  "qa",
  "post_review",
  "merge",
  "deploy",
  "tracing_pack",
] as const;
export type BackboneStage = (typeof BACKBONE_STAGES)[number];
```

Then replace:

```ts
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

with:

```ts
export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: Partial<Record<BackboneStage, string[]>>;
  createdAt: string;
}
```

- [ ] **Step 2: Write the failing test for `buildPipelineGraph` with empty slots**

Create `web/src/lib/pipelineCanvas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPipelineGraph, insertAgent, removeAgent, type SlotsState } from "./pipelineCanvas";
import type { AgentDefinition } from "@/types";

const agentA: AgentDefinition = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB: AgentDefinition = { id: "b", name: "Agent B", instructions: "do b", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentsById = { a: agentA, b: agentB };

describe("buildPipelineGraph", () => {
  it("produces 11 backbone nodes, 11 insertion points, and 1 end node for empty slots", () => {
    const { nodes, edges } = buildPipelineGraph({}, agentsById);

    expect(nodes.filter((n) => n.type === "backbone")).toHaveLength(11);
    expect(nodes.filter((n) => n.type === "insertion")).toHaveLength(11);
    expect(nodes.filter((n) => n.type === "custom")).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "end")).toHaveLength(1);
    expect(edges).toHaveLength(nodes.length - 1);
    expect(nodes[0].id).toBe("backbone:create_repo");
    expect(nodes[nodes.length - 1].id).toBe("end");
  });

  it("brackets each stage's custom agents with insertion points, in array order", () => {
    const slots: SlotsState = { analyst: ["a", "b"] };

    const { nodes } = buildPipelineGraph(slots, agentsById);

    const ids = nodes.map((n) => n.id);
    const analystIndex = ids.indexOf("backbone:analyst");
    expect(ids.slice(analystIndex, analystIndex + 5)).toEqual([
      "backbone:analyst",
      "insertion:analyst:0",
      "custom:analyst:0:a",
      "insertion:analyst:1",
      "custom:analyst:1:b",
    ]);
    expect(ids[analystIndex + 5]).toBe("insertion:analyst:2");
    expect(ids[analystIndex + 6]).toBe("backbone:architect");
  });

  it("resolves a custom node's display name from agentsById, falling back to the raw id", () => {
    const { nodes } = buildPipelineGraph({ qa: ["a", "unknown-id"] }, agentsById);

    const customNodes = nodes.filter((n) => n.type === "custom");
    expect(customNodes.map((n) => n.data.name)).toEqual(["Agent A", "unknown-id"]);
  });
});

describe("insertAgent", () => {
  it("appends to an empty stage", () => {
    expect(insertAgent({}, "analyst", 0, "a")).toEqual({ analyst: ["a"] });
  });

  it("inserts at a given index within an existing chain", () => {
    const slots: SlotsState = { analyst: ["a"] };
    expect(insertAgent(slots, "analyst", 0, "b")).toEqual({ analyst: ["b", "a"] });
    expect(insertAgent(slots, "analyst", 1, "b")).toEqual({ analyst: ["a", "b"] });
  });

  it("does not mutate other stages", () => {
    const slots: SlotsState = { analyst: ["a"], qa: ["b"] };
    expect(insertAgent(slots, "qa", 1, "a")).toEqual({ analyst: ["a"], qa: ["b", "a"] });
  });
});

describe("removeAgent", () => {
  it("removes an agent from its stage", () => {
    expect(removeAgent({ analyst: ["a", "b"] }, "analyst", "a")).toEqual({ analyst: ["b"] });
  });

  it("is a no-op when the agent isn't in that stage", () => {
    const slots: SlotsState = { analyst: ["a"] };
    expect(removeAgent(slots, "analyst", "missing")).toEqual({ analyst: ["a"] });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd web && npm test -- pipelineCanvas
```

Expected: FAIL — `Cannot find module './pipelineCanvas'`.

- [ ] **Step 4: Implement `web/src/lib/pipelineCanvas.ts`**

```ts
import type { Edge, Node } from "@xyflow/react";
import { BACKBONE_STAGES, STAGE_LABELS, type AgentDefinition, type BackboneStage } from "@/types";

export type SlotsState = Partial<Record<BackboneStage, string[]>>;

export const PIPELINE_NODE_X_SPACING = 180;

export interface BackboneNodeData extends Record<string, unknown> {
  stage: BackboneStage;
  label: string;
}

export interface CustomAgentNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
  agentId: string;
  name: string;
}

export interface InsertionPointNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
}

export type EndNodeData = Record<string, unknown>;

export type PipelineNodeData = BackboneNodeData | CustomAgentNodeData | InsertionPointNodeData | EndNodeData;
export type PipelineFlowNode = Node<PipelineNodeData>;

export function buildPipelineGraph(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): { nodes: PipelineFlowNode[]; edges: Edge[] } {
  const nodes: PipelineFlowNode[] = [];
  const edges: Edge[] = [];
  let previousId: string | undefined;
  let x = 0;

  function pushNode(id: string, type: string, data: PipelineNodeData) {
    nodes.push({ id, type, position: { x, y: 0 }, data });
    x += PIPELINE_NODE_X_SPACING;
    if (previousId) {
      edges.push({ id: `${previousId}->${id}`, source: previousId, target: id });
    }
    previousId = id;
  }

  for (const stage of BACKBONE_STAGES) {
    pushNode(`backbone:${stage}`, "backbone", { stage, label: STAGE_LABELS[stage] });
    const agentIds = slots[stage] ?? [];
    pushNode(`insertion:${stage}:0`, "insertion", { afterStage: stage, index: 0 });
    agentIds.forEach((agentId, index) => {
      pushNode(`custom:${stage}:${index}:${agentId}`, "custom", {
        afterStage: stage,
        index,
        agentId,
        name: agentsById[agentId]?.name ?? agentId,
      });
      pushNode(`insertion:${stage}:${index + 1}`, "insertion", { afterStage: stage, index: index + 1 });
    });
  }
  pushNode("end", "end", {});

  return { nodes, edges };
}

export function insertAgent(slots: SlotsState, afterStage: BackboneStage, index: number, agentId: string): SlotsState {
  const current = slots[afterStage] ?? [];
  const next = [...current.slice(0, index), agentId, ...current.slice(index)];
  return { ...slots, [afterStage]: next };
}

export function removeAgent(slots: SlotsState, afterStage: BackboneStage, agentId: string): SlotsState {
  const current = slots[afterStage] ?? [];
  return { ...slots, [afterStage]: current.filter((id) => id !== agentId) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd web && npm test -- pipelineCanvas
```

Expected: PASS, all cases green.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/lib/pipelineCanvas.ts web/src/lib/pipelineCanvas.test.ts
git commit -m "feat: add pure layout module for the pipeline canvas"
```

---

### Task 3: Frontend — build the `PipelineCanvas` component

**Files:**
- Create: `web/src/components/PipelineCanvas.tsx`
- Test: `web/src/components/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: `buildPipelineGraph`, `insertAgent`, `removeAgent`, `SlotsState`, `PipelineFlowNode`, `BackboneNodeData`, `CustomAgentNodeData`, `InsertionPointNodeData` (from Task 2's `@/lib/pipelineCanvas`); `useAgents()` (existing, `@/hooks/useAgents`); `BackboneStage`, `WorkflowDefinition` (from `@/types`); `Button` (`@/components/ui/button`); `cn` (`@/lib/utils`).
- Produces: `export function PipelineCanvas({ initial, onSaved, onCancel }: { initial?: WorkflowDefinition; onSaved: () => void; onCancel: () => void })` — Task 4 imports this to replace `PipelineEditor` in `PipelinesView.tsx`. Native drag-and-drop uses the MIME type `"application/x-agent-id"` on `event.dataTransfer` for both the palette card's `setData` and the insertion point's `getData`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/PipelineCanvas.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineCanvas } from "./PipelineCanvas";

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

function dataTransferWith(agentId: string) {
  return { getData: () => agentId, setData: () => {} } as unknown as DataTransfer;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelineCanvas", () => {
  it("renders all 11 fixed backbone stages and the End node", async () => {
    stubFetch();

    render(<PipelineCanvas onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Analyst")).toBeInTheDocument());
    expect(screen.getByText("Create repo")).toBeInTheDocument();
    expect(screen.getByText("QA review")).toBeInTheDocument();
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
    expect(screen.getByText("End")).toBeInTheDocument();
  });

  it("shows agents not yet placed in the palette, and excludes a placed one", async () => {
    stubFetch();
    const initial = { id: "w1", name: "Existing", slots: { analyst: ["a"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(within(screen.getByTestId("agent-palette")).getByText("Agent B")).toBeInTheDocument());
    expect(within(screen.getByTestId("agent-palette")).queryByText("Agent A")).not.toBeInTheDocument();
    expect(screen.getByText("Agent A")).toBeInTheDocument();
  });

  it("drops a palette agent onto an insertion point after create_repo", async () => {
    stubFetch();

    render(<PipelineCanvas onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-create_repo-0")).toBeInTheDocument());

    fireEvent.drop(screen.getByTestId("insertion-create_repo-0"), { dataTransfer: dataTransferWith("a") });

    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-palette")).queryByText("Agent A")).not.toBeInTheDocument();
  });

  it("removes a placed agent back to the palette", async () => {
    stubFetch();
    const initial = { id: "w1", name: "Existing", slots: { analyst: ["a"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas initial={initial} onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText("Agent A")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: /Remove Agent A/ }));

    expect(within(screen.getByTestId("agent-palette")).getByText("Agent A")).toBeInTheDocument();
  });

  it("saves a new pipeline via POST and calls onSaved", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "New Pipeline");
    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Pipeline", slots: {} }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("saves an edited pipeline via PUT to its id, including a dropped agent", async () => {
    const fetchMock = stubFetch();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const initial = { id: "w1", name: "Existing", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas initial={initial} onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-qa-0")).toBeInTheDocument());
    fireEvent.drop(screen.getByTestId("insertion-qa-0"), { dataTransfer: dataTransferWith("b") });

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workflows/w1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Existing", slots: { qa: ["b"] } }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces a save error without calling onSaved", async () => {
    stubFetch({ save: { ok: false, body: { error: "boom" } } });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas onSaved={onSaved} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Name"), "X");

    await user.click(screen.getByRole("button", { name: "Save pipeline" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the agents fetch error inside the palette", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    render(<PipelineCanvas onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() =>
      expect(within(screen.getByTestId("agent-palette")).getByText("Failed to load agents (undefined)")).toBeInTheDocument(),
    );
  });

  it("calls onCancel when Cancel is clicked", async () => {
    stubFetch();
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<PipelineCanvas onSaved={() => {}} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && npm test -- PipelineCanvas
```

Expected: FAIL — `Cannot find module './PipelineCanvas'`.

- [ ] **Step 3: Implement `web/src/components/PipelineCanvas.tsx`**

```tsx
import { useCallback, useMemo, useState } from "react";
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/hooks/useAgents";
import {
  buildPipelineGraph,
  insertAgent,
  removeAgent,
  type BackboneNodeData,
  type CustomAgentNodeData,
  type InsertionPointNodeData,
  type PipelineFlowNode,
  type SlotsState,
} from "@/lib/pipelineCanvas";
import { cn } from "@/lib/utils";
import type { AgentDefinition, BackboneStage, WorkflowDefinition } from "@/types";

const AGENT_DND_TYPE = "application/x-agent-id";

interface PipelineCanvasProps {
  initial?: WorkflowDefinition;
  onSaved: () => void;
  onCancel: () => void;
}

function BackboneNode({ data }: NodeProps<PipelineFlowNode>) {
  const { label } = data as BackboneNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="nodrag whitespace-nowrap rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground">
        {label}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}

function CustomAgentNode({ data }: NodeProps<PipelineFlowNode>) {
  const { name, onRemove } = data as CustomAgentNodeData & { onRemove: () => void };
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="nodrag flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-foreground">
        <span>{name}</span>
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
          &times;
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}

function InsertionPointNode({ data }: NodeProps<PipelineFlowNode>) {
  const { afterStage, index, onDropAgent } = data as InsertionPointNodeData & { onDropAgent: (agentId: string) => void };
  const [isOver, setIsOver] = useState(false);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        data-testid={`insertion-${afterStage}-${index}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          const agentId = event.dataTransfer.getData(AGENT_DND_TYPE);
          if (agentId) onDropAgent(agentId);
        }}
        className={cn(
          "nodrag flex size-7 items-center justify-center rounded-full border-2 border-dashed text-sm text-muted-foreground",
          isOver ? "border-primary bg-primary/10 text-primary" : "border-border",
        )}
      >
        +
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}

function EndNode() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="nodrag rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground">
        End
      </div>
    </>
  );
}

const nodeTypes = { backbone: BackboneNode, custom: CustomAgentNode, insertion: InsertionPointNode, end: EndNode };

function PaletteCard({ agent }: { agent: AgentDefinition }) {
  return (
    <div
      draggable
      onDragStart={(event) => event.dataTransfer.setData(AGENT_DND_TYPE, agent.id)}
      className="cursor-grab rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground active:cursor-grabbing"
    >
      {agent.name}
    </div>
  );
}

export function PipelineCanvas({ initial, onSaved, onCancel }: PipelineCanvasProps) {
  const { agents, error: agentsError } = useAgents();
  const [name, setName] = useState(initial?.name ?? "");
  const [slots, setSlots] = useState<SlotsState>(initial?.slots ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const agentsById = useMemo(() => Object.fromEntries(agents.map((agent) => [agent.id, agent])), [agents]);
  const usedAgentIds = useMemo(() => new Set(Object.values(slots).flat()), [slots]);
  const paletteAgents = agents.filter((agent) => !usedAgentIds.has(agent.id));

  const handleInsert = useCallback((afterStage: BackboneStage, index: number, agentId: string) => {
    setSlots((prev) => insertAgent(prev, afterStage, index, agentId));
  }, []);
  const handleRemove = useCallback((afterStage: BackboneStage, agentId: string) => {
    setSlots((prev) => removeAgent(prev, afterStage, agentId));
  }, []);

  const graph = useMemo(() => buildPipelineGraph(slots, agentsById), [slots, agentsById]);
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        if (node.type === "insertion") {
          const data = node.data as InsertionPointNodeData;
          return { ...node, data: { ...data, onDropAgent: (agentId: string) => handleInsert(data.afterStage, data.index, agentId) } };
        }
        if (node.type === "custom") {
          const data = node.data as CustomAgentNodeData;
          return { ...node, data: { ...data, onRemove: () => handleRemove(data.afterStage, data.agentId) } };
        }
        return node;
      }),
    [graph.nodes, handleInsert, handleRemove],
  );

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
        let message = "Could not save this pipeline";
        try {
          const body = (await res.json()) as { error?: string };
          message = body.error ?? message;
        } catch {
          // response body wasn't JSON (e.g. a proxy's HTML error page) — keep the fallback message
        }
        setFormError(message);
        return;
      }
      onSaved();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
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

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
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
        <div data-testid="agent-palette" className="flex w-56 shrink-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Available agents</h2>
          {agentsError && <p className="text-sm text-destructive">{agentsError}</p>}
          {paletteAgents.map((agent) => (
            <PaletteCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>

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

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npm test -- PipelineCanvas
```

Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PipelineCanvas.tsx web/src/components/PipelineCanvas.test.tsx
git commit -m "feat: add the pipeline canvas component"
```

---

### Task 4: Wire `PipelineCanvas` into `PipelinesView` and fix remaining fixtures

**Files:**
- Modify: `web/src/components/PipelinesView.tsx`
- Modify (fixtures only): `web/src/components/PipelinesView.test.tsx`, `web/src/components/WorkflowsView.test.tsx`, `web/src/hooks/useWorkflows.test.ts`

**Interfaces:**
- Consumes: `PipelineCanvas` from Task 3 (`@/components/PipelineCanvas`), same `{ initial?, onSaved, onCancel }` props `PipelineEditor` had.

- [ ] **Step 1: Swap the import and both JSX usages in `web/src/components/PipelinesView.tsx`**

Replace:

```tsx
import { PipelineEditor } from "@/components/PipelineEditor";
```

with:

```tsx
import { PipelineCanvas } from "@/components/PipelineCanvas";
```

Replace:

```tsx
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
```

with:

```tsx
  if (editorState.mode === "create") {
    return <PipelineCanvas onSaved={handleSaved} onCancel={() => setEditorState({ mode: "list" })} />;
  }
  if (editorState.mode === "edit") {
    return (
      <PipelineCanvas
        initial={editorState.workflow}
        onSaved={handleSaved}
        onCancel={() => setEditorState({ mode: "list" })}
      />
    );
  }
```

- [ ] **Step 2: Fix the remaining old-shape fixtures**

In `web/src/components/PipelinesView.test.tsx`, replace:

```ts
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
```

with:

```ts
  slots: {},
```

In `web/src/components/WorkflowsView.test.tsx`, replace:

```ts
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
```

with:

```ts
  slots: {},
```

In `web/src/hooks/useWorkflows.test.ts`, replace:

```ts
        slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
```

with:

```ts
        slots: {},
```

Verify no occurrences remain anywhere in `web/src`:

```bash
grep -rn "afterAnalyst\|afterArchitect\|afterQa" web/src/
```

Expected: no output.

- [ ] **Step 3: Run the frontend test suite**

```bash
cd web && npm test
```

Expected: all tests pass. `PipelinesView.test.tsx`'s existing assertions (e.g. `screen.getByLabelText("Name")` after clicking "New pipeline") continue to pass unchanged since `PipelineCanvas` renders the same `Name` field.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PipelinesView.tsx web/src/components/PipelinesView.test.tsx web/src/components/WorkflowsView.test.tsx web/src/hooks/useWorkflows.test.ts
git commit -m "feat: wire the pipeline canvas into the Pipelines page"
```

---

### Task 5: Remove the old dnd-kit editor and dependencies, final verification

**Files:**
- Delete: `web/src/components/PipelineEditor.tsx`, `web/src/components/PipelineEditor.test.tsx`, `web/src/lib/pipelineEditor.ts`, `web/src/lib/pipelineEditor.test.ts`
- Modify: `web/package.json` (and its lockfile, via `npm install`)

- [ ] **Step 1: Confirm nothing else references the old files**

```bash
grep -rln "PipelineEditor\|lib/pipelineEditor\|dnd-kit" web/src/
```

Expected: no output (Task 4 already removed the only production import; this is a final check for stragglers, e.g. in Storybook stories or docs, before deleting).

- [ ] **Step 2: Delete the old editor and its tests**

```bash
git rm web/src/components/PipelineEditor.tsx web/src/components/PipelineEditor.test.tsx web/src/lib/pipelineEditor.ts web/src/lib/pipelineEditor.test.ts
```

- [ ] **Step 3: Remove the `@dnd-kit/*` dependencies from `web/package.json`**

Remove these three lines from the `dependencies` block:

```json
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
```

Then update the lockfile:

```bash
cd web && npm install
```

- [ ] **Step 4: Run the full test suite, backend and frontend**

```bash
npm test
npm test --prefix web
```

Expected: all tests pass in both.

- [ ] **Step 5: Run the production build to catch any leftover type errors**

```bash
npm run build
```

Expected: succeeds with no TypeScript errors (this compiles both the backend `tsc` build and, via `--prefix web`, the frontend build — the fastest way to catch a stray `afterAnalyst`/`afterArchitect`/`afterQa` reference or dnd-kit import missed by the greps above).

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```

Open the dashboard, go to Pipelines, click "New pipeline": confirm all 11 backbone stage boxes render left-to-right ending in an "End" node, drag an agent from the palette onto the "+" after `create_repo`, drag a second agent onto the "+" after `deploy`, save, reopen the pipeline via "Edit", confirm both agents still appear in the same places, remove one, save again, and confirm the change persists after leaving and reopening the page.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore: remove the dnd-kit pipeline editor and its dependencies"
```
