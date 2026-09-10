# idea-to-mvp

Takes a short idea/brief typed into its dashboard and drives it through
Analyst, Architect, Developer, and QA `claude -p` agents, ending with a
merged, reviewed pull request deployed live to Render or Cloudflare
Workers, depending on `DEPLOY_TARGET`. See
`docs/superpowers/specs/2026-09-06-idea-to-mvp-design.md` for the full
design.

## Setup

1. `npm install` (backend) and `npm install --prefix web` (dashboard UI).
2. Copy `.env.example` to `.env` and fill in the values (see table below).
3. Ensure the `claude` CLI is installed and logged in on this machine —
   idea-to-mvp shells out to `claude -p` for the Analyst, Architect,
   Developer, and QA stages; no Anthropic API key is configured by this
   repo itself.
4. `npm run build` — compiles the backend and builds the dashboard UI
   (`web/dist`), which the dashboard server serves statically.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes | Create the app repo, issue, PR, comment, and merge |
| `TARGET_GITHUB_OWNER` | yes | GitHub **organization** new demo repos are created under — use a sandbox org, not a real portfolio org |
| `DEPLOY_TARGET` | no (default `render`) | `render` or `cloudflare` — which deploy stage/starter template the run uses |
| `RENDER_API_KEY` | only if `DEPLOY_TARGET=render` | Create and deploy the Render service |
| `RENDER_OWNER_ID` | only if `DEPLOY_TARGET=render` | Render workspace to create the service under (the `owner.id` from `GET https://api.render.com/v1/owners`, e.g. `usr-...`/`tea-...`) |
| `CLOUDFLARE_API_TOKEN` | only if `DEPLOY_TARGET=cloudflare` | Upload the Worker script and enable its `workers.dev` subdomain (needs Workers Scripts:Edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | only if `DEPLOY_TARGET=cloudflare` | Cloudflare account the Worker is deployed under |
| `PORT` | no (default 3000) | Local dashboard HTTP port |
| `CLAUDE_CLI_COMMAND` | no (default `claude`) | Which CLI binary to spawn for the Analyst/Architect/Developer/QA agents — set this if you invoke Claude Code under a different command (e.g. a separate profile like `claude-personal`) |

## Manual demo

1. Run it: `node dist/cli.js` (or `npm run dev`).
2. A browser tab opens automatically at `http://localhost:3000` showing
   the Workflows dashboard, idle and waiting for input.
3. Type your idea and its requirements into the "Idea & requirements"
   box, e.g. `Build a small todo app: users can add a task and mark it
   done.`, and click "Start run".
4. Each of the 10 pipeline stages lights up live as a card as it runs.
   Click any stage to open its full event log (timestamps + messages,
   including links to the GitHub repo, issue, and PR as they're created).
5. The run ends either on a live URL (QA passed, on whichever target
   `DEPLOY_TARGET` selected) or a "blocked"
   state linking to the PR (QA found a critical issue). From there,
   "Start a new run" submits another idea in the same session.

Custom agents and workflows you create are persisted to `data/agents.json`
and `data/workflows.json` (gitignored) via `POST /api/agents` and
`POST /api/workflows` — see `docs/superpowers/specs/2026-09-10-configurable-agents-design.md`.
There is no dashboard UI for authoring them yet; use the API directly, e.g.:

```bash
curl -X POST localhost:3000/api/agents -H 'Content-Type: application/json' \
  -d '{"name":"Security Reviewer","instructions":"Look for auth bypass and injection issues.","repoAccess":true}'
```

### Iterating on the dashboard UI

The dashboard is a React + TypeScript + shadcn/ui app in `web/`. For a
fast edit-reload loop against a real run's event stream, run the backend
(`npm run dev`) and, in a second terminal, `npm run dev --prefix web` —
Vite proxies `/events` to the backend on `:3000` and serves the UI with
HMR on `:5173`.

## Testing

`npm test` runs the unit test suite (Vitest). All `claude -p`, GitHub,
and Render/Cloudflare calls are mocked — there is no end-to-end test against real
APIs or the real `claude` CLI; verify those manually via the demo above.

## Known limitations

Neither the Render deployment polling/payload shapes nor the Cloudflare Workers script-upload payload shapes have been verified against their live APIs — all testing uses mocked HTTP calls. Before running this on a production demo, confirm these details match the real Render API contract. The `claude -p` agent invocations use an `--allowedTools` flag format that may vary depending on your installed `claude` CLI version; verify it matches your CLI's expected syntax. Finally, the QA agent's `verdict` field is advisory information only. Deployment is gated exclusively by finding severity: a `critical` severity finding always blocks deployment regardless of `verdict`, and all other findings allow deployment regardless of `verdict`. This is an intentional design simplification. The Cloudflare Workers deploy path only uploads a single file (`src/index.js`) — a generated app that spans multiple files/modules will not deploy correctly; the Architect agent is instructed to keep everything in that one file, but this is not enforced.

## Scope

This is a demo, not a production pipeline:
- Every run scaffolds a brand-new app from the bundled starter template
  for the active `DEPLOY_TARGET` (Node/Express for Render, a Workers
  `fetch` handler for Cloudflare) — it does not extend an existing app.
- No retries on any stage failure — a failed stage halts the run and is
  shown in the dashboard.
- Run state is in-memory only — no persistence across restarts, no
  run-history list.
- QA only blocks deploy on `critical`-severity findings; everything else
  is advisory.
