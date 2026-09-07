# Dashboard UI: design

Status: approved and implemented.

## One-liner

Replace the bare `<ul>` dashboard with a React + TypeScript + shadcn/ui
web app — a header, a sidebar with a "Workflows" section, and a live view
of the 10 pipeline stages as status cards that expand into a full event
log per stage — styled with a palette and typography lifted from
excality.com's own published CSS.

## Why

The existing dashboard (`public/index.html` + `public/dashboard.js`) is
functional but minimal: an unstyled list that replaces its own text node
per stage, discarding everything but the latest message. It communicates
"a pipeline is running" but not "what is happening inside stage N right
now," and doesn't look like anything Excality would put in front of a
prospect. This redesign keeps the same data source (the existing SSE
`/events` endpoint) and makes the dashboard itself demo-worthy: on-brand,
and able to answer "what did the developer stage actually do?" without
leaving the page.

## Non-goals

- No run-history list or persistence — matches the existing "Known
  limitations" in the README (in-memory, single run per process).
- No new backend endpoints or event-shape changes. `RunEvent` /
  `StageName` / `StageStatus` (`src/orchestrator/types.ts`) are unchanged;
  the dashboard server only serves a different static directory.
- No routing — "Workflows" is the only real page; "Runs history" and
  "Settings" are visible-but-disabled sidebar placeholders, not routes.
- No pixel-for-pixel clone of excality.com — only its design *tokens*
  (palette, type, radius, shadow conventions) are reused, scraped from the
  site's own shipped CSS (`_astro/*.css`), not its layout or copy.

## Architecture

```
src/orchestrator/*  (unchanged)
        │  RunEvent { stage, status, message, timestamp }
        ▼
RunEventBus.onEvent()  (unchanged — replays history, then live)
        │
        ▼
src/dashboard/server.ts
   express.static(web/dist)  ← was public/
   GET /events  (SSE, unchanged)
        │
        ▼
web/  (new: Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui)
   useRunEvents() ── new EventSource("/events")
        │             accumulates RunEvent[] client-side
        ▼
   runEvents.ts (pure functions, unit-tested)
        groupEventsByStage, deriveStageStatus, deriveOverallStatus
        ▼
   App → Header + Sidebar + WorkflowsView
                                 └─ StageCard × 10 → StageDetailSheet
```

The backend is untouched except for `server.ts`'s static-file root
(`../../public` → `../../web/dist`) and `package.json`'s `build` script
now also running `npm run build --prefix web`. The two toolchains stay
isolated: root `tsconfig.json`/`vitest.config.ts` are scoped to `src/**`
and never see `web/`; `web/` has its own `tsconfig*.json`,
`vite.config.ts`, and `vitest.config.ts`.

## Design tokens

Pulled from excality.com's own shipped CSS
(`_astro/adopt-ai.*.css`) rather than guessed:

| Token | Value | Source |
|---|---|---|
| Background | `#f7f9fa` | `body{background-color:...}` |
| Foreground | `#1f2933` | `body{color:...}` |
| Body font | Inter | `font-family:Inter,system-ui,...` |
| Mono font (log panel) | JetBrains Mono | `font-family:JetBrains Mono,Fira Code,monospace` |
| Accent / primary | `#149180` → `#60ddcc` (teal scale) | gradient stops across the site |
| Secondary / sidebar | `#102a43` → `#f0f4f8` (navy/steel scale) | gradient stops across the site |
| Radius | `.75rem`–`1.5rem` (`rounded-xl`/`2xl`/`3xl`) | Tailwind utility classes present in the CSS |

"Cal Sans" (the site's heading font) isn't available without a license, so
headings fall back to Inter at a heavier weight — noted as an intentional
simplification, not an oversight.

Implemented as shadcn/ui's standard CSS-variable theme contract
(`--background`, `--primary`, `--sidebar`, etc. in `web/src/index.css`),
so any future shadcn component picks up the palette automatically. A dark
variant is defined for parity with shadcn's `.dark` convention, though the
app doesn't currently expose a theme toggle.

## Components

- **`Header`** — branding + a live overall-status `Badge` (Idle / Running
  / Deployed / Blocked / Failed), derived from all events, not a single
  stage.
- **`Sidebar`** — "Workflows" (active, teal highlight) plus disabled
  "Runs history" / "Settings" rows carrying a "Soon" badge — signals
  future scope without building unreachable pages.
- **`WorkflowsView`** — maps the fixed 10-stage `STAGE_ORDER` to
  `StageCard`s; owns which stage is selected for the detail sheet.
- **`StageCard`** — one row per stage: status icon (pending / spinning
  running / done check / failed / blocked shield), label, latest message.
  Click opens the detail sheet for that stage.
- **`StageDetailSheet`** (shadcn `Sheet`, right slide-over) — every event
  recorded for the selected stage, chronological, monospace, timestamp +
  status + message. Stays live: re-renders as new events for the open
  stage arrive, since it reads from the same `eventsByStage` state as the
  list.

## Data flow / state

`useRunEvents()` is the only stateful piece: one `EventSource("/events")`
subscription, appending every message to a `RunEvent[]`. Because the
existing `RunEventBus.onEvent()` replays its full history to new
subscribers before switching to live delivery, a browser tab opened
mid-run reconstructs the complete per-stage timeline for free — no change
needed there.

Derivation is pure and separated from the hook so it's unit-testable
without a DOM or a fake `EventSource`:

- `groupEventsByStage(events)` → `Partial<Record<StageName, RunEvent[]>>`
- `deriveStageStatus(events)` → `"pending"` (no events) or the last
  event's status
- `deriveOverallStatus(eventsByStage)` → `idle` (nothing yet) → `running`
  → `failed` (any stage failed, takes priority) / `blocked` (merge
  blocked) / `deployed` (deploy done)

## Testing

- **Unit (TDD'd first):** `web/src/lib/runEvents.test.ts` — grouping and
  both status-derivation functions, including the "failed takes priority
  over a later deploy event" edge case.
- **Component:** `web/src/components/WorkflowsView.test.tsx` (Vitest +
  React Testing Library) — all 10 stage cards render, clicking a stage
  opens its sheet with its full log, and a stage with no events shows the
  empty/pending state.
- **Manual/visual:** the dashboard server was booted against a fake
  `RunEventBus` emitting a realistic event sequence and driven with a
  headless browser (Playwright) to confirm the actual rendered layout,
  live updates, and the slide-over interaction — unit tests alone don't
  catch a broken Tailwind build or an unreachable sheet.
- Root `vitest.config.ts` is scoped to `src/**/*.test.ts` so `npm test`
  (backend) and `npm run test:web` (frontend) stay independent suites —
  they were unintentionally merged before this fix, breaking on
  `web/`'s JSX/alias resolution.

## File layout (new/changed)

```
web/                          new: Vite + React + TS + Tailwind + shadcn
  src/types.ts                 mirrors src/orchestrator/types.ts (plain duplicate)
  src/lib/runEvents.ts          pure event-derivation logic
  src/hooks/useRunEvents.ts     EventSource subscription
  src/components/{Header,Sidebar,WorkflowsView,StageCard,StageDetailSheet,status}.tsx
  src/components/ui/*           shadcn-generated primitives (badge, card, sheet, ...)
src/dashboard/server.ts       static root: web/dist (was public/)
public/                       removed (superseded by web/dist)
package.json                  build now also builds web/; new test:web script
vitest.config.ts              scoped to src/**/*.test.ts
```

## Dev workflow

`npm run dev -- run ./idea.md` (backend) serves the built `web/dist` as
before — no HMR in that path, matching this repo's existing "run the CLI
demo" flow. For iterating on the UI itself, `npm run dev --prefix web`
runs Vite with HMR on `:5173`, proxying `/events` to a backend on `:3000`
(configured in `web/vite.config.ts`).
