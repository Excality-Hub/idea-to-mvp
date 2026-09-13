# Configurable agents & workflows: design

Status: approved, not yet implemented.

## One-liner

Let a user define new read-only "agent" steps in the dashboard (a name +
free-text instructions, optionally with repo read access) and compose them
into named, saved workflows that slot in around the pipeline's fixed
backbone — so a run can include steps beyond the built-in Analyst,
Architect, Developer, and QA without writing new TypeScript.

## Why

Today every agent stage (`src/agents/analyst.ts`, `architect.ts`,
`developer.ts`, `qa.ts`) is a hand-written file: its own prompt-building
function, its own Zod output schema, and a bespoke call signature wired
into a hardcoded `STAGE_STEPS` array in `runOrchestrator.ts`. Adding a new
kind of review or analysis step currently means writing code. This design
lets that happen from the dashboard instead, matching the direction
already taken for starting a run (idea/requirements typed into the
dashboard rather than an `idea.md` file).

## Scope

One coherent system — a workflow *is* a composition of agents, so this is
one design, not several independent ones — though the implementation plan
will likely phase it: backend/data-model/orchestrator first, dashboard
authoring UI second, since the UI depends on the API existing.

**Non-goals:**
- No rewiring of the infra steps. `create_repo`, `open_issue`, `open_pr`,
  `merge`, `deploy`, and `tracing_pack` stay fixed, in their current
  order, with their current hard dependencies on specific agent outputs
  (e.g. `deploy` needs `ctx.repo`, `open_pr` needs `ctx.developerOutput`).
- No arbitrary DAG/branching. Insertion points are three fixed slots
  around the backbone (see below), not a general graph editor.
- Custom agents are read-only. They get the `Read` tool (like QA) or no
  tools at all (like Analyst/Architect) — never `Bash`/`Write`/`Edit`
  (like Developer). They cannot modify the repo or influence which files
  ship.
- No structured/typed output schema for custom agents. Output is the
  model's free text response, shown in the stage log and tracing pack —
  the same as any other stage's `message`/`output`, just not consumed by
  name anywhere downstream.

## Pipeline shape

The backbone is unchanged:

```
create_repo → analyst → architect → open_issue → developer → open_pr
  → qa → post_review → merge (guard) / deploy → tracing_pack
```

Three **slots** open up around it, each an ordered list of custom agents
that run in sequence at that point:

- `afterAnalyst` — after the Analyst stage, before Architect.
- `afterArchitect` — after Architect, before the GitHub issue is opened.
- `afterQa` — after QA, before the review comment is posted.

A **workflow** is:

```ts
interface WorkflowDefinition {
  id: string;
  name: string;
  slots: {
    afterAnalyst: string[];   // agent ids, in run order
    afterArchitect: string[];
    afterQa: string[];
  };
  createdAt: string;
}
```

A built-in workflow with id `"default"` and all slots empty always exists,
can't be edited or deleted, and reproduces today's exact pipeline.

An agent may appear at most once across all of a workflow's slots — its
`custom:<agentId>` stage name (see Execution engine below) must stay
unique within a single run, since `RunEvent`s are grouped by stage name.
The Pipelines UI enforces this by removing an agent from a slot's picker
once it's already placed anywhere in that workflow.

## Agent definition

```ts
interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;  // free text: what this agent should do
  repoAccess: boolean;    // true → Read tool (like QA); false → no tools (like Analyst/Architect)
  createdAt: string;
}
```

No template placeholders to author. A custom agent step automatically
receives, as context, the idea text plus every prior step's output so far
(built-in and custom), wrapped around the user's `instructions` — the
same pattern `buildAnalystPrompt`/`buildArchitectPrompt` already use, just
generic instead of stage-specific. The full text response is the output;
there is no forced JSON block to parse.

## Persistence

Two JSON files on disk, gitignored, each behind a small store module with
basic CRUD (`AgentStore`, `WorkflowStore` in `src/agents/store.ts` /
`src/orchestrator/workflowStore.ts` or similar):

- `data/agents.json` — `AgentDefinition[]`
- `data/workflows.json` — `WorkflowDefinition[]`, seeded with the
  `"default"` workflow if the file doesn't exist yet.

No database — matches this app's scale (single-process demo, one run at a
time) and keeps the change small.

## Execution engine

`StageName` (`src/orchestrator/types.ts`) gains a template-literal variant
for custom stages:

```ts
export type StageName =
  | "create_repo" | "analyst" | "architect" | "open_issue" | "developer"
  | "open_pr" | "qa" | "post_review" | "merge" | "deploy" | "tracing_pack"
  | `custom:${string}`;   // custom:<agentId>
```

Custom stages are abortable, same as `analyst`/`architect`/`developer`/`qa`
today.

`runOrchestrator.ts` stops building `STAGE_STEPS` as a module-level
constant. Instead, a new function resolves the run's chosen
`WorkflowDefinition` plus the referenced `AgentDefinition`s into an ordered
`StageStep[]`: the same 6 backbone steps (implementations unchanged), with
one generated custom-agent `StageStep` inserted per agent in each slot, in
that slot's configured order. `runOrchestrator` takes this resolved list
instead of importing a constant.

`PipelineContext` gains `customOutputs: Record<string, string>` (agent id
→ that agent's text output), populated as custom steps run, so later
steps — built-in or custom — can read prior custom output as part of their
context the same way `analystOutput`/`architectOutput` are read today.

A new `src/agents/custom.ts` exports a function that, given an
`AgentDefinition` and the accumulated context, builds the wrapped prompt
and calls `runClaudeAgent` with `allowedTools: repoAccess ? ["Read"] : []`.

`RunController.start(ideaText, workflowId)` resolves the workflow (loading
agents from the store) before calling `runOrchestrator`, and records the
resolved plan (ordered `{ stage, label }[]`) for the current run so the
dashboard can fetch it (see below).

## API surface

- `GET /api/agents` / `POST /api/agents` (`{ name, instructions,
  repoAccess }`) / `DELETE /api/agents/:id` — delete is rejected with 409
  if any workflow still references the agent.
- `GET /api/workflows` / `POST /api/workflows` (`{ name, slots }`) /
  `DELETE /api/workflows/:id` — deleting `"default"` is rejected with 400.
- `POST /api/run` gains an optional `workflowId` in its JSON body,
  defaulting to `"default"` when omitted, so existing callers/tests are
  unaffected.
- `GET /api/run/plan` — the resolved ordered stage list (`{ stage, label
  }[]`) for the current/most-recent run, used by the dashboard to draw
  the full canvas — including not-yet-started custom stages — before any
  SSE events arrive.

## Dashboard UI

Two new sidebar pages:

- **Agents** — list of existing agents (name, a "reads repo" badge,
  instructions preview, delete) plus a create form (name, instructions
  textarea, "Give this agent repo read access" checkbox).
- **Pipelines** — list of saved workflows plus a builder: name field,
  three slot pickers (After Analyst / After Architect / After QA), each
  letting you add agents from the library in order and remove/reorder
  them. "Default" shows read-only. (Named "Pipelines," not "Workflows,"
  to avoid colliding with the existing live-run page's name.)

The idle idea-input form (`WorkflowsView`) gains a "Pipeline" dropdown,
sourced from `GET /api/workflows` and defaulting to "Default," sent as
`workflowId` alongside `ideaText` to `POST /api/run`.

The live canvas stops hardcoding `STAGE_ORDER`/`STAGE_LABELS`
(`web/src/lib/workflowGraph.ts`, `web/src/types.ts`). On run start it
fetches `GET /api/run/plan` once and builds nodes from that response
instead — custom stages get their agent's name as the label. This
preserves today's UX (the full pipeline shape renders immediately as
pending, before any events arrive) while making it data-driven.

## Testing

- **Backend:** `AgentStore`/`WorkflowStore` CRUD and default-seeding;
  the step-assembly function (given a workflow + agents, produces the
  right ordered `StageStep[]`, including multiple agents in one slot and
  empty slots); the custom-agent runner (`runClaudeAgent` mocked); the
  new/changed API handlers (agents CRUD, workflows CRUD including the
  409/400 protections, `/api/run` with and without `workflowId`,
  `/api/run/plan`).
- **Frontend:** plan-driven node building in `workflowGraph.ts`; component
  tests for the Agents page (create/list/delete), the Pipelines page
  (create/list/delete, slot assignment and reordering), and the run-start
  form's new dropdown.
- **Manual:** boot the dashboard, create an agent, place it in a slot,
  save a workflow, start a run against it, confirm the custom stage
  appears at the right point in the canvas and its output is visible in
  its detail panel and the committed tracing pack — same manual-check
  pattern used for the earlier canvas and idea-input work.
