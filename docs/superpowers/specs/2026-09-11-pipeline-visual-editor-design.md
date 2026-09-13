# Pipeline visual editor: design

Status: approved, not yet implemented.

## One-liner

Replace the Pipelines page's dropdown-based "add an agent to a slot" form with
a visual, drag-and-drop editor — a horizontal strip showing the fixed
pipeline backbone with three drop zones (after Analyst, after Architect,
after QA), where agents are dragged in from a palette and reordered by
dragging within a zone — and let that same editor open an existing saved
pipeline for editing, not just creation.

## Why

The current `PipelinesView` (`web/src/components/PipelinesView.tsx`) builds
a workflow through three `<select>` + "Add to X" button pairs per slot. It
works but reads as a form, not as "arranging steps in a pipeline" — the
thing it's actually representing. A drag-and-drop canvas that visually
mirrors the live run canvas's backbone shape makes the slot mechanic (three
fixed insertion points around a fixed backbone) legible at a glance, and
matches how the rest of this dashboard already presents the pipeline
(`WorkflowsView`'s React Flow canvas).

Saved pipelines are also currently create-or-delete only — there's no way to
change an existing one's arrangement without deleting and recreating it
under the same name. This design adds that.

## Non-goals

- **Not a free-form graph editor.** The backbone's shape and the three named
  slots are unchanged from the existing design
  (`docs/superpowers/specs/2026-09-10-configurable-agents-design.md`) — you
  still can't connect an agent to an arbitrary point, only drop it into
  `afterAnalyst`/`afterArchitect`/`afterQa`. A true arbitrary-graph editor
  would require redesigning the backend's workflow model first; out of
  scope here.
- **No cross-slot dragging of an already-placed agent.** Moving an agent
  from one slot to another is remove-then-re-add-from-the-palette, not a
  single drag from zone to zone. This matches what was actually approved
  during brainstorming and keeps the drop-handling logic in one direction
  (palette → slot, or reorder within a slot) instead of needing to also
  detach-and-reattach across zones.
- **No React Flow in the editor.** The live run canvas (`WorkflowsView`)
  keeps using `@xyflow/react` exactly as today. The editor is a separate,
  plain-HTML/CSS flex layout (see Architecture) — layering `@dnd-kit`'s
  pointer-based drag detection inside React Flow's own pan/zoom/node-drag
  event handling is a real integration risk for no benefit, since the
  editor never needs pan, zoom, or a minimap (a fixed ~11 backbone boxes
  plus 3 zones always fits on screen).
- **No true end-to-end test of the drag gesture itself.** `@dnd-kit`'s drag
  detection depends on real pointer events and real layout geometry
  (`getBoundingClientRect`) that jsdom doesn't meaningfully provide, so a
  simulated "drag from palette onto a slot" test would either be fake (not
  actually exercising `@dnd-kit`'s collision detection) or flaky. Testing
  strategy instead: extract the *drop-handling logic* as a pure, fully
  unit-tested function (no DOM), and cover the editor component's
  non-drag interactions (remove, save, cancel) with normal RTL tests — see
  Testing.

## Architecture

```
web/src/lib/pipelineEditor.ts       new: pure drag-end reducer, fully unit-tested
web/src/components/PipelineEditor.tsx   new: the drag-and-drop canvas + palette
web/src/components/PipelinesView.tsx    modified: list stays, inline form
                                          replaced by "New pipeline" / "Edit"
                                          buttons that open PipelineEditor
src/jsonStore.ts                    modified: JsonStore<T> gains update(id, item)
src/orchestrator/workflowStore.ts   unchanged (WorkflowStore = JsonStore<WorkflowDefinition>
                                      already inherits update via the type alias)
src/dashboard/server.ts             modified: createWorkflowHandlers gains
                                      an `update` handler; PUT /api/workflows/:id
```

### Backend: update support

`JsonStore<T>` (`src/jsonStore.ts`) gains:

```ts
export interface JsonStore<T extends { id: string }> {
  list(): T[];
  get(id: string): T | undefined;
  create(item: T): void;
  update(id: string, item: T): void;
  delete(id: string): void;
}
```

implemented as `update: (id, item) => writeAll(readAll().map((existing) => (existing.id === id ? item : existing)))`.
`WorkflowStore` (a type alias for `JsonStore<WorkflowDefinition>`) gets this
for free — no change needed in `workflowStore.ts` itself. `AgentStore`
inherits the same method but nothing in this design calls it; that's fine,
it's a generic store operation, not speculative feature-building for a
single caller.

`createWorkflowHandlers` (`src/dashboard/server.ts`) extracts its existing
`create` handler's validation (parse `WorkflowInputSchema`, check every
slot's agent ids exist, check no agent id repeats across slots) into a
shared helper, then adds:

```ts
const update: express.RequestHandler = (req, res) => {
  if (req.params.id === DEFAULT_WORKFLOW_ID) {
    res.status(400).json({ error: "Cannot edit the default workflow" });
    return;
  }
  const validation = validateWorkflowInput(req.body, agentStore); // shared with create
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const existing = workflowStore.get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  const workflow: WorkflowDefinition = { ...existing, ...validation.data };
  workflowStore.update(req.params.id, workflow);
  res.status(200).json(workflow);
};
```

wired as `app.put("/api/workflows/:id", workflowHandlers.update)`. `id` and
`createdAt` are preserved from the existing record (a `PUT` here means
"replace this workflow's name/slots," not "replace the whole record").

### Frontend: the editor

New dependencies: `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`,
`@dnd-kit/utilities@^3.2.2` (current versions as of this design, confirmed
compatible with React 19).

**Layout.** `PipelineEditor` renders the backbone as a fixed, ordered list
of segments — plain read-only boxes for `create_repo`/`analyst`, a slot
zone, `architect`, a slot zone, `open_issue`/`developer`/`open_pr`/`qa`, a
slot zone, `post_review`/`merge`/`deploy`/`tracing_pack` — each backbone box
using the same label text as `STAGE_LABELS` (`@/types`), connected by small
arrow/chevron separators (CSS, no library). A palette panel alongside lists
every `AgentDefinition` (from `useAgents()`) not currently placed in any of
the three slots (same `usedAgentIds` exclusion logic `PipelinesView`
already has today), each as a `@dnd-kit/core` `useDraggable` source.

**Slots.** Each of the three zones is a `@dnd-kit/sortable` `SortableContext`
over that slot's current agent-id array, wrapped in a `useDroppable` region
so an empty slot can still receive a drop. Each placed agent renders as a
`useSortable` chip (drag handle = the whole chip) showing its name, with an
explicit "×" remove button (removing returns it to the palette).

**Drag handling.** One `DndContext` wraps the whole editor. Every
draggable/droppable/sortable item carries `data` identifying what it is —
`{ type: "palette"; agentId }` for a palette card, `{ type: "slot-item";
slot; agentId }` for a placed chip, `{ type: "slot"; slot }` for a slot's
own empty-space droppable. `onDragEnd` calls the pure `applyDragEnd`
function from `web/src/lib/pipelineEditor.ts`:

```ts
export interface SlotsState {
  afterAnalyst: string[];
  afterArchitect: string[];
  afterQa: string[];
}

export function applyDragEnd(
  slots: SlotsState,
  active: { type: "palette" | "slot-item"; agentId: string; slot?: SlotKey },
  over: { type: "slot" | "slot-item"; slot: SlotKey; agentId?: string } | undefined,
): SlotsState
```

— given the active/over `data` payloads (already destructured by the
caller from the `DragEndEvent`), returns the next `SlotsState`: appending
`active.agentId` to `over.slot` when `active.type === "palette"`; importing
`arrayMove` from `@dnd-kit/sortable` (a pure array-manipulation utility,
importing it doesn't pull in any DOM/React dependency) to reorder within
`over.slot` when `active.type === "slot-item"` and `active.slot ===
over.slot`; returning `slots` unchanged for any other combination
(including a palette item dropped nowhere, or — since cross-slot dragging
of a placed chip is a non-goal — a slot-item dropped on a different slot
than its own, which is a no-op rather than a silent slot change). Because
its only import is that one pure utility, this function is fully
unit-testable with plain object literals, no DOM or React needed.

**Modes.** `PipelineEditor` takes `{ initial?: WorkflowDefinition; onSaved:
() => void; onCancel: () => void }`. No `initial` means create (`name`
starts empty, all slots start empty, Save does `POST /api/workflows`); an
`initial` means edit (fields pre-filled from it, Save does `PUT
/api/workflows/:id`). Both paths reuse the same `formError`-on-failure
pattern `PipelinesView`'s current form already has.

**`PipelinesView` changes.** The inline creation form is removed. A "New
pipeline" button and, per non-default row, an "Edit" button both switch
local state to render `PipelineEditor` (in create or edit mode
respectively) in place of the list; `onSaved`/`onCancel` switch back to the
list view and `refetch()` the workflow list.

## Testing

- **`pipelineEditor.test.ts`** (new): `applyDragEnd` — palette-to-empty-slot
  append, palette-to-nonempty-slot append (preserves existing order, adds
  at the end), reorder within a slot via a slot-item-to-slot-item drop,
  reorder to the front/back of a slot, a slot-item dropped on a different
  slot is a no-op, an `over: undefined` (dropped outside any target) is a
  no-op.
- **`PipelineEditor.test.tsx`** (new): renders the backbone boxes and three
  slot zones; renders the palette with all agents when slots are empty and
  excludes a placed agent from the palette; the "×" remove button returns
  an agent to the palette; Save in create mode posts to `POST
  /api/workflows` with the current name/slots and calls `onSaved` on
  success, surfacing `formError` on a non-ok response; Save in edit mode
  (rendered with an `initial` prop) puts to `PUT /api/workflows/:id`
  instead. These tests drive state via direct prop/button interactions,
  not simulated drag gestures — see the Non-goals note on why.
- **`PipelinesView.test.tsx`** (updated): "New pipeline" and "Edit" open the
  editor; the list still shows saved pipelines with no Edit/Delete on the
  default workflow.
- **Backend**: `jsonStore.test.ts` gains an `update` test (replaces an
  existing item, no-op-shaped if the id doesn't exist — matches `delete`'s
  existing no-op-on-missing-id behavior for consistency). `server.test.ts`
  gains tests for the new `update` handler: success case, 400 on the
  default workflow id, 400 on an unknown/duplicate agent id (reusing
  whatever assertions the existing `create` tests already have for those,
  now against the shared validation helper), 404 on an unknown workflow id.
- **Manual**: boot the dashboard, open Pipelines, create a pipeline by
  dragging an agent from the palette into a slot and reordering two agents
  within a slot, save it, reopen it via Edit, confirm the canvas
  pre-populates correctly, rearrange and save again, confirm the change
  persists after a refetch.
