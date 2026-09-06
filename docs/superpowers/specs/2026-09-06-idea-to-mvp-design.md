# idea-to-mvp: design

Status: brainstormed and approved, ready for implementation planning.

## One-liner

A CLI + local orchestrator + web dashboard that takes a short idea/brief in
Markdown, drives it through a five-stage pipeline of Claude-powered agents
(analyst → architect → developer → QA), and ends with a merged, reviewed
pull request deployed live on Render — a "watch it happen" demo of the
idea → prototype → MVP pipeline the Excality sales decks describe.

## Pivot from `OVERVIEW.md`

`OVERVIEW.md` framed this repo as an orchestrator over four *existing*
Excality-Hub repos (`discovery-agent`, `architecture-builder`, `do-ex`,
`pr-review-graph-bot`). Brainstorming surfaced a different, more coherent
shape for what's actually wanted:

- The pipeline stages are new, self-contained agents built in this repo,
  each backed by a local `claude -p` (Claude Code, non-interactive/print
  mode) subprocess call — not calls into the sibling repos' code.
  `discovery-agent`, `do-ex`, and `pr-review-graph-bot` remain independent
  demos of their own; idea-to-mvp mirrors the same *pipeline stages* the
  decks draw, but implements them fresh.
- Each run is **greenfield**: a brand-new app scaffolded from a fixed
  starter template, not an existing target repo being extended. This is
  what makes "idea" (rather than "existing codebase") a coherent input.
- The pipeline now goes one stage further than the original one-liner: it
  doesn't stop at a reviewed PR, it merges and deploys to a live URL
  (Render). "Idea to MVP" is meant literally.
- A local web dashboard shows live pipeline progress — this is now a
  first-class part of the deliverable, not an afterthought.

No API key management is needed for the agents: `claude -p` uses whatever
local Claude Code auth is already configured on the machine (subscription
login or `ANTHROPIC_API_KEY`), the same precedent `discovery-agent` and
`do-ex` rely on for their own model calls.

## Architecture

```
idea-to-mvp run ./idea.md
        │
        ▼
   Orchestrator ── starts local web server, opens dashboard tab
        │
        ├─ 1. Repo stage (deterministic): create GitHub repo from starter template
        ├─ 2. Analyst agent (claude -p): read idea.md → structured understanding
        ├─ 3. Architect agent (claude -p): idea + starter layout → plan
        │       └─ Repo stage (deterministic): open GitHub issue with the plan
        ├─ 4. Developer agent (claude -p): clone repo, implement issue, push branch
        │       └─ Repo stage (deterministic): open PR
        ├─ 5. QA agent (claude -p): review PR diff → verdict + findings
        │       └─ Repo stage (deterministic): post review as PR comment
        │       └─ gate: any "critical" finding → halt, dashboard shows "blocked"
        │       └─ else: auto-merge PR (squash) into main
        └─ 6. Deploy stage (deterministic): Render API → live URL
```

The judgment-heavy work (understanding the idea, planning, coding,
reviewing) is delegated to four `claude -p` agents. Every GitHub and
Render API call is made by deterministic orchestrator code, never by an
agent directly — the same separation `do-ex` and `pr-review-graph-bot`
already use between their webhook/API layer and their agent logic. Deploy
is deliberately **not** an LLM agent: it's the demo's payoff moment, and a
free-form agent improvising a cloud deploy on camera is a needless
reliability risk.

## Components

- `src/cli.ts` — parses `idea-to-mvp run <idea-file>`, kicks off a run.
- `src/orchestrator/` — runs stages in sequence, tracks in-memory run
  state, emits progress events for the dashboard.
- `src/agents/{analyst,architect,developer,qa}/` — each wraps a `claude -p`
  call: builds a stage-specific prompt, scopes Claude Code's tool access
  to what that stage needs, and parses a structured result out of a
  trailing JSON block in the CLI output.
- `src/deploy/` — deterministic Render API client (create service, trigger
  deploy, poll, return the live URL).
- `src/github/` — deterministic Octokit wrapper (create-from-template,
  issue, PR, comment, merge).
- `src/dashboard/` — a small Express server + SSE stream + a plain
  HTML/JS single page: pipeline stages as a timeline, live log tail per
  stage, links to the repo/issue/PR/live URL as each appears.
- `templates/starter/` — a small bundled Node/Express skeleton pushed as
  the new repo's first commit. No separate GitHub template repo to
  maintain.

## Stage contracts

Each agent's `claude -p` output ends in a fenced JSON block the
orchestrator parses into a typed result.

- **Analyst** — input: `idea.md` text. Output:
  `{ summary, goals[], keyFeatures[], nonGoals[], openQuestions[] }`.
  Ambiguities become notes carried into the plan, not a blocking question
  back to a human — the run stays autonomous end to end.
- **Architect** — input: Analyst's output + a fixed description of the
  starter template's layout. Output:
  `{ issueTitle, issueBody, branchName }`. The orchestrator opens the
  GitHub issue from this verbatim.
- **Developer** — input: the issue body, working with full file+bash
  access in a local clone of the new repo. Implements it, commits, pushes
  the branch, and returns `{ prTitle, prBody }`, a summary of what it did.
  The orchestrator opens the PR from that (`Closes #<n>`).
- **QA** — input: the PR diff, read-only access. Output:
  `{ verdict: "pass"|"block", findings: [{ severity: "info"|"minor"|"major"|"critical", category, summary, file, line }] }`.
  The orchestrator posts findings as a PR comment regardless of verdict.

## Gating and merge/deploy flow

Deploy is blocked only if any QA finding has `severity: "critical"` —
everything else (minor/major/info) is advisory: visible in the dashboard
and the PR comment, but doesn't stop the run. On a passing verdict, the
orchestrator auto-merges the PR (squash) into `main`, then the Deploy
stage points Render at `main` and polls until live. This keeps
"reviewed PR → live app" one honest chain rather than deploying an
unmerged branch.

## Error handling

Any stage failure (agent process crash, unparseable output, GitHub/Render
API error) marks that stage "failed" in the dashboard with its last log
output and halts the run. No retries, no silent fallback — matching the
"log-and-drop" precedent in `do-ex`/`pr-review-graph-bot`. A QA block is a
distinct, expected end state ("blocked"), not a failure. Run state is
in-memory only for v1 — no persistence across restarts, no run-history
list.

## Configuration

| Var | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes | Create repo, issue, PR, comment, merge |
| `TARGET_GITHUB_OWNER` | yes | Org/account new demo repos are created under — recommended to be a sandbox, not `Excality-Hub`, so demo repos don't clutter the real portfolio |
| `RENDER_API_KEY` | yes | Create/deploy the Render service |
| `PORT` | no (default 3000) | Dashboard HTTP port |

No Anthropic API key is required — `claude -p` uses whatever local Claude
Code auth is already set up.

## Testing

Vitest, matching the sibling repos. Mock `claude -p` subprocess calls and
all GitHub/Render API calls — no end-to-end tests against real APIs, same
precedent as `do-ex`/`pr-review-graph-bot`. Cover: each agent's
prompt-building and output-parsing (including malformed/unparseable
output → failure), the orchestrator's stage sequencing and the
critical-severity gate, and the dashboard's event emission.

## Manual demo

Same shape as the sibling repos' "Manual demo" README sections: write a
short `idea.md`, run `idea-to-mvp run ./idea.md`, the dashboard opens
automatically, narrate each stage as it lights up, end on the live Render
URL and the merged PR with the posted review.

## Naming

Keeping `idea-to-mvp` — matches the folder already created and the deck
language, even though it doesn't follow the sibling repos'
`-agent`/`-builder`/`-bot` suffix convention.

## Open items for the implementation plan

- Exact `claude -p` invocation shape per agent (flags, tool scoping,
  timeout/output-size limits, how the trailing JSON block is delimited
  and parsed reliably).
- Dashboard visual design (this spec fixes behavior — live SSE stage
  timeline, logs, links — not layout).
- Whether `do-ex`'s `pr-creator` pattern (opening a PR from a pushed
  branch) has reusable logic worth borrowing for `src/github/`, even
  though idea-to-mvp doesn't depend on `do-ex` directly.
- Should this repo appear in `.github/profile/README.md`'s repo table
  once built (carried over from `OVERVIEW.md`, still open).
