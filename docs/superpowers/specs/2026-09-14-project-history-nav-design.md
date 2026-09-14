# Project switcher and run history: design

Status: approved, not yet implemented.

## One-liner

Persist every pipeline run as a "project" record (idea text + repo name +
full stage-event history), and add a project switcher in the top-left of
the header — matching the Lovable prototype the user referenced — that
lets you pick any past project and view its stage timeline read-only,
or jump back to the live run.

## Why

Today `RunController` only ever tracks one run at a time, entirely in
memory (`RunController.eventBus`, `runController.ts`). Once a run
finishes and a new one starts, the old run's event history is gone —
there is no run/project id, no list, nothing to navigate back to. The
sidebar already has a disabled "Runs history" item marked "Soon"
(`Sidebar.tsx`), confirming this is expected, unbuilt functionality.

## Non-goals

- **No project grouping / multiple runs per project.** One run = one
  project, matching the current one-repo-per-run reality
  (`repoName: idea-to-mvp-${Date.now()}`). Re-running an idea creates a
  new project, not a new run under an old one. Confirmed with the user.
- **No interactive history.** Past projects are read-only timelines —
  no resume, no stop, no gate approve/reject on anything but the
  current live run. The backend only supports one active run at a
  time; making history interactive would require reworking
  `RunController` into a multi-run scheduler, which is out of scope.
  Confirmed with the user.
- **No database.** Persistence follows the existing
  `createJsonStore` pattern used for agents/workflows
  (`data/projects.json`). Fine at this tool's demo scale. Confirmed
  with the user.
- **No project naming step.** Display name is the idea text, truncated
  — no new "name your project" UI or agent step.
- **No changes to the "Runs history" sidebar item.** It stays disabled;
  the switcher lives only in the header, per the user's choice.

## Architecture

```
src/orchestrator/projectStore.ts    new: ProjectRecord type,
                                     createProjectStore(filePath), built
                                     on the existing JsonStore helper,
                                     plus an appendEvent(id, event)
                                     convenience method
src/orchestrator/runController.ts   modified: config gains projectStore;
                                     start() creates a ProjectRecord and
                                     subscribes eventBus.onEvent to append
                                     to it for the run's lifetime;
                                     new getCurrentProjectId()
src/dashboard/server.ts             modified: two new routes,
                                     GET /api/projects, GET /api/projects/:id
src/cli.ts                          modified: constructs projectStore
                                     from data/projects.json, wires it
                                     into RunController + createDashboardServer
web/src/types.ts                    modified: mirrors ProjectRecord,
                                     ProjectSummary
web/src/hooks/useProjects.ts        new: fetches /api/projects
web/src/hooks/useProject.ts         new: fetches /api/projects/:id
web/src/components/ProjectSwitcher.tsx new: header dropdown
web/src/components/StageFlowGraph.tsx  new: ReactFlow graph, extracted
                                     out of WorkflowsView so it can be
                                     reused read-only
web/src/components/WorkflowsView.tsx   modified: renders StageFlowGraph
                                     instead of inlining ReactFlow
web/src/components/ProjectHistoryView.tsx new: read-only stage timeline
                                     for a past project
web/src/components/Header.tsx       modified: renders ProjectSwitcher
web/src/App.tsx                     modified: selectedProjectId state;
                                     Workflows tab renders
                                     ProjectHistoryView or WorkflowsView
```

### Backend: `ProjectRecord` and `projectStore.ts`

```ts
export interface ProjectRecord {
  id: string;
  ideaText: string;
  repoName: string;
  createdAt: string;
  events: RunEvent[];
}

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

Rewriting the whole file on every event is the same trade-off
`createJsonStore` already makes for agents/workflows — acceptable at
this tool's scale (confirmed with the user).

### `RunController` changes

`RunControllerConfig` gains `projectStore: ProjectStore`. `start()`
creates the record and subscribes to the (possibly fresh) event bus for
the run's full lifetime — including subsequent `stop()`/`resume()`/
`decideGate()` calls, which reuse the same bus and therefore the same
subscription:

```ts
start(ideaText: string, workflowId: string = DEFAULT_WORKFLOW_ID): void {
  // ...existing validation/resolution unchanged...
  if (this.status === "done") {
    this.eventBus = new RunEventBus();
    this.busReplacedEmitter.emit("replaced");
  }
  this.currentProjectId = randomUUID();
  this.config.projectStore.create({
    id: this.currentProjectId,
    ideaText,
    repoName: params.repoName, // set just below, ordering adjusted accordingly
    createdAt: new Date().toISOString(),
    events: [],
  });
  this.eventBus.onEvent((event) => this.config.projectStore.appendEvent(this.currentProjectId!, event));
  // ...existing plan/params/runFrom unchanged...
}

getCurrentProjectId(): string | undefined {
  return this.currentProjectId;
}
```

(`repoName` is already computed a few lines below in the existing
code — the record creation moves after that line so it can include it.)

### API (`dashboard/server.ts`)

```
GET /api/projects       -> { projects: ProjectSummary[]; currentProjectId: string | null }
GET /api/projects/:id   -> ProjectRecord (404 if unknown)
```

`ProjectSummary` is `Omit<ProjectRecord, "events">` — the list endpoint
never sends full event arrays, keeping the switcher's dropdown fetch
light. `projects` is sorted by `createdAt` descending. `currentProjectId`
comes from `controller.getCurrentProjectId() ?? null`.

### Frontend hooks

`useProjects()` and `useProject(id)` follow the existing
fetch-on-mount-with-cancellation pattern (`useWorkflows.ts`) — no
polling; the switcher list refreshes when a new run starts because
`WorkflowsView`'s existing `handleStart` can call a passed-in
`refetch`.

### `StageFlowGraph` extraction

`WorkflowsView.tsx` currently inlines `nodeTypes`, the `ReactFlow` /
`ReactFlowProvider` / `Controls` tree, and the node-click handler
(lines ~110-129). This is pulled out verbatim into:

```tsx
interface StageFlowGraphProps {
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
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ stage: StageNode }}
        onNodeClick={(_, node) => onSelectStage(node.data.stage)} fitView minZoom={0.1}
        nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} elementsSelectable={false}>
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
```

`WorkflowsView` uses it in place of its inlined block; no behavior
change for the live view.

### `ProjectHistoryView.tsx` (new, read-only)

```tsx
interface ProjectHistoryViewProps {
  project: ProjectRecord;
}
export function ProjectHistoryView({ project }: ProjectHistoryViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const { agents } = useAgents();
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const labelFor = useMemo(() => (stage: StageName) => getStageLabel(stage, agentsById), [agentsById]);
  const eventsByStage = groupEventsByStage(project.events);
  const stageOrder = Object.keys(eventsByStage) as StageName[];
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
        <StageFlowGraph eventsByStage={eventsByStage} stageOrder={stageOrder} labelFor={labelFor} onSelectStage={setSelectedStage} />
      </div>
      <StageDetailSheet
        label={selectedStage ? labelFor(selectedStage) : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null}
        onOpenChange={(open) => { if (!open) setSelectedStage(null); }}
      />
    </div>
  );
}
```

`stageOrder` from `Object.keys` works because `groupEventsByStage`
builds a plain object by iterating events in emission order, and JS
preserves string-key insertion order — the same order the live view's
`useRunPlan` would show, without needing a live-only endpoint.

### `ProjectSwitcher.tsx` (new) and `Header.tsx`

`ProjectSwitcher` owns its own `useProjects()` call and a dropdown
built on the `DropdownMenu` primitive from the already-installed
`radix-ui` package (the same package `sheet.tsx` builds `Sheet` on top
of via its `Dialog` export) — no new dependency, no hand-rolled
outside-click handling. The trigger shows the current project's
truncated idea text; the menu lists every project newest-first, each
row showing its truncated idea text and a relative timestamp, with the
entry matching `currentProjectId` marked "Live". Props:

```ts
interface ProjectSwitcherProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void; // null = back to live
}
```

Clicking the live entry (or a dedicated "Back to live" row when a past
project is selected) calls `onSelect(null)`. `Header` renders
`<ProjectSwitcher selectedProjectId={...} onSelect={...} />` to the
left of the existing "idea-to-mvp" title, passed through from `App`.

### `App.tsx` wiring

```tsx
const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
const { project } = useProject(selectedProjectId); // hook returns undefined while id is null
// ...
<Header overallStatus={overallStatus} connected={connected}
  selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} />
// inside the Workflows tab's hidden-div:
{selectedProjectId && project ? (
  <ProjectHistoryView project={project} />
) : (
  <WorkflowsView eventsByStage={eventsByStage} />
)}
```

Agents/Pipelines tabs are unaffected — `selectedProjectId` only changes
what the Workflows tab renders.

## Testing

- **`projectStore.test.ts`**: `create` + `get` round-trip; `appendEvent`
  appends to an existing record's `events` and no-ops for an unknown id.
- **`runController.test.ts`**: `start()` creates a project record via
  the store with the right `ideaText`/`repoName`; events emitted during
  a run (including across a `stop()`/`resume()`/`decideGate()` cycle)
  all land in that same record's `events`; `getCurrentProjectId()`
  reflects the active run and is unset before any run starts.
- **`server.test.ts`**: `GET /api/projects` returns summaries (no
  `events` field) sorted newest-first plus the correct
  `currentProjectId`; `GET /api/projects/:id` returns the full record
  including `events`, and 404s for an unknown id.
- **`ProjectHistoryView.test.tsx`**: given a `ProjectRecord` with events
  across a few stages, renders a node per stage in first-seen order;
  clicking a node opens `StageDetailSheet` with that stage's events; no
  start-form or interactive controls are rendered.
- **`ProjectSwitcher.test.tsx`**: renders the fetched project list with
  the current one marked "Live"; selecting a past project calls
  `onSelect` with its id; selecting the live entry calls `onSelect(null)`.
- **`WorkflowsView.test.tsx`**: existing tests continue to pass against
  the extracted `StageFlowGraph` (no behavior change expected).
- **Manual**: start a run, let it progress a bit, start a second run
  (creating a second project), open the switcher, select the first
  (now-past) project and confirm its stage graph renders read-only with
  no start form or stage controls, then select "Live" and confirm the
  view returns to the current run's live SSE-driven graph.
