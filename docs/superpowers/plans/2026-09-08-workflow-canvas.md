# Workflow Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vertical `StageCard` list in the dashboard's `WorkflowsView` with a zoomable, pannable, left-to-right canvas that lays the 11 pipeline stages out as connected nodes, using `@xyflow/react` (React Flow).

**Architecture:** A new pure module (`workflowGraph.ts`) turns `eventsByStage` into React Flow `nodes`/`edges` (one node per `STAGE_ORDER` entry, fixed left-to-right spacing, edges colored by whether the source stage is done). A new `StageNode` component renders each node's visual content (reused from the current `StageCard`). `WorkflowsView` is rewritten to render `<ReactFlow>` with these nodes/edges instead of a `flex flex-col` list, wiring node clicks to the existing (unchanged) `StageDetailSheet`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Vitest + React Testing Library, and the new `@xyflow/react` (v12) dependency.

**Spec:** [docs/superpowers/specs/2026-09-08-workflow-canvas-design.md](../specs/2026-09-08-workflow-canvas-design.md)

## Global Constraints

- Single-row, left-to-right layout only — `STAGE_ORDER` is a fixed linear sequence, not a general DAG; no layout library beyond React Flow itself.
- No changes to `RunEvent`, `StageName`, `StageStatus`, `STAGE_ORDER`, `STAGE_LABELS` (`web/src/types.ts`), `useRunEvents`, `runEvents.ts`, or `status.tsx`.
- `StageDetailSheet` internals are unchanged — only what opens it changes (a node click instead of a card click).
- No pan/zoom position persistence; the canvas always calls `fitView` on mount.
- No toggle between old list view and new canvas — full replacement of `WorkflowsView`'s layout.
- `@xyflow/react` is the only new dependency to add.
- Do not hide or remove React Flow's default attribution watermark (its license does not permit removing it without a paid plan).

---

### Task 1: Add `@xyflow/react` and jsdom test polyfill

**Files:**
- Modify: `web/package.json` (via `npm install`)
- Modify: `web/src/test/setup.ts`

**Interfaces:**
- Produces: `@xyflow/react` importable from any file under `web/src`; a global `ResizeObserver` stub available in every Vitest test (jsdom has no native `ResizeObserver`, and React Flow's internal store requires one to measure its container — without this stub, any test that renders `<ReactFlow>` throws `ReferenceError: ResizeObserver is not defined`).

- [ ] **Step 1: Install the dependency**

Run: `npm install @xyflow/react --prefix web`

- [ ] **Step 2: Confirm it landed in `web/package.json`**

Read `web/package.json` and confirm a `"@xyflow/react": "^12.x.x"` line was added under `"dependencies"`.

- [ ] **Step 3: Add the `ResizeObserver` polyfill to the test setup file**

Replace the full contents of `web/src/test/setup.ts` with:

```ts
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 4: Run the full web test suite to confirm no regressions**

Run: `npm test --prefix web`
Expected: PASS (all existing tests green — this step doesn't add new tests, it only adds infrastructure later tasks depend on).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/test/setup.ts
git commit -m "chore: add @xyflow/react and ResizeObserver test polyfill"
```

---

### Task 2: Pure node/edge builder (`workflowGraph.ts`)

**Files:**
- Create: `web/src/lib/workflowGraph.ts`
- Test: `web/src/lib/workflowGraph.test.ts`

**Interfaces:**
- Consumes: `STAGE_ORDER: StageName[]`, `STAGE_LABELS: Record<StageName, string>` (`web/src/types.ts`); `deriveStageStatus(events: RunEvent[] | undefined): StageDisplayStatus` and `type EventsByStage = Partial<Record<StageName, RunEvent[]>>` (`web/src/lib/runEvents.ts`); `type StageDisplayStatus` (`web/src/components/status.tsx`).
- Produces: `STAGE_NODE_WIDTH: number`, `STAGE_NODE_X_SPACING: number`; `interface StageNodeData { label: string; status: StageDisplayStatus; latestEvent: RunEvent | undefined }`; `type StageFlowNode = Node<StageNodeData, "stage">`; `buildStageNodes(eventsByStage: EventsByStage): StageFlowNode[]`; `buildStageEdges(eventsByStage: EventsByStage): Edge[]`. Task 3 (`StageNode`) and Task 4 (`WorkflowsView`) both import from this file.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/workflowGraph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStageEdges, buildStageNodes, STAGE_NODE_X_SPACING } from "./workflowGraph";
import type { EventsByStage } from "./runEvents";

describe("buildStageNodes", () => {
  it("builds one node per pipeline stage, left-to-right by STAGE_ORDER", () => {
    const nodes = buildStageNodes({});
    expect(nodes).toHaveLength(11);
    expect(nodes[0]).toMatchObject({ id: "create_repo", type: "stage", position: { x: 0, y: 0 } });
    expect(nodes[1].position).toEqual({ x: STAGE_NODE_X_SPACING, y: 0 });
    expect(nodes[10]).toMatchObject({ id: "tracing_pack" });
  });

  it("derives pending status and no latest event for a stage with no events", () => {
    const nodes = buildStageNodes({});
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
    const nodes = buildStageNodes(eventsByStage);
    const analyst = nodes.find((n) => n.id === "analyst");
    expect(analyst?.data.status).toBe("done");
    expect(analyst?.data.latestEvent?.message).toBe("Todo app summary");
  });
});

describe("buildStageEdges", () => {
  it("connects each stage to the next in STAGE_ORDER", () => {
    const edges = buildStageEdges({});
    expect(edges).toHaveLength(10);
    expect(edges[0]).toMatchObject({ source: "create_repo", target: "analyst" });
    expect(edges[9]).toMatchObject({ source: "deploy", target: "tracing_pack" });
  });

  it("colors an edge muted when its source stage hasn't completed", () => {
    const edges = buildStageEdges({});
    expect(edges[0].style).toMatchObject({ stroke: "var(--border)" });
  });

  it("colors an edge with the success color once its source stage is done", () => {
    const eventsByStage: EventsByStage = {
      create_repo: [
        { stage: "create_repo", status: "done", message: "Repo created", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const edges = buildStageEdges(eventsByStage);
    expect(edges[0]).toMatchObject({
      source: "create_repo",
      target: "analyst",
      style: { stroke: "var(--success)" },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix web -- src/lib/workflowGraph.test.ts`
Expected: FAIL (`Cannot find module './workflowGraph'` or similar).

- [ ] **Step 3: Implement `workflowGraph.ts`**

Create `web/src/lib/workflowGraph.ts`:

```ts
import type { Edge, Node } from "@xyflow/react";
import type { StageDisplayStatus } from "@/components/status";
import { deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { STAGE_LABELS, STAGE_ORDER, type RunEvent } from "@/types";

export const STAGE_NODE_WIDTH = 240;
export const STAGE_NODE_X_SPACING = 280;

export interface StageNodeData extends Record<string, unknown> {
  label: string;
  status: StageDisplayStatus;
  latestEvent: RunEvent | undefined;
}

export type StageFlowNode = Node<StageNodeData, "stage">;

export function buildStageNodes(eventsByStage: EventsByStage): StageFlowNode[] {
  return STAGE_ORDER.map((stage, index) => {
    const events = eventsByStage[stage];
    return {
      id: stage,
      type: "stage",
      position: { x: index * STAGE_NODE_X_SPACING, y: 0 },
      data: {
        label: STAGE_LABELS[stage],
        status: deriveStageStatus(events),
        latestEvent: events?.[events.length - 1],
      },
    };
  });
}

export function buildStageEdges(eventsByStage: EventsByStage): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const sourceStage = STAGE_ORDER[i];
    const targetStage = STAGE_ORDER[i + 1];
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix web -- src/lib/workflowGraph.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/workflowGraph.ts web/src/lib/workflowGraph.test.ts
git commit -m "feat: add pure node/edge builder for the workflow canvas"
```

---

### Task 3: `StageNode` custom React Flow node

**Files:**
- Create: `web/src/components/StageNode.tsx`
- Test: `web/src/components/StageNode.test.tsx`

**Interfaces:**
- Consumes: `STAGE_STATUS_CONFIG: Record<StageDisplayStatus, { label, dotClassName, icon }>` (`web/src/components/status.tsx`); `cn` (`web/src/lib/utils.ts`); `StageFlowNode`, `STAGE_NODE_WIDTH` (`web/src/lib/workflowGraph.ts`, Task 2).
- Produces: `export function StageNode(props: NodeProps<StageFlowNode>): JSX.Element`. Task 4 (`WorkflowsView`) registers this as `nodeTypes={{ stage: StageNode }}`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/StageNode.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { StageNode } from "./StageNode";
import type { StageFlowNode } from "@/lib/workflowGraph";

const nodeTypes = { stage: StageNode };

function renderStageNode(node: StageFlowNode) {
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 400 }}>
        <ReactFlow nodes={[node]} edges={[]} nodeTypes={nodeTypes} />
      </div>
    </ReactFlowProvider>,
  );
}

describe("StageNode", () => {
  it("renders the stage label, status, and latest message", () => {
    renderStageNode({
      id: "analyst",
      type: "stage",
      position: { x: 0, y: 0 },
      data: {
        label: "Analyst",
        status: "done",
        latestEvent: {
          stage: "analyst",
          status: "done",
          message: "Todo app summary",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      },
    });

    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Todo app summary")).toBeInTheDocument();
  });

  it("shows the waiting placeholder for a pending stage with no events", () => {
    renderStageNode({
      id: "deploy",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { label: "Deploy", status: "pending", latestEvent: undefined },
    });

    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Waiting for this stage to start")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix web -- src/components/StageNode.test.tsx`
Expected: FAIL (`Cannot find module './StageNode'` or similar).

- [ ] **Step 3: Implement `StageNode.tsx`**

Create `web/src/components/StageNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STAGE_STATUS_CONFIG } from "@/components/status";
import { cn } from "@/lib/utils";
import { STAGE_NODE_WIDTH, type StageFlowNode } from "@/lib/workflowGraph";

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { label, status, latestEvent } = data;
  const config = STAGE_STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      style={{ width: STAGE_NODE_WIDTH }}
      className={cn(
        "flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm",
        status === "running" && "border-primary/40",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <Icon className={cn("size-5 shrink-0", config.dotClassName, status === "running" && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          <span className={cn("text-xs font-medium", config.dotClassName)}>{config.label}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {latestEvent ? latestEvent.message : "Waiting for this stage to start"}
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix web -- src/components/StageNode.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StageNode.tsx web/src/components/StageNode.test.tsx
git commit -m "feat: add StageNode custom React Flow node"
```

---

### Task 4: Rewrite `WorkflowsView` as a canvas, retire `StageCard`

**Files:**
- Modify: `web/src/components/WorkflowsView.tsx`
- Modify: `web/src/components/WorkflowsView.test.tsx`
- Modify: `web/src/App.tsx:14`
- Delete: `web/src/components/StageCard.tsx` (no longer used — `WorkflowsView` no longer renders it, and nothing else imports it)

**Interfaces:**
- Consumes: `buildStageNodes`, `buildStageEdges` (`web/src/lib/workflowGraph.ts`, Task 2); `StageNode` (`web/src/components/StageNode.tsx`, Task 3); `StageDetailSheet` (unchanged); `deriveStageStatus`, `EventsByStage` (unchanged); `STAGE_LABELS`, `StageName` (unchanged).
- Produces: `WorkflowsView` keeps its existing public props (`{ eventsByStage: EventsByStage }`) — `App.tsx`'s usage is unchanged except for the surrounding `<main>` class.

- [ ] **Step 1: Write the failing/updated test**

Replace the full contents of `web/src/components/WorkflowsView.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkflowsView } from "./WorkflowsView";
import type { EventsByStage } from "@/lib/runEvents";

const eventsByStage: EventsByStage = {
  analyst: [
    { stage: "analyst", status: "running", message: "Analyzing idea", timestamp: "2026-01-01T00:00:00.000Z" },
    { stage: "analyst", status: "done", message: "Todo app summary", timestamp: "2026-01-01T00:01:00.000Z" },
  ],
};

describe("WorkflowsView", () => {
  it("renders a node for every pipeline stage", () => {
    const { container } = render(<WorkflowsView eventsByStage={eventsByStage} />);
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(11);
  });

  it("opens the detail sheet with the stage's full log on click", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);

    await user.click(screen.getByText("Analyst"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Analyzing idea")).toBeInTheDocument();
    expect(dialog.getByText("Todo app summary")).toBeInTheDocument();
  });

  it("shows a pending, empty-log state for a stage with no events yet", async () => {
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={eventsByStage} />);

    await user.click(screen.getByText("Deploy"));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/hasn.t started/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix web -- src/components/WorkflowsView.test.tsx`
Expected: FAIL (old `WorkflowsView` still renders a `flex flex-col` list of `StageCard` buttons, so `.react-flow__node` won't exist and the click-bubbling target differs).

- [ ] **Step 3: Rewrite `WorkflowsView.tsx`**

Replace the full contents of `web/src/components/WorkflowsView.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StageNode } from "@/components/StageNode";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { buildStageEdges, buildStageNodes } from "@/lib/workflowGraph";
import { STAGE_LABELS, type StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const nodeTypes = { stage: StageNode };

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);

  const nodes = useMemo(() => buildStageNodes(eventsByStage), [eventsByStage]);
  const edges = useMemo(() => buildStageEdges(eventsByStage), [eventsByStage]);

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Live pipeline stages for the current run. Click a stage to see its full log.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedStage(node.id as StageName)}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Controls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <StageDetailSheet
        label={selectedStage ? STAGE_LABELS[selectedStage] : undefined}
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

- [ ] **Step 4: Delete the now-unused `StageCard.tsx`**

```bash
git rm web/src/components/StageCard.tsx
```

- [ ] **Step 5: Update `App.tsx`'s container for a fixed-size canvas**

In `web/src/App.tsx:14`, change:

```tsx
<main className="flex-1 overflow-y-auto">
```

to:

```tsx
<main className="flex-1 overflow-hidden">
```

(React Flow manages its own internal pan/zoom viewport and needs a bounded, non-scrolling container to size itself against.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test --prefix web -- src/components/WorkflowsView.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the full web test suite**

Run: `npm test --prefix web`
Expected: PASS (no other test references `StageCard`, confirmed by `grep -rl "StageCard" web/src` returning nothing but the deleted file).

- [ ] **Step 8: Manual/visual verification**

Run: `npm run dev --prefix web` (and, in another terminal from the repo root, `npm run dev -- run ./idea.md` or an equivalent existing way of feeding it live `RunEvent`s, per the dashboard's existing dev workflow) — confirm in a real browser that:
- all 11 stages render left-to-right and `fitView` frames them on load
- mouse-wheel zoom and click-drag pan work
- the `Controls` zoom in/out/fit-view buttons work
- clicking a node opens `StageDetailSheet` with that stage's log, including input/output JSON where present
- edges ahead of a completed stage render in the success color, others stay muted

- [ ] **Step 9: Commit**

```bash
git add web/src/components/WorkflowsView.tsx web/src/components/WorkflowsView.test.tsx web/src/App.tsx
git commit -m "feat: replace stage list with a zoomable left-to-right workflow canvas"
```

---

## Self-Review Notes

- **Spec coverage:** custom node type + fixed left-to-right spacing (Task 2/3), edges colored by source-stage completion (Task 2), `Controls` + `fitView` (Task 4), unchanged `StageDetailSheet`/data flow (Tasks 2-4 consume but never modify them), new dependency (Task 1), file layout matches the spec's "File layout (new/changed)" section exactly except `StageCard.tsx` is deleted outright rather than trimmed — since the rewritten `WorkflowsView` is its only caller and it gains no other caller, keeping it around as a dead shared-content shim would violate YAGNI; `StageNode.tsx` owns the visual content directly instead.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code and exact commands.
- **Type consistency:** `StageNodeData`/`StageFlowNode` (Task 2) are the single source of truth imported unchanged by `StageNode` (Task 3) and `WorkflowsView` (Task 4); `STAGE_NODE_WIDTH`/`STAGE_NODE_X_SPACING` are defined once (Task 2) and only ever imported elsewhere.
