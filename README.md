# idea-to-mvp

Takes a short idea/brief in Markdown and drives it through Analyst,
Architect, Developer, and QA `claude -p` agents, ending with a merged,
reviewed pull request deployed live on Render. See
`docs/superpowers/specs/2026-09-06-idea-to-mvp-design.md` for the full
design.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see table below).
3. Ensure the `claude` CLI is installed and logged in on this machine —
   idea-to-mvp shells out to `claude -p` for the Analyst, Architect,
   Developer, and QA stages; no Anthropic API key is configured by this
   repo itself.
4. `npm run build`

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes | Create the app repo, issue, PR, comment, and merge |
| `TARGET_GITHUB_OWNER` | yes | GitHub **organization** new demo repos are created under — use a sandbox org, not a real portfolio org |
| `RENDER_API_KEY` | yes | Create and deploy the Render service |
| `PORT` | no (default 3000) | Local dashboard HTTP port |

## Manual demo

1. Write a short idea, e.g. `idea.md`:
   ```md
   Build a small todo app: users can add a task and mark it done.
   ```
2. Run it: `node dist/cli.js run ./idea.md` (or `npm run dev -- run ./idea.md`).
3. A browser tab opens automatically at `http://localhost:3000` showing
   each stage light up as it runs, with links to the GitHub repo, issue,
   and PR as they're created.
4. The run ends either on a live Render URL (QA passed) or a "blocked"
   state linking to the PR (QA found a critical issue).

## Testing

`npm test` runs the unit test suite (Vitest). All `claude -p`, GitHub,
and Render calls are mocked — there is no end-to-end test against real
APIs or the real `claude` CLI; verify those manually via the demo above.

## Known limitations

The Render deployment polling and payload shapes have not been verified against a live Render API — all testing uses mocked HTTP calls. Before running this on a production demo, confirm these details match the real Render API contract. The `claude -p` agent invocations use an `--allowedTools` flag format that may vary depending on your installed `claude` CLI version; verify it matches your CLI's expected syntax. Finally, the QA agent's `verdict` field is advisory information only. Deployment is gated exclusively by finding severity: a `critical` severity finding always blocks deployment regardless of `verdict`, and all other findings allow deployment regardless of `verdict`. This is an intentional design simplification.

## Scope

This is a demo, not a production pipeline:
- Every run scaffolds a brand-new app from the bundled Node/Express
  starter template — it does not extend an existing app.
- No retries on any stage failure — a failed stage halts the run and is
  shown in the dashboard.
- Run state is in-memory only — no persistence across restarts, no
  run-history list.
- QA only blocks deploy on `critical`-severity findings; everything else
  is advisory.
