# Cloudflare deploy target: design

Status: proposed.

## One-liner

Add Cloudflare Workers as a second, selectable deploy target alongside
Render, chosen via a `DEPLOY_TARGET` env var, behind a shared
`DeployClient` interface — with its own Workers-native starter
template, since a generated app can't be both an Express server and a
Workers `fetch()` handler.

## Why

Render's API now returns `402 Payment information is required` when
creating a service, even within free-tier limits. The user does not
want to add a card to Render (card-on-file carries real risk of
surprise overage charges, and Render's free-tier policy has already
shifted once). Cloudflare Workers' free plan requires no payment
method at all. The user wants Cloudflare available as a deploy option
without giving up Render (e.g. for other projects/accounts where
Render already works).

## Non-goals

- No removal of Render or `RenderClient` — both targets are kept and
  selected via config, per user decision.
- No git-integration deploy for Cloudflare (Cloudflare's GitHub-connected
  "Workers Builds" requires an interactive GitHub App install through
  the Cloudflare dashboard; it isn't scriptable with just an API
  token). Instead the Cloudflare path uploads the built script directly
  via the Workers script-upload API, using the already-cloned local
  working directory.
- No changes to the Developer agent. It isn't hardcoded to Express or
  any app shape — it edits whatever files exist in the checkout — so
  swapping starter templates needs no prompt changes.
- No support for switching `DEPLOY_TARGET` mid-run. It's read once at
  startup (`cli.ts`) and fixes both which starter template `create_repo`
  uses and which client `deploy` uses for the whole run.
- No custom domains, KV/D1/R2 bindings, or other Workers platform
  features for the generated app — just the minimal script upload +
  `workers.dev` subdomain needed to get a live URL, mirroring what
  Render's `RenderClient` does today (create + wait for a URL).

## Architecture

```
Config (src/config.ts)
   DEPLOY_TARGET=render|cloudflare  (default "render")
   validates only the env vars that target needs
        │
        ▼
cli.ts
   picks starterDir:  templates/starter-render | templates/starter-cloudflare
   picks deploy client: RenderClient | CloudflareClient
        │
        ▼
DeployClient (src/deploy/types.ts) — shared interface
   RenderClient   (src/deploy/render.ts, wrapped)      label "Render"
   CloudflareClient (src/deploy/cloudflare.ts, new)    label "Cloudflare Workers"
        │
        ▼
runOrchestrator's "deploy" stage
   deps.deploy.deploy({ name, repoUrl, branch, workDir }) → { url }
   event message uses deps.deploy.label instead of a hardcoded string
```

## Components

### `DeployClient` interface (`src/deploy/types.ts`, new)

```ts
export interface DeployParams {
  name: string;
  repoUrl: string;
  branch: string;
  workDir: string;
}
export interface DeployResult {
  url: string;
}
export interface DeployClient {
  readonly label: string;
  deploy(params: DeployParams): Promise<DeployResult>;
}
```

`workDir` is included because Cloudflare's client needs to read a local
file; `repoUrl`/`branch` stay because Render's client still needs them.
Each client uses only the fields it needs.

### `RenderClient` (`src/deploy/render.ts`, changed)

Keeps `createService`/`waitForLive` as internal methods (or inlines
them into `deploy`), and gains:

```ts
readonly label = "Render";
async deploy(params: DeployParams): Promise<DeployResult> {
  const service = await this.createService({ name: params.name, repoUrl: params.repoUrl, branch: params.branch });
  return this.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
}
```

No behavior change to the existing Render API calls — this is a thin
wrapper so it satisfies `DeployClient`.

### `CloudflareClient` (`src/deploy/cloudflare.ts`, new)

```ts
export class CloudflareClient implements DeployClient {
  readonly label = "Cloudflare Workers";
  constructor(private apiToken: string, private accountId: string, private fetchImpl: typeof fetch = fetch) {}

  async deploy(params: DeployParams): Promise<DeployResult> {
    const scriptContent = readFileSync(join(params.workDir, "src/index.js"), "utf-8");
    await this.uploadScript(params.name, scriptContent);
    await this.enableSubdomain(params.name);
    const subdomain = await this.getAccountSubdomain();
    return { url: `https://${params.name}.${subdomain}.workers.dev` };
  }
  // private uploadScript / enableSubdomain / getAccountSubdomain each
  // call https://api.cloudflare.com/client/v4/accounts/{accountId}/workers/...
  // with Authorization: Bearer {apiToken}
}
```

- `uploadScript`: `PUT /accounts/{accountId}/workers/scripts/{name}` —
  multipart body with a metadata part (`{"main_module": "index.js", "compatibility_date": "2026-01-01"}`)
  and the script content part.
- `enableSubdomain`: `PUT /accounts/{accountId}/workers/scripts/{name}/subdomain` `{"enabled": true}`.
- `getAccountSubdomain`: `GET /accounts/{accountId}/workers/subdomain` → `{"subdomain": "..."}`.
- Each throws with the same `"<Action> failed: <status> <body>"` shape
  `RenderClient` uses today, for consistent error messages/tracing.

### Starter templates (`templates/starter-render/`, `templates/starter-cloudflare/`)

- `templates/starter-render/` — today's `templates/starter/` contents,
  moved as-is (Express `server.js`, `package.json` with `express`
  dependency, `npm start`).
- `templates/starter-cloudflare/` — new, minimal Workers app:
  - `src/index.js`: `export default { async fetch(request) { return new Response("Hello from idea-to-mvp"); } }`
  - `wrangler.toml`: `name`, `main = "src/index.js"`, `compatibility_date`.
  - `package.json`: no `express` dependency; `wrangler` as a dev
    dependency for local `wrangler dev` iteration (not used by the
    deploy stage itself, which uploads directly via the API).
  - `README.md`: adapted from the Render starter's README.

### Config (`src/config.ts`, changed)

```ts
export interface Config {
  githubToken: string;
  targetGithubOwner: string;
  deployTarget: "render" | "cloudflare";
  renderApiKey?: string;
  renderOwnerId?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
  port: number;
}
```

`loadConfig` reads `DEPLOY_TARGET` (default `"render"`), then validates
only the pair that target needs:
- `"render"` → requires `RENDER_API_KEY`, `RENDER_OWNER_ID`.
- `"cloudflare"` → requires `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

`.env.example` lists all four deploy-related vars plus `DEPLOY_TARGET=`,
each commented as belonging to one target.

### Wiring (`src/cli.ts`, changed)

```ts
const starterDir = config.deployTarget === "cloudflare"
  ? fileURLToPath(new URL("../templates/starter-cloudflare", import.meta.url))
  : fileURLToPath(new URL("../templates/starter-render", import.meta.url));

const deployClient: DeployClient = config.deployTarget === "cloudflare"
  ? new CloudflareClient(config.cloudflareApiToken!, config.cloudflareAccountId!)
  : new RenderClient(config.renderApiKey!, config.renderOwnerId!);
```

`RunController`'s `deps.render` → `deps.deploy: DeployClient`.

### `runOrchestrator.ts` (changed)

- `OrchestratorDeps.render: RenderClient` → `deploy: DeployClient`.
- Deploy stage:
  ```ts
  deps.eventBus.emit(stageEvent("deploy", "running", `Deploying to ${deps.deploy.label}`, { input: ctx.pendingInput }));
  const live = await deps.deploy.deploy({ name: params.repoName, repoUrl: ctx.repo!.htmlUrl, branch: BASE_BRANCH, workDir: params.workDir });
  ```
  (`params.workDir` already exists on `OrchestratorParams` today — no
  new plumbing needed to reach it.)

## Error handling / edge cases

- Cloudflare API errors (bad token, missing account access, script
  upload rejected) throw the same way Render's client does today —
  caught by the existing stage failure handling in `runOrchestrator`,
  producing a `failed` outcome at the `deploy` stage. No new error path.
- If `DEPLOY_TARGET` is set to anything other than `"render"` or
  `"cloudflare"`, `loadConfig` throws
  `DEPLOY_TARGET must be "render" or "cloudflare"`.
- The Cloudflare starter's entry path is fixed at `src/index.js`; if the
  Developer agent renames or moves it, `CloudflareClient.deploy` will
  fail to read the file and surface a clear `ENOENT`-derived error —
  acceptable for now (same class of risk as Render depending on
  `package.json`'s `start` script staying intact).

## Testing

- `src/deploy/cloudflare.test.ts` (new): mocked `fetch`, mirroring
  `render.test.ts`'s style — successful `deploy()` resolving the
  `workers.dev` URL, and each of the three calls (`uploadScript`,
  `enableSubdomain`, `getAccountSubdomain`) throwing on a non-ok
  response.
- `src/deploy/render.test.ts` (changed): update/add a case for the new
  `deploy()` wrapper method alongside the existing `createService`/
  `waitForLive` cases.
- `src/config.test.ts` (changed): `DEPLOY_TARGET=render` requires
  Render vars and not Cloudflare vars (and vice versa); default target
  is `"render"`; invalid `DEPLOY_TARGET` throws.
- `src/orchestrator/runOrchestrator.test.ts` (changed): deploy stage
  test(s) updated to use a fake `DeployClient` instead of a fake
  `RenderClient`.

## File layout (new/changed)

```
src/deploy/types.ts                 new: DeployParams/DeployResult/DeployClient
src/deploy/cloudflare.ts            new: CloudflareClient
src/deploy/cloudflare.test.ts       new
src/deploy/render.ts                + deploy() wrapper, label, implements DeployClient
src/deploy/render.test.ts           + deploy() case
src/config.ts                       + deployTarget, conditional validation
src/config.test.ts                  + deployTarget cases
.env.example                        + DEPLOY_TARGET, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
src/cli.ts                          picks starterDir + deploy client by config.deployTarget
src/orchestrator/runOrchestrator.ts deps.render → deps.deploy: DeployClient
src/orchestrator/runOrchestrator.test.ts  fake DeployClient instead of fake RenderClient
templates/starter/                  renamed → templates/starter-render/
templates/starter-cloudflare/       new: index.js, wrangler.toml, package.json, README.md
README.md                           document DEPLOY_TARGET + both env var sets
```

## Dev workflow

Unchanged — `npm test` for the backend Vitest suite. No frontend
changes (deploy target is a server-side/env concern, not surfaced in
the dashboard UI beyond the existing `deps.deploy.label`-driven event
message).
