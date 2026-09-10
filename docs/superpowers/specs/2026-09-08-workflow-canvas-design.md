# Workflow canvas: design

Status: proposed.

## One-liner

Replace the vertical `StageCard` list in `WorkflowsView` with a
zoomable, pannable, left-to-right canvas (built on `@xyflow/react`) that
lays the 11 pipeline stages out as connected nodes in `STAGE_ORDER`
sequence, preserving the existing click-to-open `StageDetailSheet`
behavior.

## Why

The current dashboard ([2026-09-07-dashboard-ui-design.md](2026-09-07-dashboard-ui-design.md))
renders stages as a top-to-bottom stack of full-width cards in a
scrolling column. That reads fine for ~10 stages on one screen, but it
doesn't communicate that this is a *pipeline* — a sequence with
direction and dependencies — and it doesn't scale visually as more
stages are added (`tracing_pack` already pushed the list to 11 rows).
A left-to-right node graph makes the sequence itself visible, and
pan/zoom lets the view stay legible whether there are 5 stages or 20,
without turning into a long vertical scroll.

## Non-goals

- No branching/parallel graph layout — `STAGE_ORDER` is a fixed linear
  sequence today, so the canvas renders a single-row chain, not a
  general DAG layout engine. If the pipeline becomes non-linear later,
  layout logic will need revisiting.
- No changes to data flow, event derivation, or the backend. `RunEvent`,
  `STAGE_ORDER`, `STAGE_LABELS`, `useRunEvents`, `runEvents.ts`, and
  `status.tsx` are unchanged.
- No changes to `StageDetailSheet` internals — it keeps rendering the
  full event log (including input/output) for whichever stage is
  selected; only what *opens* it changes (a node click instead of a
  card click).
- No persistence of pan/zoom position across reloads or between runs —
  the canvas always fits all stages into view on mount.
- No toggle between the old list view and the new canvas — this is a
  full replacement of `WorkflowsView`'s layout.

## Architecture

```
web/src/types.ts (unchanged)
   STAGE_ORDER, STAGE_LABELS, RunEvent, StageStatus
        │
        ▼
web/src/lib/runEvents.ts (unchanged)
   deriveStageStatus(events) → StageDisplayStatus
        │
        ▼
web/src/components/WorkflowsView.tsx (rewritten)
   builds Node[]/Edge[] from STAGE_ORDER, one node per stage,
   fixed x-increment layout (single row), edges STAGE_ORDER[i] → [i+1]
        │
        ▼
@xyflow/react <ReactFlow>
   nodeTypes={{ stage: StageNode }}
   <Controls />  (zoom in/out/fit-view)
   fitView on mount
        │  onNodeClick
        ▼
   setSelectedStage(stage)  (unchanged state, same as today)
        │
        ▼
StageDetailSheet (unchanged)
```

`App.tsx`'s `<main className="flex-1 overflow-y-auto">` changes to
`<main className="flex-1 overflow-hidden">` (or equivalent fixed-size
flex child) — React Flow owns its own internal pan/zoom viewport and
needs a bounded, non-scrolling container to size itself against.

## Components

- **`StageNode`** (new, `web/src/components/StageNode.tsx`) — a custom
  React Flow node type. Renders the same visual content `StageCard`
  renders today (status icon, label, status color, latest message,
  truncated), as a fixed-width (~240px) card. Left/right source-target
  handles connect it into the chain. `StageCard.tsx`'s internal
  icon/status/label rendering is extracted into a shared piece (e.g. a
  `StageCardContent` component or exported render helper) so both
  `StageNode` and any remaining use of `StageCard` share one
  implementation rather than duplicating the icon/status/label JSX.
- **`WorkflowsView`** (rewritten) — no longer maps `STAGE_ORDER` to a
  `<div className="flex flex-col gap-3">`; instead builds a
  `nodes`/`edges` pair (via `useMemo`, keyed on `eventsByStage`) and
  renders `<ReactFlow nodes={nodes} edges={edges} nodeTypes={...}
  fitView>` with a `<Controls />` child. Still owns `selectedStage`
  state and renders `StageDetailSheet` exactly as before.
- **`StageDetailSheet`** — unchanged.
- **`status.tsx`** — unchanged; `StageNode` imports the same
  `STAGE_STATUS_CONFIG` used today.

### Node layout

Single row, left-to-right: node `i` sits at `x = i * X_SPACING, y = 0`
for a constant `X_SPACING` (wide enough to clear the fixed node width
plus edge label room, e.g. 280px). No vertical offset/staggering —
`STAGE_ORDER` is strictly linear, so a straight horizontal chain is the
simplest correct layout and needs no layout library (e.g. dagre)
beyond React Flow itself.

### Edges

One edge per adjacent pair in `STAGE_ORDER` (`stage[i] → stage[i+1]`),
default (bezier/step, whichever reads cleanest at this spacing) React
Flow edges, colored by the *source* stage's status: muted/gray while
the source stage hasn't completed, the source stage's "done" color
once it has completed — so the edge trail visually shows how far the
run has progressed left-to-right. No edge labels.

### Controls

React Flow's built-in `<Controls />` (zoom in / zoom out / fit view /
[lock, if included by default]) pinned to a corner (bottom-left, React
Flow's default). `fitView` is passed to `<ReactFlow>` so all 11 stages
are framed on first render regardless of viewport width. No minimap
(not requested, and unnecessary for a single-row chain).

## Data flow / state

Unchanged from today except for the shape `WorkflowsView` derives:

- Input: `eventsByStage` (from `useRunEvents()`, via `App.tsx`), same
  as today.
- New derivation: `useMemo` builds `nodes: Node<StageNodeData>[]` (one
  per `STAGE_ORDER` entry, `data: { stage, label, status, latestEvent
  }`, `position` from the fixed-spacing formula above) and
  `edges: Edge[]` (adjacent pairs, `style` derived from the source
  node's status), recomputed when `eventsByStage` changes.
- `selectedStage` state and the `onClick`/`onNodeClick` → open-sheet
  wiring stay exactly as they are today, just triggered from
  `onNodeClick={(_, node) => setSelectedStage(node.data.stage)}`
  instead of `StageCard`'s `onClick`.

## Dependency

Add `@xyflow/react` (React Flow v12) to `web/package.json`. It ships
its own base CSS (`@xyflow/react/dist/style.css`) which needs importing
once (in `WorkflowsView.tsx` or `main.tsx`); custom node/edge styling
layers Tailwind classes on top, consistent with the existing shadcn
approach — no separate theming system introduced.

## Testing

- **Component:** rewrite `WorkflowsView.test.tsx` for the new
  structure. React Flow renders nodes into an SVG/DOM pane rather than
  a plain list, so assertions query by rendered node text/label content
  (e.g. `screen.getByText(STAGE_LABELS.analyst)`) rather than relying on
  list/DOM order. Cases to keep: all 11 stages render, a stage with no
  events shows pending state, clicking a stage's node opens
  `StageDetailSheet` with that stage's full log (same case
  `StageDetailSheet.test.tsx` already covers downstream).
- **New:** a small test (or extended case in the same file) confirming
  edges are colored/keyed based on adjacent-stage completion, if that
  logic is nontrivial enough to warrant its own unit coverage outside
  the component test (candidate: extract the node/edge-building
  functions into `web/src/lib/workflowGraph.ts` so they're pure and
  testable independent of React Flow's render tree, mirroring how
  `runEvents.ts` is already separated from `WorkflowsView`).
- **Manual/visual:** boot the dashboard against a fake `RunEventBus`
  (as the original dashboard-ui spec did) and confirm in a real browser
  that pan, zoom, fit-view, and the node-click → sheet interaction all
  work — jsdom-based component tests don't exercise real pointer/wheel
  gesture handling.

## File layout (new/changed)

```
web/package.json                    + @xyflow/react dependency
web/src/components/WorkflowsView.tsx   rewritten: ReactFlow canvas instead of flex list
web/src/components/StageNode.tsx       new: custom React Flow node, reuses StageCard content
web/src/components/StageCard.tsx       trimmed to shared render logic used by StageNode (and itself, if still used elsewhere)
web/src/lib/workflowGraph.ts           new: pure nodes/edges builder from STAGE_ORDER + eventsByStage
web/src/lib/workflowGraph.test.ts      new: unit tests for the builder
web/src/components/WorkflowsView.test.tsx   updated for canvas structure
web/src/App.tsx                        main container: overflow-y-auto → overflow-hidden (fixed size for canvas)
```

## Dev workflow

Unchanged — `npm run dev --prefix web` (Vite HMR on `:5173`) for UI
iteration, `npm run test:web` for the frontend Vitest suite.
