# Human approval gates in the pipeline: design

Status: approved, not yet implemented.

## One-liner

Let a user drop an "Approval gate" onto any splice point in the pipeline
canvas (the same insertion points custom agents use). When a run reaches
a gate, it pauses and waits for a human to approve (continue) or reject
(end the run, blocked) from the dashboard.

## Why

Today the only thing resembling a quality gate is a single hardcoded
guard: `merge` is skipped if any QA finding is `critical`
(`runOrchestrator.ts`'s `guard` on the `merge` step). There's no way to
require a human to look at anything before the pipeline proceeds, and no
way to place a checkpoint anywhere other than that one fixed spot. This
spec adds a general-purpose, user-placed pause point: an approval gate
that halts the run in place until a human approves or rejects it.

## Non-goals

- **No gate metadata.** A gate has no name, no assigned reviewer, no due
  date, no configurable content to review — just a pause/approve/reject
  point. YAGNI until asked for (confirmed with the user during
  brainstorming).
- **No custom review content.** The reviewer sees the same thing a
  custom agent would see if it ran at that point: the live run view /
  tracing history of everything so far. No new "what should this gate
  show" concept.
- **No revision loop.** Rejecting a gate ends the run the same way a
  QA-critical block does today (`RunOutcome` status, run over). There's
  no "send back to an earlier stage with comments" flow. To try again,
  start a new run.
- **No gate store, no schema migration.** A gate is a bare marker string
  in the existing `WorkflowDefinition.slots` arrays, not a new entity
  with its own CRUD/store like agents or workflows have.
- **No changes to custom agents or backbone stages.** This is purely a
  new kind of splice-point entry alongside custom agents.

## Architecture

```
src/orchestrator/types.ts         modified: StageName gains `gate:${string}`;
                                    add GATE_ID_PREFIX + isGateEntry/parseGateId;
                                    ResolvedWorkflow.slots becomes SlotEntry[]
src/orchestrator/runOrchestrator.ts modified: PipelineContext gains
                                    gateDecisions; buildGateStep; GateWaitingError /
                                    GateRejectedError; main loop branches; new
                                    RunOutcome variant "gate_rejected"
src/orchestrator/runController.ts  modified: start() resolves gate entries
                                    too; new decideGate(gateId, decision) method
src/dashboard/server.ts            modified: validateWorkflowInput skips gate
                                    entries when checking agent ids; two new
                                    routes: POST /api/run/gates/:id/approve,
                                    POST /api/run/gates/:id/reject
web/src/types.ts                   modified: mirrors StageName/isGateEntry/
                                    isGateStage
web/src/lib/pipelineCanvas.ts      modified: buildPipelineGraph emits a "gate"
                                    node type; computeMissingInputs skips gate
                                    entries; insert/remove helpers generalized
web/src/lib/workflowGraph.ts       modified: getStageLabel returns "Approval
                                    gate" for gate stages
web/src/lib/runEvents.ts           modified: deriveOverallStatus checks any
                                    stage for "blocked", not just merge
web/src/components/PipelineCanvas.tsx modified: GateNode component, fixed
                                    "Approval gate" palette card, drop handling
web/src/components/StageNode.tsx   modified: Approve/Reject buttons for a
                                    stopped gate stage, instead of Resume
```

### Stage naming and slot entries

A gate is identified the same way a custom agent is, by a prefixed id
living in the slots array:

```ts
export const GATE_ID_PREFIX = "gate:";
export function isGateEntry(id: string): boolean {
  return id.startsWith(GATE_ID_PREFIX);
}
export function parseGateId(id: string): string {
  return id.slice(GATE_ID_PREFIX.length);
}
```

`StageName` gains a third templated variant:

```ts
export type StageName =
  | ... // unchanged backbone names
  | `custom:${string}`
  | `gate:${string}`;
```

A gate's stage name is `` `gate:${gateId}` ``, where `gateId` is a
`crypto.randomUUID()` generated client-side when the gate is dropped
onto the canvas — mirroring how agent ids are server-generated UUIDs,
just generated in the browser since there's no create-time server round
trip for a gate.

### Resolving gates at run start (`runController.ts`)

`ResolvedWorkflow.slots` (`orchestrator/types.ts`) changes from
`AgentDefinition[]` to a small discriminated union per entry:

```ts
export type SlotEntry =
  | { kind: "agent"; agent: AgentDefinition }
  | { kind: "gate"; id: string };

export interface ResolvedWorkflow {
  slots: Partial<Record<BackboneStage, SlotEntry[]>>;
}
```

`RunController.start()`'s `resolveAgents` becomes `resolveEntries`:

```ts
const resolveEntries = (ids: string[]): SlotEntry[] =>
  ids.map((id) => {
    if (isGateEntry(id)) return { kind: "gate", id: parseGateId(id) };
    const agent = this.config.agentStore.get(id);
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    return { kind: "agent", agent };
  });
```

### Pausing at a gate (`runOrchestrator.ts`)

`PipelineContext` gains `gateDecisions?: Record<string, "approved" |
"rejected">`, keyed by the (unprefixed) gate id. `buildStageSteps` maps
each `SlotEntry` to `buildCustomStep(entry.agent)` or
`buildGateStep(entry.id)`.

```ts
function buildGateStep(id: string): StageStep {
  const stageName = `gate:${id}` as StageName;
  return {
    name: stageName,
    abortable: false,
    async run(ctx, _params, deps) {
      deps.eventBus.emit(stageEvent(stageName, "running", "Awaiting review"));
      const decision = ctx.gateDecisions?.[id];
      if (decision === "approved") {
        deps.eventBus.emit(stageEvent(stageName, "done", "Approved"));
        ctx.tracingEntries.push({ stage: stageName, status: "done", output: { decision } });
        return;
      }
      if (decision === "rejected") {
        throw new GateRejectedError();
      }
      throw new GateWaitingError();
    },
  };
}
```

`abortable: false` because a gate never has a running AbortController to
cancel — it pauses synchronously and unconditionally the first time it's
reached, so `StageNode`'s existing Stop button (which only shows for
`abortable && status === "running"`) never appears for it.

The main loop in `runOrchestrator` gets two new catch branches, placed
alongside the existing `AgentStoppedError` handling:

```ts
} catch (error) {
  if (error instanceof AgentStoppedError || error instanceof GateWaitingError) {
    const message = error instanceof GateWaitingError ? "Waiting for approval" : "Stopped by user";
    deps.eventBus.emit(stageEvent(currentStage, "stopped", message));
    return { status: "stopped", stage: currentStage, resumeState: { stageIndex: i, ctx } };
  }
  if (error instanceof GateRejectedError) {
    deps.eventBus.emit(stageEvent(currentStage, "blocked", "Rejected by reviewer"));
    ctx.tracingEntries.push({ stage: currentStage, status: "blocked" });
    await commitTracingPack("blocked");
    return { status: "gate_rejected", stage: currentStage };
  }
  // ...existing failure handling unchanged
}
```

`RunOutcome` gains one variant: `{ status: "gate_rejected"; stage:
StageName }`. (The existing `blocked` variant carries QA
`findings`/`prUrl`, which don't generalize to an arbitrarily-placed
gate, so this is a separate variant rather than a reuse.)

Waiting and approving reuse the exact `stopped`/`resumeState`/snapshot
machinery `RunController` already has for user-initiated stops:

```ts
decideGate(gateId: string, decision: "approved" | "rejected"): void {
  if (this.status !== "stopped" || !this.snapshot) {
    throw new Error("No stopped run to decide");
  }
  const stageIndex = this.snapshot.resumeState.stageIndex;
  if (this.plan?.[stageIndex] !== `gate:${gateId}`) {
    throw new Error("This gate is not the run's current stopped stage");
  }
  const ctx = this.snapshot.resumeState.ctx;
  ctx.gateDecisions = { ...ctx.gateDecisions, [gateId]: decision };
  this.status = "running";
  this.runFrom(this.snapshot.params, this.snapshot.resumeState);
}
```

Approving re-enters the loop at the same `stageIndex`; the gate step
runs again, now sees `"approved"`, and completes. Rejecting does the
same, except the gate step now throws `GateRejectedError` and the run
ends blocked.

### API (`dashboard/server.ts`)

Two new routes, following the existing `start`/`stop`/`resume` handler
pattern (try/catch → 204 or 409):

```
POST /api/run/gates/:id/approve
POST /api/run/gates/:id/reject
```

`validateWorkflowInput`'s existing "does every slot id resolve to a
known agent" check must skip entries where `isGateEntry(id)` is true.

### Canvas UI (`web/src/lib/pipelineCanvas.ts`, `PipelineCanvas.tsx`)

`buildPipelineGraph` branches on `isGateEntry(entry)` when walking a
slot's entries: gate entries push a `"gate"` node (`GateNodeData {
afterStage, index, gateId }`) instead of a `"custom"` node.
`computeMissingInputs` skips gate entries entirely (a gate has no
declared inputs/outputs, so it can never be flagged and never
contributes to the `available` data-kind set).

The palette in `PipelineCanvas.tsx` gets one fixed, non-agent card:

```tsx
function GatePaletteCard({ onDragStart }: { onDragStart: (e: React.DragEvent) => void }) {
  return (
    <div draggable onDragStart={onDragStart} className="...">
      Approval gate
    </div>
  );
}
```

dragged with a distinct MIME type (`application/x-gate`) so
`InsertionPointNode`'s `onDrop` can tell it apart from an agent drag and
call a new `onDropGate(afterStage, index)` prop, which inserts
`` `gate:${crypto.randomUUID()}` `` into the slot at that position using
the same splice helper agents use. A new `GateNode` component renders
the marker distinctly (different icon/shape from `CustomAgentNode`, no
name — per the "single generic node" decision) with the same remove (×)
affordance.

### Run view UI (`StageNode.tsx`, `workflowGraph.ts`, `runEvents.ts`)

`getStageLabel` returns `"Approval gate"` for any `gate:${string}`
stage (no per-instance name to look up, unlike custom agents).

`StageNode` adds a new `isGateStage(stage)` check (mirroring
`isCustomStage`): when a gate stage is `"stopped"`, it renders
**Approve** / **Reject** buttons instead of the generic **Resume**
button, posting to the two new routes with the gate id parsed out of
the stage name.

`deriveOverallStatus` (`runEvents.ts`) currently only treats the
`merge` stage's `"blocked"` status as an overall-blocked signal:

```ts
if (deriveStageStatus(eventsByStage.merge) === "blocked") return "blocked";
```

This is generalized to check any stage, since a gate can block the run
from anywhere:

```ts
if (Object.values(eventsByStage).some((events) => deriveStageStatus(events) === "blocked")) return "blocked";
```

## Testing

- **`runOrchestrator.test.ts`**: a gate with no decision pauses the run
  (`status: "stopped"`, correct `resumeState`); a gate with `"approved"`
  in `gateDecisions` completes and the pipeline continues past it; a
  gate with `"rejected"` ends the run with `{status: "gate_rejected"}`
  and commits the tracing pack as `"blocked"`; a gate never contributes
  to `ctx` (no fields set) since it has no output.
- **`runController.test.ts`**: `decideGate("approved")` on a run stopped
  at that gate resumes and continues; `decideGate("rejected")` ends the
  run; calling `decideGate` when not stopped, or for a gate id that
  isn't the current stopped stage, throws.
- **`server.test.ts`**: `POST /api/run/gates/:id/approve` and `/reject`
  call through to the controller and return 204 / 409 correctly;
  `validateWorkflowInput` accepts a workflow whose slots contain a
  `gate:` entry without requiring it to resolve to an agent.
- **`pipelineCanvas.test.ts`**: `buildPipelineGraph` emits a `"gate"`
  node for a `gate:` slot entry; `computeMissingInputs` never flags a
  gate entry and a gate never blocks a later custom agent from seeing
  data kinds produced before it.
- **`PipelineCanvas.test.tsx`**: dragging the "Approval gate" palette
  card onto an insertion point inserts a `gate:` entry; the rendered
  gate node's remove button removes it from the slot.
- **`StageNode.test.tsx`**: a stopped gate stage renders Approve/Reject
  (not Resume); clicking each posts to the correct route.
- **`runEvents.test.ts`**: a `"blocked"` event on a non-merge stage now
  yields overall status `"blocked"`.
- **Manual**: build a pipeline with a gate after `architect`, start a
  run, confirm it pauses there with an "Awaiting review"/"Waiting for
  approval" message; approve it and confirm the run continues to
  `open_issue`; run again and reject at the same gate, confirm the run
  ends blocked and the tracing pack committed to the repo records the
  rejection.
