# Pipeline canvas editor: design

Status: approved, not yet implemented.

## One-liner

Replace the slot-based `PipelineEditor` (three fixed named slots —
`afterAnalyst`/`afterArchitect`/`afterQa` — edited via `@dnd-kit` chips in
boxes) with a React Flow canvas that shows the full fixed 11-stage backbone
and lets you drag any of your custom agents from a palette onto a "+"
insertion point after *any* backbone stage, chaining as many as you like at
each point, capped by an always-present "End" node.

## Why

The current editor (`web/src/components/PipelineEditor.tsx`,
`web/src/lib/pipelineEditor.ts`, added in
[`docs/superpowers/specs/2026-09-11-pipeline-visual-editor-design.md`](2026-09-11-pipeline-visual-editor-design.md))
only lets you splice custom agents in at 3 fixed points. The user wants a
true canvas feel — freely drag agents in, chain them with a "+" per node,
see an explicit end-of-pipeline marker — which the 3-slot model can't
express. Investigation into `runOrchestrator.ts` during brainstorming
confirmed the 11 backbone stages are tightly data-coupled (each mechanical
GitHub/deploy step consumes specific typed output from the specific stage
before it — see that file's `PipelineContext` usage), so reordering the
backbone itself is out of scope; what's actually being generalized is
*where* your own agents can be spliced in — from 3 fixed points to all 11.

## Non-goals

- **No branching or parallel paths.** Every node has at most one outgoing
  connection; the pipeline is one linear chain, same as today's execution
  model (`runOrchestrator` runs one flat array by index). This keeps the
  orchestrator's execution loop completely unchanged — only
  `buildStageSteps`'s splice logic and the data shape it reads from change.
- **No reordering, removing, or adding backbone stages.** The 11 stages
  (`create_repo` … `tracing_pack`) stay fixed, read-only, in their current
  order, for the data-coupling reason above.
- **No free/persisted node positioning.** Layout is always auto-computed
  left-to-right from the chain (backbone stage → its custom agents, in
  order → next backbone stage → … → End), the same way the existing
  read-only run canvas (`web/src/lib/workflowGraph.ts`) lays out
  `stageOrder`. All nodes render with `draggable: false`; "drag and drop"
  means dragging an agent card from the palette onto a "+" insertion point,
  not repositioning nodes already on the canvas. Persisting arbitrary (x,
  y) per node would need new stored state for zero behavioral benefit,
  since the canvas is always a single ordered chain.
- **No drag-to-reorder an already-placed custom agent.** To move one,
  remove it (×) and drop it again at the desired insertion point — a
  second drag-reorder interaction (à la the old `arrayMove`-based sortable
  chips) is a separate feature to design and test, not required by what
  was asked for.
- **No user-placed End node.** It's always auto-rendered as the final node
  after whatever the chain currently ends with, purely a visual "pipeline
  complete" cap — nothing to create, configure, or store.
- **No migration of existing saved pipelines.** The stored `slots` shape
  changes incompatibly (3 named keys → one array per backbone stage);
  existing saved pipeline JSON is discarded/left to be recreated by hand,
  since this is pre-production dev data.
- **`@dnd-kit` and `pipelineEditor.ts` are removed entirely** — insertion
  uses native HTML5 drag-and-drop instead, which is simulable in jsdom
  tests (unlike `@dnd-kit`'s pointer-based gestures, per the prior spec's
  testing non-goal), and there's no more sortable-list behavior to justify
  the dependency.

## Architecture

```
src/orchestrator/types.ts        modified: WorkflowDefinition.slots, WorkflowInputSchema,
                                   ResolvedWorkflow generalize from 3 named keys to
                                   Partial<Record<BackboneStage, string[] | AgentDefinition[]>>
src/orchestrator/runOrchestrator.ts  modified: buildStageSteps splices after any BACKBONE_STEPS entry
src/orchestrator/runController.ts    modified: resolveWorkflow loop replaces 3 named-field mapping
src/dashboard/server.ts          modified: validateWorkflowInput generalizes id-collection/validation
web/src/types.ts                 modified: mirrors the above (WorkflowDefinition, BackboneStage)
web/src/lib/pipelineCanvas.ts     new: pure layout — SlotsState -> React Flow nodes/edges,
                                   fully unit-tested
web/src/components/PipelineCanvas.tsx  new: the canvas + palette (replaces PipelineEditor.tsx)
web/src/components/PipelinesView.tsx   modified: renders PipelineCanvas instead of PipelineEditor
web/src/lib/pipelineEditor.ts, PipelineEditor.tsx  deleted
package.json / web/package.json  modified: @dnd-kit/* removed
```

### Backend: generalized slots

`BackboneStage` is `Exclude<StageName, \`custom:${string}\`>` (already exists
as a shape on the frontend via `STAGE_ORDER`; gets a matching named type on
the backend). `WorkflowDefinition`, `WorkflowInputSchema`, and
`ResolvedWorkflow` all move from 3 named fields to one dictionary:

```ts
export const BACKBONE_STAGES = [
  "create_repo", "analyst", "architect", "open_issue", "developer",
  "open_pr", "qa", "post_review", "merge", "deploy", "tracing_pack",
] as const;
export type BackboneStage = (typeof BACKBONE_STAGES)[number];

export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: Partial<Record<BackboneStage, string[]>>; // agent ids, run in array order, after that stage
  createdAt: string;
}

export const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  slots: z.record(z.enum(BACKBONE_STAGES), z.array(z.string())),
});

export interface ResolvedWorkflow {
  slots: Partial<Record<BackboneStage, AgentDefinition[]>>;
}
```

`createWorkflowHandlers`'s `validateWorkflowInput` (`src/dashboard/server.ts`)
collects ids via `Object.values(parsed.data.slots).flat()` instead of the
three-field spread; the "unknown agent id" and "agent appears at most once"
checks are otherwise unchanged. `runController.ts`'s `resolveAgents` mapping
becomes a loop: `Object.fromEntries(BACKBONE_STAGES.map((stage) => [stage,
resolveAgents(workflow.slots[stage] ?? [])]))`.

`runOrchestrator.ts`'s `buildStageSteps` drops the three `if (step.name ===
...)` branches for a single generalized check:

```ts
export function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[] {
  const steps: StageStep[] = [];
  for (const step of BACKBONE_STEPS) {
    steps.push(step);
    steps.push(...(resolvedWorkflow.slots[step.name] ?? []).map(buildCustomStep));
  }
  return steps;
}
```

This is a simplification of the existing code, not new complexity, and the
execution loop in `runOrchestrator` that walks `stageSteps` by index is
untouched.

### Frontend: the canvas

**Layout (`web/src/lib/pipelineCanvas.ts`, pure, fully unit-tested).**
`buildPipelineGraph(slots: SlotsState, agentsById: Record<string,
AgentDefinition>): { nodes: PipelineFlowNode[]; edges: Edge[] }` walks
`STAGE_ORDER`, emitting, per stage: one `backbone` node, one `insertion`
node (`{ afterStage, index: 0 }`), then for each agent id in
`slots[stage]` a `custom` node (`{ afterStage, index, agentId }`) followed
by another `insertion` node (`index + 1`) — so an insertion point always
sits both before and after every custom agent in a chain, letting you
splice in anywhere, not just at the tail. After the loop (i.e., after
`tracing_pack` and its own trailing insertion point/custom chain), one
fixed `end` node closes the graph. Edges connect each consecutive node in
this flattened sequence. X positions are `index * SPACING` along this same
flattened sequence, Y is constant — a straight horizontal chain, matching
`workflowGraph.ts`'s existing left-to-right convention.

**Node components (`PipelineCanvas.tsx`).**
- `BackboneNode` — read-only box, `STAGE_LABELS[stage]`, same visual style
  as today's `BackboneGroup` boxes.
- `CustomAgentNode` — agent name + "×" remove button (removes that id from
  `slots[afterStage]`, re-running the pure layout).
- `InsertionPointNode` — small "+" target. Native HTML5 drop target
  (`onDragOver` calls `preventDefault` to allow drop, `onDrop` reads
  `event.dataTransfer.getData("application/x-agent-id")` and inserts it
  into `slots[afterStage]` at `index`). Highlights on `onDragEnter`.
- `EndNode` — static, no interactivity, always rendered last.

All nodes render via `ReactFlow` with `nodesDraggable={false}`,
`nodesConnectable={false}`, `elementsSelectable={false}` — same read-only
posture `WorkflowsView` already uses for its run canvas, since position and
manual edge-drawing carry no meaning here.

**Palette.** Unchanged in spirit from today: a side list of every
`AgentDefinition` from `useAgents()` **not currently placed in any slot**
(`usedAgentIds` computed by flattening `Object.values(slots)`, same
exclusion logic as before). Each card has `draggable` +
`onDragStart={(e) => e.dataTransfer.setData("application/x-agent-id",
agent.id)}`.

**State & save.** `PipelineCanvas` keeps `slots: SlotsState` in
`useState`, derives `{ nodes, edges } = buildPipelineGraph(slots,
agentsById)` on every render (no separate reducer needed — insert/remove
are direct `setSlots` updates, unlike the old `applyDragEnd` which had to
interpret drag-event payloads). Same `{ initial?, onSaved, onCancel }`
props and create-vs-edit / `POST`-vs-`PUT` behavior as today's
`PipelineEditor`, including the existing `formError`-on-failure and
network-failure handling.

**`PipelinesView` changes.** Same "New pipeline" / per-row "Edit" button
flow as today; only the rendered component changes from `PipelineEditor` to
`PipelineCanvas`.

## Testing

- **`pipelineCanvas.test.ts`** (new): `buildPipelineGraph` — empty slots
  produces 11 backbone nodes + 11 insertion points (one after every stage,
  including the trailing one after `tracing_pack`, where a chain would
  extend past the whole backbone before the End node) + 1 end node, no
  custom nodes; a populated slot produces custom nodes in array order bracketed by
  insertion points; agent ids resolve to names via `agentsById`, falling
  back to the raw id if unknown (matching `getStageLabel`'s existing
  fallback pattern).
- **`PipelineCanvas.test.tsx`** (new): renders all 11 backbone stage
  labels and the End node; renders the palette excluding a placed agent;
  simulating a `drop` event (with `dataTransfer.getData` stubbed) on an
  insertion point adds that agent to the right stage's slot; the "×"
  button removes an agent and returns it to the palette; Save in create
  mode `POST`s `{ name, slots }` and calls `onSaved`, surfacing
  `formError` on a non-ok response; Save in edit mode (`initial` prop)
  `PUT`s to `/api/workflows/:id` instead.
- **`PipelinesView.test.tsx`**: unchanged expectations (still "New
  pipeline"/"Edit" opens the editor, default workflow has no
  Edit/Delete) — only the rendered child component's identity changes.
- **Backend**: `server.test.ts`'s workflow create/update tests extend to
  cover a slot key beyond the old three (e.g. `create_repo` or
  `tracing_pack`) round-tripping correctly; `runOrchestrator.test.ts` /
  wherever `buildStageSteps` is tested extends similarly, confirming a
  custom step can be spliced after any backbone stage, not just the
  previous three, and that ordering/data-flow to later mechanical steps is
  unaffected.
- **Manual**: boot the dashboard, open Pipelines, create a pipeline,
  drag an agent onto the insertion point right after `create_repo` (a
  point that didn't exist before this change), drag a second agent onto
  the point after `deploy`, confirm the End node renders after it, save,
  reopen via Edit, confirm the canvas reconstructs the same chain, remove
  one agent, save again, confirm persistence after refetch.
