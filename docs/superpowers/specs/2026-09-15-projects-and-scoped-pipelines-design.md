# Projects as containers, pipelines scoped inside them

## Context

Today, "project" in the code means a single run's history record
(`ProjectRecord`: idea text + repo name + events), auto-created only when
someone submits an idea and clicks "Start run". "Pipelines"
(`WorkflowDefinition`) are separate, global, reusable arrangements of
agents around the fixed backbone — not tied to any project. The top-left
`ProjectSwitcher` dropdown lets you flip between the live run and a
read-only view of a past run.

The user wants to explicitly *add* projects from that dropdown, with
pipelines living inside a project rather than floating globally. This
changes what a "project" is (a persistent, named container you create
up front, holding its own pipelines and multiple runs over time) and how
several backend subsystems relate to it.

## Goals

- A project is a named container you create explicitly, holding its own
  pipelines and a history of runs.
- Pipelines are private to the project they were created in.
- All runs within a project share one GitHub repo (created lazily by the
  first run, reused by every run after).
- Different projects can run pipelines concurrently; within one project,
  only one run is active at a time.
- Existing data (today's flat run history + global pipelines) is
  preserved by migrating it into one auto-created "Legacy" project.

## Non-goals

- Concurrent runs *within* the same project.
- A shared/global pipeline library or templates (pipelines stay private
  per project).
- Scoping agents to projects — agents remain a global, shared library
  referenced by pipelines.
- Any change to the fixed backbone stages or how a single run executes
  stage-by-stage (`runOrchestrator.ts`'s step loop is unchanged).

## Data model

```ts
interface Project {
  id: string;
  name: string;
  repoName: string;              // deterministic, derived from name at creation
  repo?: { owner: string; htmlUrl: string; cloneUrl: string }; // set once the first run creates it
  createdAt: string;
}

interface Run {                  // renamed from ProjectRecord
  id: string;
  projectId: string;
  ideaText: string;
  workflowId: string;            // which pipeline this run used
  createdAt: string;
  events: RunEvent[];
}

interface WorkflowDefinition {   // gains projectId
  id: string;
  projectId: string;
  name: string;
  slots: Partial<Record<BackboneStage, string[]>>;
  createdAt: string;
}
```

- `AgentDefinition` is unchanged and stays global.
- Every project is seeded with its own non-deletable `"default"`
  workflow at creation time (a fresh copy, not a shared reference).
- `Project.repoName` is generated once at project-creation time (e.g.
  slugified name + short id) so it's stable and displayable before any
  run has happened; `Project.repo` stays `undefined` until the first
  run's `create_repo` stage actually creates it on GitHub.

## Backend

### Stores

- `projectStore.ts`: new `ProjectStore` (JSON-backed, like today's
  stores) for `Project` records.
- `projectStore.ts`'s current contents (today's `ProjectRecord` +
  `appendEvent`) move to a new `runStore.ts` keyed by `Run.id`, with a
  `listByProject(projectId)` accessor and the same `appendEvent`
  behavior.
- `workflowStore.ts`: `WorkflowStore` gains `listByProject(projectId)`;
  `DEFAULT_WORKFLOW` seeding moves from "one seeded on store init" to
  "cloned into every new project's set at project-creation time".

### RunController becomes per-project

- `RunController` drops `currentProjectId` in favor of `currentRunId`,
  and is instantiated once per project instead of once globally.
- A new `RunControllerRegistry` holds `Map<projectId, RunController>`,
  lazily constructing a controller (wired to that project's own
  `workflowStore.listByProject`, `runStore`, and repo state) the first
  time a run starts for that project. This is what makes concurrent
  runs across projects possible: each controller has its own
  `eventBus`, `status`, `activeController` (abort), and `snapshot` —
  exactly like today's single instance, just multiplied per project.
- Within one project, `start()` still throws if a run is already
  `"running"`/`"stopped"` — unchanged single-run-per-controller guard,
  now scoped correctly.
- The registry's lookup is create-if-absent and used by *both* the SSE
  handler and the run handlers, so opening `/api/projects/:id/events`
  before any run has started still gets a valid (idle) controller to
  subscribe to, not a 404.

### Repo reuse

- `RunController.start()` reads `project.repo`:
  - **Unset (first run):** proceeds exactly as today — `create_repo`
    stage creates the repo from the starter template. On success, the
    controller persists `{ owner, htmlUrl, cloneUrl }` onto the
    `Project` record.
  - **Set (later runs):** `OrchestratorParams` gets a new optional
    `existingRepo` field. The `create_repo` step, if
    `params.existingRepo` is present, skips the GitHub API calls
    entirely, sets `ctx.repo = params.existingRepo`, and emits a `done`
    event immediately ("Reusing existing repo") — keeping the stage
    present in the event stream for UI consistency without re-creating
    anything.
- `repoName`/owner are fixed per project and reused unchanged by every
  run's `open_issue`/`open_pr`/`qa`/`merge`/`deploy`/`tracing_pack`
  steps, same as today.

### API routes

Routes move under `/api/projects/:id/...`:

- `POST /api/projects` — create a project (`{ name }`), returns the new
  `Project` (seeded default pipeline created alongside it).
- `GET /api/projects`, `GET /api/projects/:id` — unchanged shape,
  list/get projects.
- `GET /api/projects/:id/events` — replaces the global `GET /events`
  SSE stream; subscribes to that project's controller's `eventBus`
  (via the registry).
- `POST /api/projects/:id/run`, `/run/stop`, `/run/resume`,
  `/run/gates/:gateId/approve|reject`, `GET /run/plan` — same semantics
  as today's global endpoints, resolved through the registry to that
  project's controller.
- `GET/POST/PUT/DELETE /api/projects/:id/workflows...` — pipeline CRUD,
  scoped by `projectId`, replacing today's global `/api/workflows`.
- `GET /api/projects/:id/runs`, `GET /api/projects/:id/runs/:runId` —
  replaces today's flat run list, for the "Runs history" view.
- `/api/agents` stays as-is (global).

### Migration

On server startup, if the legacy run-history file has data and no
`Project` exists yet:

1. Create one project named `"Legacy"` (`repo` left unset).
2. Every existing `WorkflowDefinition` gets `projectId = <legacy id>`;
   the existing `"default"` entry becomes Legacy's seeded default
   (no duplicate is created).
3. Every existing run record gets `projectId = <legacy id>` and moves
   into the new run store unchanged — events (including each run's own
   original `create_repo` output) are preserved verbatim as history.
4. Legacy's `repo` stays unset, so the first *new* run started in it
   creates a fresh shared repo going forward, same as any new project.

This is a one-time, one-directional migration (old files are read and
rewritten into the new shape; no dual-format support is kept
afterward).

## Frontend

- `ProjectSwitcher` (top-left) becomes a real project list (name +
  created date) plus a **"+ New project"** entry that opens an inline
  create form (name only) and `POST`s to `/api/projects`. Selecting a
  project sets an `activeProjectId` (persisted, e.g. `localStorage`,
  so a refresh keeps you where you were) that now drives the whole app
  — this replaces today's `selectedProjectId` "live vs. history"
  toggle entirely.
- **Pipelines** tab (`PipelinesView`) fetches/creates/edits only
  `activeProjectId`'s workflows.
- **Workflows** tab shows the active project's live run over its
  per-project SSE stream, or the start-run form (idea text + a pipeline
  picker limited to this project's workflows) when idle — same
  component, now parameterized by `activeProjectId`.
- **Runs history** sidebar item (today stubbed, disabled, "Soon") gets
  enabled: lists the active project's past runs, and opens one
  read-only using the existing history view component (renamed
  conceptually to take a `Run` instead of the old flat `ProjectRecord`,
  no visual change).
- `useRunEvents`, `useWorkflows`, `useProjects`/`useProject` hooks all
  gain a `projectId` parameter (or are re-scoped to read
  `activeProjectId` from context) to hit the new project-scoped
  routes.

## Testing

- Unit tests for `ProjectStore`, `runStore.listByProject`,
  `workflowStore.listByProject`.
- `RunControllerRegistry`: two projects can each hold an independent
  `"running"` controller at once; starting a second run in the same
  project while one is active still throws.
- `create_repo` step: unit test both branches (`existingRepo` present
  vs. absent) against `runOrchestrator.ts`.
- Migration: given a fixture of legacy-shaped files, running the
  migration produces one Legacy project owning all prior runs/workflows
  with the `"default"` workflow deduplicated.
- API: project-scoped routes reject/404 appropriately for unknown
  `projectId`; SSE stream only delivers events for its own project.
- Frontend: `ProjectSwitcher` create-project flow, `PipelinesView` and
  `WorkflowsView` scoping to `activeProjectId`, and the new Runs
  history list/detail flow, following existing component test patterns
  (`*.test.tsx`).
