# Agent run control (stop/start/resume): design

Status: proposed.

## One-liner

Let a user stop the currently running LLM-driven agent stage
(analyst/architect/developer/qa), resume it later from where it
stopped, and start a brand-new run — all from the dashboard UI, backed
by a resumable stage-loop refactor of `runOrchestrator`.

## Why

`runOrchestrator` today is a single linear `async` function: once a run
starts (via the CLI), it runs straight through all 11 stages with no
pause point, and the only way to stop it is `Ctrl-C`-ing the process,
which loses all progress. Agent stages call out to `claude -p` via
`child_process.spawn` and can run for minutes; a user watching the
dashboard has no way to interrupt a stage that's going the wrong
direction, or to try it again without discarding the repo/issue/PR
already created earlier in the run.

## Non-goals

- No persistence across process restarts — run state (which stage is
  stopped, its snapshot) lives in memory for the life of the dashboard
  server process, same as `RunEventBus.history` today. Restarting the
  server loses the run.
- No stop/resume control on the 7 non-agent stages (`create_repo`,
  `open_issue`, `open_pr`, `post_review`, `merge`, `deploy`,
  `tracing_pack`) — these are fast GitHub/git/Render calls, not
  long-running LLM calls, and aren't worth interrupting.
- No arbitrary out-of-order stage execution — "start" always means
  "begin the pipeline from `create_repo`"; there's no way to trigger a
  single stage independent of the pipeline's position.
- No multi-run tracking/history UI — one active run at a time, matching
  today's single-process, single-`RunEventBus` model. Starting a new
  run replaces the previous one's state.
- No change to CLI behavior — `idea-to-mvp run <idea-file>` keeps
  auto-starting a run immediately and opening the dashboard, exactly as
  today.

## Architecture

```
runClaudeAgent (claudeAgent.ts)
   spawn(claude, [...], { signal })
   signal abort → child.kill() → reject(AgentStoppedError)
        │
        ▼
agents.{analyst,architect,developer,qa}(input, cwd, signal)
        │
        ▼
runOrchestrator's stage loop (runOrchestrator.ts, rewritten)
   iterates STAGE_STEPS[i].run(ctx, controller)
   catches AgentStoppedError → snapshot + "stopped" outcome
   (all other errors → existing "failed" outcome, unchanged)
        │
        ▼
RunController (new, orchestrator/runController.ts)
   status: idle | running | stopped | done
   currentAbortController, snapshot { stageIndex, ctx }
   start(ideaText) / stop() / resume()
        │
        ▼
Dashboard server (dashboard/server.ts, extended)
   POST /api/run        → controller.start(ideaText)
   POST /api/run/stop    → controller.stop()
   POST /api/run/resume  → controller.resume()
   GET  /events (SSE)    → subscribes to the *current* RunEventBus;
                           closed and re-opened by clients on Start
        │
        ▼
Web dashboard
   overallStatus "idle"/"stopped" (web/src/lib/runEvents.ts, extended)
   idle    → idea textarea + Start button (WorkflowsView or a sibling)
   running → Stop button on the in-flight agent's StageNode
   stopped → Resume button on that StageNode
```

## Components

### `runClaudeAgent` (`src/claudeAgent.ts`)

Accepts an optional `signal: AbortSignal` in `RunClaudeAgentParams`.
When the signal fires, call `child.kill()` and reject with a new
`AgentStoppedError` (distinguishable from a normal non-zero-exit
failure) instead of the generic `Error` used for `code !== 0`.

### Agent functions (`src/agents/{analyst,architect,developer,qa}.ts`)

Each gains an optional `signal` parameter, threaded straight through to
`runClaudeAgent`. `OrchestratorDeps.agents.*` signatures gain the same
parameter.

### `PipelineContext` + stage steps (`src/orchestrator/runOrchestrator.ts`, rewritten)

Replace the flat sequence of local variables (`repo`, `analystOutput`,
`architectOutput`, `issue`, `developerOutput`, `pr`, `qaOutput`, `diff`)
with one mutable `PipelineContext` object that accumulates them as
steps complete. Replace the single `try { 11 blocks }` body with a
loop over an ordered array of step descriptors:

```ts
interface StageStep {
  name: StageName;
  abortable: boolean; // true only for analyst/architect/developer/qa
  run(ctx: PipelineContext, deps: OrchestratorDeps, signal?: AbortSignal): Promise<void>;
}
```

Each step's `run` is today's existing block body for that stage
(unchanged logic — event emission, tracing entry push, the actual
work), just wrapped as a function reading/writing `ctx` instead of
closure locals. This is a mechanical extraction, not a logic change.

The loop:

```ts
for (let i = startIndex; i < STAGE_STEPS.length; i++) {
  const step = STAGE_STEPS[i];
  const controller = step.abortable ? new AbortController() : undefined;
  if (controller) runController.setActive(controller);
  try {
    await step.run(ctx, deps, controller?.signal);
  } catch (error) {
    if (error instanceof AgentStoppedError) {
      eventBus.emit(stageEvent(step.name, "stopped", "Stopped by user"));
      runController.recordSnapshot({ stageIndex: i, ctx });
      return { status: "stopped", stage: step.name };
    }
    // existing failure handling: emit "failed", commit tracing pack, return
  } finally {
    if (controller) runController.clearActive();
  }
}
```

`runOrchestrator`'s exported signature gains a third, optional
parameter: `runOrchestrator(params, deps, resumeState?)`. The CLI never
passes it (unchanged call site, starts fresh at step 0 every time).
`RunController.resume()` is the only caller that passes
`{ stageIndex, ctx }` from its stored snapshot, which makes the loop
start at `stageIndex` with `ctx` already populated instead of building
a fresh one — re-running the stopped step's *entire* block from
scratch (its git setup, if any, plus the agent call), then continuing
forward exactly like a normal run. For
`developer` specifically, re-running the block means re-checking-out
the branch (discarding any partial edits the killed process left in
the working directory) before re-invoking the agent — the step's `run`
already does the checkout as its first action, so this falls out of
"re-run the whole block" for free.

A stopped run does **not** commit a tracing pack — that only happens
on a terminal outcome (`deployed`/`blocked`/`failed`), and `stopped` is
a paused, resumable state, not a terminal one.

### `RunController` (new, `src/orchestrator/runController.ts`)

Owns the lifecycle of the current run, separate from `RunEventBus`
(which stays a pure event pub/sub). One instance lives in the
dashboard server, replaced wholesale on `start()`:

```ts
class RunController {
  status: "idle" | "running" | "stopped" | "done";
  start(ideaText: string): void;   // throws if status is "running"/"stopped"
  stop(): void;                     // throws if no agent stage is active
  resume(): void;                   // throws if no snapshot stored
}
```

Constructed once at server startup with the fixed `OrchestratorDeps`
(github client, git functions, render client, agents, readStarterFiles
— the same values `cli.ts` already assembles). `start(ideaText)` builds
the same `repoName`/`workDir` params the CLI builds today, creates a
fresh `RunEventBus`, and calls `runOrchestrator(params, deps)` with no
`resumeState` (fire-and-forget from the HTTP handler's perspective —
the run continues in the background; the client watches via SSE).
`resume()` calls the same `runOrchestrator(params, deps, snapshot)`
with the stored snapshot instead.

### Dashboard server (`src/dashboard/server.ts`, extended)

- `POST /api/run` `{ ideaText: string }` → `controller.start(ideaText)`,
  204 on success, 409 if a run is already active.
- `POST /api/run/stop` → `controller.stop()`, 204 or 409.
- `POST /api/run/resume` → `controller.resume()`, 204 or 409.
- The server holds a mutable "current session" (`{ eventBus,
  controller }`). `GET /events` subscribes to whichever `RunEventBus`
  is current *at connection time*. When `start()` replaces the bus, the
  server ends all currently-open SSE responses; browsers'
  `EventSource` auto-reconnects by default, so connected clients
  transparently pick up the new (empty) bus's history without any new
  client-side protocol.

### Status model (`src/orchestrator/types.ts`, `web/src/components/status.tsx`, `web/src/lib/runEvents.ts`)

- `StageStatus` gains `"stopped"`.
- `StageDisplayStatus` / `STAGE_STATUS_CONFIG` gains `stopped`: amber,
  pause icon — visually distinct from `failed` (red, X).
- `OverallStatus` gains `"stopped"`; `deriveOverallStatus` checks it
  before falling through to `"running"` (same position as the existing
  `"blocked"` check): if any stage's latest status is `stopped` and
  nothing has `failed`, overall status is `stopped`.
- `RunOutcome` (`runOrchestrator.ts`) gains `{ status: "stopped"; stage: StageName }`.

### Web UI (`web/src/components/{WorkflowsView,StageNode}.tsx`)

- `WorkflowsView`: when `overallStatus === "idle"`, render an idea
  textarea + "Start run" button in place of the canvas, posting to
  `POST /api/run`. Hidden for any other `overallStatus`.
- `StageNode`: for the 4 agent stages only — `status === "running"`
  renders a "Stop" button (`POST /api/run/stop`); `status === "stopped"`
  renders a "Resume" button (`POST /api/run/resume`). Other stages and
  other statuses render no button, unchanged from today.
- Confirmed via the visual companion mockup (idea textarea replacing
  the canvas when idle; Stop/Resume buttons inline in the stage card)
  before writing this spec.

## Error handling / edge cases

- `stop()` while no agent stage is in-flight → 409, no-op. Avoids a
  stale UI click racing against a stage that already finished.
- `resume()` with no stored snapshot → 409, no-op.
- `stop()` racing the tail end of a stage (e.g. the agent call already
  returned and `developer`'s `pushBranch` is in flight) has nothing to
  abort — the `AbortController` is only active while the agent call
  itself is outstanding, so the stage simply finishes normally in this
  race.
- Genuine agent failures (bad JSON, non-zero exit, schema mismatch)
  remain `AgentStoppedError`-distinct and continue to produce a
  `failed` outcome exactly as today.

## Testing

- `runOrchestrator.test.ts`: stop-mid-`developer` produces a `stopped`
  outcome, no tracing pack commit, and preserves the snapshot; resume
  re-runs `developer`'s full block (re-checkout + agent + push) and
  continues through `open_pr`/`qa`/etc. to completion.
- `claudeAgent.test.ts`: aborting the signal kills the child and
  rejects with `AgentStoppedError`.
- Dashboard server tests: the three new endpoints (success + 409
  cases), and that a client's SSE connection reconnects and receives
  the new bus's (empty) history after `start()` replaces the session.
- `StageNode.test.tsx`: Stop button renders only for a running agent
  stage; Resume button renders only for a stopped agent stage; neither
  renders for non-agent stages.
- A small test (new or in `WorkflowsView.test.tsx`) for the idle-state
  Start form rendering and its `POST /api/run` call.

## File layout (new/changed)

```
src/claudeAgent.ts                        + signal param, AgentStoppedError
src/agents/{analyst,architect,developer,qa}.ts   + signal param, threaded through
src/orchestrator/types.ts                 StageStatus + "stopped"
src/orchestrator/runOrchestrator.ts       rewritten: PipelineContext + stage-step loop
src/orchestrator/runOrchestrator.test.ts  + stop/resume cases
src/orchestrator/runController.ts         new: start/stop/resume lifecycle
src/orchestrator/runController.test.ts    new
src/dashboard/server.ts                   + POST /api/run, /api/run/stop, /api/run/resume; mutable current session
src/dashboard/server.test.ts              + new endpoint cases
src/cli.ts                                unchanged (still calls the same start path directly)
web/src/components/status.tsx             + "stopped" status config
web/src/lib/runEvents.ts                  deriveOverallStatus + "stopped"
web/src/components/StageNode.tsx          + Stop/Resume buttons
web/src/components/StageNode.test.tsx     + button-rendering cases
web/src/components/WorkflowsView.tsx      + idle-state Start form
web/src/components/WorkflowsView.test.tsx + Start form case
```

## Dev workflow

Unchanged — `npm run dev --prefix web` (Vite HMR on `:5173`) for UI
iteration, `npm run test:web` for the frontend Vitest suite, `npm test`
for the backend Vitest suite.
