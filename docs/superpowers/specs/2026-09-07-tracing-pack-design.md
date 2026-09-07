# Tracing pack: design

Status: approved, not yet implemented.

## One-liner

Capture the actual input and output of every pipeline stage — not just a
short status message — and (a) show it live in the dashboard, and (b)
commit it as a human-readable `TRACING_PACK.md` into the target repo at
the end of the run, so the generated repo itself proves how it was built.

## Why

`RunEvent` today carries only `{ stage, status, message, timestamp }`.
`message` is a one-line gloss (`analystOutput.summary`, `pr.htmlUrl`,
`"posted"`) — good for a live ticker, useless as an audit trail. The
sales narrative this repo exists for ("idea in, reviewed PR out, watch it
happen") is only half told by a log line per stage; a prospect (or a
teammate debugging a run) should be able to see exactly what the analyst
read and concluded, what the architect handed the developer, what diff QA
reviewed and what it found — either live while the run is happening, or
afterwards by opening the repo the pipeline produced.

## Non-goals

- No new agent calls or extra LLM round-trips — every input/output value
  needed already exists as a typed local variable inside
  `runOrchestrator` (e.g. `analystOutput`, `qaOutput`, `diff`). This is
  capture-and-surface, not new instrumentation.
- No run-history list or cross-run persistence in `idea-to-mvp` itself —
  matches the existing "single run per process, in-memory" limitation
  noted in the dashboard design. The durable copy lives in the *target*
  repo, not here.
- No incremental/per-stage commits to the target repo. One
  `TRACING_PACK.md` commit at the end of the run (see "Commit trigger"
  below) — not a commit-per-stage trail.
- No change to the existing QA-comment-on-PR flow (`post_review` stage)
  — `TRACING_PACK.md` is a separate, additional artifact, not a
  replacement.

## Architecture

```
runOrchestrator()
  │  (unchanged control flow / stage sequence)
  │
  ├─ per stage: eventBus.emit({ stage, status:"running", message, input })
  │             ...call the existing agent/git/github function...
  │             eventBus.emit({ stage, status:"done", message, output })
  │
  ├─ accumulate tracingEntries: TracingPackEntry[] as stages complete
  │
  └─ on exit (deployed | blocked | failed-with-repo-created):
        formatTracingPackMarkdown(tracingEntries, outcome)  → TRACING_PACK.md text
        github.commitFile(owner, repo, "TRACING_PACK.md", text, base branch)
        eventBus.emit({ stage:"tracing_pack", status:"running"|"done"|"failed", ... })
```

`RunEventBus` and the SSE transport (`src/dashboard/server.ts`) are
unchanged — `input`/`output` ride on the existing `RunEvent` shape and
`/events` stream as extra fields.

## Data model

`RunEvent` (`src/orchestrator/types.ts`, mirrored in `web/src/types.ts`)
gains two optional fields:

```ts
export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;   // present on "running" events
  output?: unknown;  // present on "done" events
}
```

`StageName` gains a final value: `"tracing_pack"`. `STAGE_ORDER` /
`STAGE_LABELS` (backend and web) are updated to include it.

Per-stage input/output, drawn from variables already in scope in
`runOrchestrator`:

| Stage | input | output |
|---|---|---|
| `create_repo` | `{ owner, repoName, starterFilePaths }` | `{ htmlUrl, cloneUrl }` |
| `analyst` | `{ ideaText }` | `AnalystOutput` |
| `architect` | `{ analystOutput }` | `ArchitectOutput` |
| `open_issue` | `{ title, body }` | `{ number }` |
| `developer` | `{ issueBody }` | `DeveloperOutput` |
| `open_pr` | `{ title, body, head, base }` | `{ number, htmlUrl }` |
| `qa` | `{ diff }` | `QAOutput` |
| `post_review` | `{ comment }` | `{ posted: true }` |
| `merge` | `{ prNumber }` | `{ merged: true }` |
| `deploy` | `{ name, repoUrl, branch }` | `{ url }` |
| `tracing_pack` | `{ path: "TRACING_PACK.md" }` | `{ committed: true, sha }` |

`starterFilePaths` (not full file contents) keeps the `create_repo`
payload small and focused on what's decision-relevant; template
boilerplate isn't evidence of a choice the pipeline made.

## Commit trigger

One commit, at the end of the run, straight to the base branch (`main`),
via a new `GithubClient.commitFile()` method that reuses the same
`octokit.repos.createOrUpdateFileContents` call already used for starter
files in `createRepoFromStarter`. Runs in all three exit paths:

- **deployed** — after the `deploy` stage.
- **blocked** — after the early return on a critical QA finding (deploy
  is skipped, but the tracing pack up to `qa`/`post_review` is still
  written).
- **failed** — from the `catch` block, only if `create_repo` had already
  completed (no repo to commit to otherwise). The tracing pack includes
  the failed stage's error message as its `output`.

Because `TRACING_PACK.md` is a new, independent file, committing it
straight to `main` is safe even while a PR is still open/blocked for
review — it never touches the same paths the PR's diff does.

## Tracing pack file format

Markdown, one `##` section per stage in run order, each with status,
timestamp, and fenced-JSON `Input` / `Output` blocks. A new pure function
`formatTracingPackMarkdown(entries: TracingPackEntry[], outcome:
RunOutcome): string` in a new `src/orchestrator/tracingPack.ts` owns this
— no orchestration logic, easy to unit test in isolation with hand-built
`TracingPackEntry[]` fixtures.

## Dashboard changes

`StageDetailSheet` (`web/src/components/StageDetailSheet.tsx`) gains an
`Input` / `Output` section per event (pretty-printed, scrollable JSON
`<pre>` blocks) alongside the existing timestamp/status/message line —
same data, same live SSE feed, no new endpoint. The `tracing_pack` stage
renders as an 11th `StageCard` like any other stage; its "output" once
`done` is the commit confirmation.

## Testing

- **Unit:** `src/orchestrator/tracingPack.test.ts` —
  `formatTracingPackMarkdown` against hand-built entries for each of the
  three outcomes (deployed / blocked / failed), including the case where
  `failed` has zero entries (no repo) and should not be called at all.
- **Unit:** `src/github/client.test.ts` — new `commitFile` test
  (mocked Octokit `createOrUpdateFileContents`, correct base64 encoding
  and target branch).
- **Integration:** `src/orchestrator/runOrchestrator.test.ts` — extend
  existing mocked-dependency tests to assert `input`/`output` on emitted
  events for each stage, and that `commitFile` is called exactly once at
  the correct point for each of the three outcomes.
- **Web:** `web/src/components/StageDetailSheet.test.tsx` (new) —
  renders input/output sections when present, omits them gracefully when
  absent (e.g. a `"running"` event with no output yet).

## File layout (new/changed)

```
src/orchestrator/types.ts        + input/output fields, "tracing_pack" StageName
src/orchestrator/runOrchestrator.ts   accumulate TracingPackEntry[], call commitFile
src/orchestrator/tracingPack.ts  new: TracingPackEntry type + formatTracingPackMarkdown
src/orchestrator/tracingPack.test.ts  new
src/github/client.ts             + commitFile()
src/github/client.test.ts        + commitFile tests
web/src/types.ts                 mirror of orchestrator/types.ts changes
web/src/components/StageDetailSheet.tsx   + Input/Output sections
web/src/components/StageDetailSheet.test.tsx   new
```
