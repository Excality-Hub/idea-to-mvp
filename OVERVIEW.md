# idea-to-mvp: overview

Status: pre-brainstorm brief, not yet a spec. Hand this to a fresh Claude Code
session and run `superpowers:brainstorming` before writing `spec.md`, matching
how `agent-evals` and `ex-skills` were started.

## One-liner

Orchestrate Excality's existing point-solution agents into one run — an idea
or requirement goes in, a reviewed pull request comes out — so the sales
narrative in the Excality decks (idea → prototype → MVP in days/weeks) is
something a prospect can watch happen, not a diagram.

## Why this repo

`excality_projects` (org: `Excality-Hub`) already has working or in-progress
agents that each cover one stage of the pipeline the sales decks draw:

| Deck pipeline stage | Existing repo | Status |
|---|---|---|
| Analyst (understand the problem/codebase) | `discovery-agent` | steps 1-3/6 built |
| Architecture / Product agent | `architecture-builder` | empty folder, no spec |
| Development agent | `do-ex` | working (issue-worker, pr-creator via Codex SDK) |
| QA agent | `pr-review-graph-bot` | working (LangGraph, 3 parallel reviewers) |
| Trust/eval layer | `agent-evals` | design done, no code yet |

Nothing currently stitches these together end to end. Every deck
(`how-we-build-ai-solutions`, `Excality - product engineering approach`)
shows a pipeline diagram like:

```
Analyst agent → Product agent → Architecture agent → Planning agent
  ↓ hands off a validated plan to delivery
Sprint-level agents → Development agents → QA agents
```

`idea-to-mvp` is that diagram, running, using the real repos above wherever
they already exist, with thin stand-ins where they don't yet.

## Source material

The sales narrative this repo needs to dramatize lives in:
`/Users/oleksandr.zinevych/Documents/excality_documents/` — four PDFs:
`how-we-build-ai-solutions_3.pdf`, `AI Prototyping Accelerator - Excality.pdf`,
`From vibe-coded to production-ready - Excality.pdf`,
`Excality - product engineering approach.pdf`. Read these first; they're the
spec for what the demo needs to look like from the outside.

## Proposed shape (starting point for brainstorming, not a decision)

- A CLI or small orchestrator that takes one input (a short idea/requirement
  doc) and drives it through: discovery/analysis → architecture/plan →
  a GitHub issue → `do-ex`'s issue-worker → a PR → `pr-review-graph-bot`'s
  review → a final summary artifact (the "handoff" a client would see).
- Each stage should be swappable/stubbable — `architecture-builder` doesn't
  exist yet, so the first version may need a minimal planning step built
  inline, with a note that it should be extracted once `architecture-builder`
  is real.
- Should produce a recordable, narratable demo run (this is sales collateral
  first, general-purpose pipeline tool second) — optimize for "watch this
  happen in one terminal" over configurability.
- Consider whether `agent-evals` should gate this pipeline's own output
  quality once it exists, the same way it will gate `discovery-agent`.

## Open questions for the brainstorming session

- What's the actual input format? A one-paragraph idea? A requirements doc?
  Should match what the "Discovery & prototype" step of the decks implies.
- Does this run against a toy/demo target repo, or scaffold a brand-new repo
  each time?
- Where does `architecture-builder`'s absence get stubbed vs. built for real
  as part of this effort (there's an argument this repo is what finally
  forces `architecture-builder` to get built)?
- Naming: `idea-to-mvp` vs `pipeline-demo` vs something that fits the
  existing `-agent`/`-builder`/`-bot` naming convention.
- Does this belong in `.github/profile/README.md`'s public repo table once
  it exists?

## Conventions to follow (matching the rest of Excality-Hub)

- Spec-first: brainstorm → `docs/superpowers/specs/<date>-<name>-design.md` →
  `docs/superpowers/plans/<date>-<name>-*.md` → build.
- TypeScript / Node 20+ / npm / Vitest, matching `discovery-agent`, `do-ex`,
  `pr-review-graph-bot`, `agent-evals`.
- Public GitHub repo under `Excality-Hub`, README leads with input → output,
  like the org profile table does for each existing repo.
