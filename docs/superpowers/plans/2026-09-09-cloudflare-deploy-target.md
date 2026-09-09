# Cloudflare Deploy Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Workers as a second, config-selectable deploy target alongside Render, without removing Render.

**Architecture:** Introduce a shared `DeployClient` interface (`src/deploy/types.ts`) that both `RenderClient` and a new `CloudflareClient` implement. `runOrchestrator`'s deploy stage calls the interface generically (`deps.deploy.deploy(...)`, `deps.deploy.label`). `config.ts` reads a new `DEPLOY_TARGET` env var and validates only the credential pair that target needs. `cli.ts` picks the starter template directory and deploy client based on `config.deployTarget`.

**Tech Stack:** TypeScript (Node, `NodeNext` modules), Vitest, global `fetch`/`FormData`/`Blob` (Node 18+ / `@types/node`).

**Spec:** `docs/superpowers/specs/2026-09-09-cloudflare-deploy-target-design.md`

## Global Constraints

- `DEPLOY_TARGET` env var: `"render"` (default) or `"cloudflare"` — any other value throws `DEPLOY_TARGET must be "render" or "cloudflare"`.
- Only the credential pair for the active target is required: `RENDER_API_KEY`/`RENDER_OWNER_ID` for `"render"`, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for `"cloudflare"`.
- No git-integration deploy for Cloudflare — the Cloudflare client uploads the built script directly via the Workers script-upload API using the local `workDir`, it does not use Cloudflare's GitHub-connected Workers Builds.
- No changes to the Developer agent (`src/agents/developer.ts`) — out of scope per spec.
- Error message format for both deploy clients: `"<Action> failed: <status> <body>"` (matches existing `RenderClient` convention).

---

### Task 1: `DeployClient` shared interface

**Files:**
- Create: `src/deploy/types.ts`

**Interfaces:**
- Produces: `DeployParams { name: string; repoUrl: string; branch: string; workDir: string }`, `DeployResult { url: string }`, `DeployClient { readonly label: string; deploy(params: DeployParams): Promise<DeployResult> }` — every later task imports these from `src/deploy/types.js`.

- [ ] **Step 1: Create the interface file**

```ts
// src/deploy/types.ts
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

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this file has no consumers yet, so it just needs to parse cleanly).

- [ ] **Step 3: Commit**

```bash
git add src/deploy/types.ts
git commit -m "$(cat <<'EOF'
feat: add shared DeployClient interface

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

### Task 2: `RenderClient` implements `DeployClient`

**Files:**
- Modify: `src/deploy/render.ts`
- Test: `src/deploy/render.test.ts`

**Interfaces:**
- Consumes: `DeployParams`/`DeployResult`/`DeployClient` from Task 1 (`src/deploy/types.js`).
- Produces: `RenderClient.label = "Render"`, `RenderClient.deploy(params: DeployParams): Promise<DeployResult>` — Task 6 (`runOrchestrator.ts`) and Task 7 (`cli.ts`) call this generically.

- [ ] **Step 1: Write the failing test**

Add to `src/deploy/render.test.ts` (after the existing `waitForLive` tests, before the closing `});`):

```ts
  it("deploy creates a service, waits for it to be live, and returns its url", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ service: { id: "srv-1" } }))
      .mockResolvedValueOnce(jsonResponse({ service: { serviceDetails: { url: "https://app.onrender.com" } } }));
    const client = new RenderClient("key-1", "owner-1", fetchImpl);

    const result = await client.deploy({
      name: "app",
      repoUrl: "https://github.com/org/app",
      branch: "main",
      workDir: "/tmp/work",
    });

    expect(result).toEqual({ url: "https://app.onrender.com" });
    expect(client.label).toBe("Render");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/deploy/render.test.ts`
Expected: FAIL — `client.deploy is not a function`.

- [ ] **Step 3: Implement `deploy()` and `label`**

In `src/deploy/render.ts`, add the import and the two new members to the class (the existing `createService`/`waitForLive` methods are unchanged):

```ts
import type { DeployClient, DeployParams, DeployResult } from "./types.js";

export class RenderClient implements DeployClient {
  readonly label = "Render";

  constructor(
    private apiKey: string,
    private ownerId: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async deploy(params: DeployParams): Promise<DeployResult> {
    const service = await this.createService({
      name: params.name,
      repoUrl: params.repoUrl,
      branch: params.branch,
    });
    return this.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
  }

  async createService(params: { name: string; repoUrl: string; branch: string }): Promise<{ serviceId: string }> {
    // ...unchanged...
```

(Only the class declaration line, the new `readonly label`, and the new `deploy` method are additions — leave the existing `createService`/`waitForLive` bodies exactly as they are today.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/deploy/render.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/deploy/render.ts src/deploy/render.test.ts
git commit -m "$(cat <<'EOF'
feat: make RenderClient implement DeployClient

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

### Task 3: `CloudflareClient`

**Files:**
- Create: `src/deploy/cloudflare.ts`
- Test: `src/deploy/cloudflare.test.ts`

**Interfaces:**
- Consumes: `DeployParams`/`DeployResult`/`DeployClient` from Task 1 (`src/deploy/types.js`).
- Produces: `CloudflareClient` (constructor `(apiToken: string, accountId: string, fetchImpl?: typeof fetch)`), `.label = "Cloudflare Workers"`, `.deploy(params: DeployParams): Promise<DeployResult>` — Task 7 (`cli.ts`) instantiates this.

- [ ] **Step 1: Write the failing test**

```ts
// src/deploy/cloudflare.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "./cloudflare.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeWorkDir(scriptContent = "export default { fetch() {} };"): string {
  const workDir = mkdtempSync(join(tmpdir(), "cloudflare-client-test-"));
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/index.js"), scriptContent);
  return workDir;
}

describe("CloudflareClient", () => {
  let workDir: string;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("deploy uploads the script, enables the subdomain, and returns the workers.dev URL", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { id: "app" } }))
      .mockResolvedValueOnce(jsonResponse({ result: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ result: { subdomain: "my-subdomain" } }));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    const result = await client.deploy({
      name: "app",
      repoUrl: "https://github.com/org/app",
      branch: "main",
      workDir,
    });

    expect(result).toEqual({ url: "https://app.my-subdomain.workers.dev" });
    expect(client.label).toBe("Cloudflare Workers");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [uploadUrl, uploadInit] = fetchImpl.mock.calls[0];
    expect(uploadUrl).toBe("https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts/app");
    expect(uploadInit.method).toBe("PUT");
    expect(uploadInit.headers.Authorization).toBe("Bearer token-1");
  });

  it("deploy throws when the script upload fails", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "bad request" }, false, 400));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    await expect(
      client.deploy({ name: "app", repoUrl: "https://github.com/org/app", branch: "main", workDir }),
    ).rejects.toThrow("Cloudflare uploadScript failed: 400");
  });

  it("deploy throws when enabling the subdomain fails", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { id: "app" } }))
      .mockResolvedValueOnce(jsonResponse({ message: "bad request" }, false, 400));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    await expect(
      client.deploy({ name: "app", repoUrl: "https://github.com/org/app", branch: "main", workDir }),
    ).rejects.toThrow("Cloudflare enableSubdomain failed: 400");
  });

  it("deploy throws when fetching the account subdomain fails", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { id: "app" } }))
      .mockResolvedValueOnce(jsonResponse({ result: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ message: "bad request" }, false, 400));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    await expect(
      client.deploy({ name: "app", repoUrl: "https://github.com/org/app", branch: "main", workDir }),
    ).rejects.toThrow("Cloudflare getAccountSubdomain failed: 400");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/deploy/cloudflare.test.ts`
Expected: FAIL — cannot find module `./cloudflare.js`.

- [ ] **Step 3: Implement `CloudflareClient`**

```ts
// src/deploy/cloudflare.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeployClient, DeployParams, DeployResult } from "./types.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareClient implements DeployClient {
  readonly label = "Cloudflare Workers";

  constructor(
    private apiToken: string,
    private accountId: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async deploy(params: DeployParams): Promise<DeployResult> {
    const scriptContent = readFileSync(join(params.workDir, "src/index.js"), "utf-8");
    await this.uploadScript(params.name, scriptContent);
    await this.enableSubdomain(params.name);
    const subdomain = await this.getAccountSubdomain();
    return { url: `https://${params.name}.${subdomain}.workers.dev` };
  }

  private async uploadScript(name: string, scriptContent: string): Promise<void> {
    const metadata = { main_module: "index.js", compatibility_date: "2026-01-01" };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("index.js", new Blob([scriptContent], { type: "application/javascript+module" }), "index.js");

    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}/workers/scripts/${name}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.apiToken}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Cloudflare uploadScript failed: ${res.status} ${await res.text()}`);
    }
  }

  private async enableSubdomain(name: string): Promise<void> {
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}/workers/scripts/${name}/subdomain`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare enableSubdomain failed: ${res.status} ${await res.text()}`);
    }
  }

  private async getAccountSubdomain(): Promise<string> {
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Cloudflare getAccountSubdomain failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { result: { subdomain: string } };
    return data.result.subdomain;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/deploy/cloudflare.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/deploy/cloudflare.ts src/deploy/cloudflare.test.ts
git commit -m "$(cat <<'EOF'
feat: add CloudflareClient deploy client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

### Task 4: `config.ts` — `DEPLOY_TARGET` + conditional validation

**Files:**
- Modify: `src/config.ts`
- Test: `src/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `Config.deployTarget: "render" | "cloudflare"`, `Config.renderApiKey?`, `Config.renderOwnerId?`, `Config.cloudflareApiToken?`, `Config.cloudflareAccountId?` — Task 7 (`cli.ts`) reads these.

- [ ] **Step 1: Write the failing tests**

Replace `src/config.test.ts` entirely with:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const renderEnv = {
  GITHUB_TOKEN: "gh-token",
  TARGET_GITHUB_OWNER: "excality-sandbox",
  RENDER_API_KEY: "render-key",
  RENDER_OWNER_ID: "owner-id",
};

const cloudflareEnv = {
  GITHUB_TOKEN: "gh-token",
  TARGET_GITHUB_OWNER: "excality-sandbox",
  DEPLOY_TARGET: "cloudflare",
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_ACCOUNT_ID: "cf-account",
};

describe("loadConfig", () => {
  it("defaults DEPLOY_TARGET to render and returns a config object from valid render env vars", () => {
    expect(loadConfig(renderEnv)).toEqual({
      githubToken: "gh-token",
      targetGithubOwner: "excality-sandbox",
      deployTarget: "render",
      renderApiKey: "render-key",
      renderOwnerId: "owner-id",
      cloudflareApiToken: undefined,
      cloudflareAccountId: undefined,
      port: 3000,
    });
  });

  it("returns a config object from valid cloudflare env vars", () => {
    expect(loadConfig(cloudflareEnv)).toEqual({
      githubToken: "gh-token",
      targetGithubOwner: "excality-sandbox",
      deployTarget: "cloudflare",
      renderApiKey: undefined,
      renderOwnerId: undefined,
      cloudflareApiToken: "cf-token",
      cloudflareAccountId: "cf-account",
      port: 3000,
    });
  });

  it("uses PORT from env when provided", () => {
    expect(loadConfig({ ...renderEnv, PORT: "4000" }).port).toBe(4000);
  });

  it("throws if GITHUB_TOKEN is missing", () => {
    const { GITHUB_TOKEN, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("GITHUB_TOKEN is required");
  });

  it("throws if TARGET_GITHUB_OWNER is missing", () => {
    const { TARGET_GITHUB_OWNER, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("TARGET_GITHUB_OWNER is required");
  });

  it("throws if DEPLOY_TARGET is not render or cloudflare", () => {
    expect(() => loadConfig({ ...renderEnv, DEPLOY_TARGET: "heroku" })).toThrow(
      'DEPLOY_TARGET must be "render" or "cloudflare"',
    );
  });

  it("throws if RENDER_API_KEY is missing on the render target", () => {
    const { RENDER_API_KEY, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("RENDER_API_KEY is required");
  });

  it("throws if RENDER_OWNER_ID is missing on the render target", () => {
    const { RENDER_OWNER_ID, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("RENDER_OWNER_ID is required");
  });

  it("does not require RENDER_API_KEY/RENDER_OWNER_ID on the cloudflare target", () => {
    expect(() => loadConfig(cloudflareEnv)).not.toThrow();
  });

  it("throws if CLOUDFLARE_API_TOKEN is missing on the cloudflare target", () => {
    const { CLOUDFLARE_API_TOKEN, ...rest } = cloudflareEnv;
    expect(() => loadConfig(rest)).toThrow("CLOUDFLARE_API_TOKEN is required");
  });

  it("throws if CLOUDFLARE_ACCOUNT_ID is missing on the cloudflare target", () => {
    const { CLOUDFLARE_ACCOUNT_ID, ...rest } = cloudflareEnv;
    expect(() => loadConfig(rest)).toThrow("CLOUDFLARE_ACCOUNT_ID is required");
  });

  it("does not require CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID on the render target", () => {
    expect(() => loadConfig(renderEnv)).not.toThrow();
  });

  it("throws if PORT is not a number", () => {
    expect(() => loadConfig({ ...renderEnv, PORT: "not-a-number" })).toThrow("PORT must be a number");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `deployTarget`/`cloudflareApiToken`/`cloudflareAccountId` missing from the returned object, cloudflare-target tests throw the render-required errors instead.

- [ ] **Step 3: Implement**

Replace `src/config.ts` entirely with:

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

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const githubToken = env.GITHUB_TOKEN;
  const targetGithubOwner = env.TARGET_GITHUB_OWNER;

  if (!githubToken) throw new Error("GITHUB_TOKEN is required");
  if (!targetGithubOwner) throw new Error("TARGET_GITHUB_OWNER is required");

  const deployTargetRaw = env.DEPLOY_TARGET ?? "render";
  if (deployTargetRaw !== "render" && deployTargetRaw !== "cloudflare") {
    throw new Error('DEPLOY_TARGET must be "render" or "cloudflare"');
  }
  const deployTarget = deployTargetRaw;

  let renderApiKey: string | undefined;
  let renderOwnerId: string | undefined;
  let cloudflareApiToken: string | undefined;
  let cloudflareAccountId: string | undefined;

  if (deployTarget === "render") {
    renderApiKey = env.RENDER_API_KEY;
    renderOwnerId = env.RENDER_OWNER_ID;
    if (!renderApiKey) throw new Error("RENDER_API_KEY is required");
    if (!renderOwnerId) throw new Error("RENDER_OWNER_ID is required");
  } else {
    cloudflareApiToken = env.CLOUDFLARE_API_TOKEN;
    cloudflareAccountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!cloudflareApiToken) throw new Error("CLOUDFLARE_API_TOKEN is required");
    if (!cloudflareAccountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  }

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (Number.isNaN(port)) throw new Error("PORT must be a number");

  return {
    githubToken,
    targetGithubOwner,
    deployTarget,
    renderApiKey,
    renderOwnerId,
    cloudflareApiToken,
    cloudflareAccountId,
    port,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Update `.env.example`**

Replace its contents with:

```
GITHUB_TOKEN=
TARGET_GITHUB_OWNER=
DEPLOY_TARGET=render
RENDER_API_KEY=
RENDER_OWNER_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
PORT=3000
CLAUDE_CLI_COMMAND=
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts .env.example
git commit -m "$(cat <<'EOF'
feat: add DEPLOY_TARGET config with conditional credential validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

### Task 5: Split starter templates

**Files:**
- Rename: `templates/starter/` → `templates/starter-render/`
- Create: `templates/starter-cloudflare/src/index.js`
- Create: `templates/starter-cloudflare/wrangler.toml`
- Create: `templates/starter-cloudflare/package.json`
- Create: `templates/starter-cloudflare/README.md`
- Create: `templates/starter-cloudflare/.gitignore`

No test file — this task's "test" is `readStarterFiles` (existing, unmodified) reading both directories without error, verified via a manual Node check.

- [ ] **Step 1: Rename the Render starter directory**

```bash
git mv templates/starter templates/starter-render
```

- [ ] **Step 2: Create the Cloudflare starter's entry file**

```js
// templates/starter-cloudflare/src/index.js
export default {
  async fetch(request) {
    return new Response("Hello from idea-to-mvp");
  },
};
```

- [ ] **Step 3: Create the Cloudflare starter's Wrangler config**

```toml
# templates/starter-cloudflare/wrangler.toml
name = "idea-to-mvp-app"
main = "src/index.js"
compatibility_date = "2026-01-01"
```

- [ ] **Step 4: Create the Cloudflare starter's package.json**

```json
{
  "name": "idea-to-mvp-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev"
  },
  "devDependencies": {
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 5: Create the Cloudflare starter's README and .gitignore**

```md
<!-- templates/starter-cloudflare/README.md -->
# App

Generated by idea-to-mvp. Run `npm install && npm run dev` (via
Wrangler) to iterate locally. Deployed to Cloudflare Workers
automatically by the idea-to-mvp pipeline.
```

```
node_modules/
.wrangler/
```
(as `templates/starter-cloudflare/.gitignore`)

- [ ] **Step 6: Verify both starter directories are readable**

Run:
```bash
node -e "
const { readStarterFiles } = require('./dist/github/readStarterFiles.js');
" 2>/dev/null || npx tsx -e "
import { readStarterFiles } from './src/github/readStarterFiles.js';
console.log(readStarterFiles('templates/starter-render').map(f => f.path));
console.log(readStarterFiles('templates/starter-cloudflare').map(f => f.path));
"
```
Expected: two arrays of file paths print with no errors — `templates/starter-render` listing `server.js`/`package.json`/`README.md`/`.gitignore`, `templates/starter-cloudflare` listing `src/index.js`/`wrangler.toml`/`package.json`/`README.md`/`.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add -A templates/
git commit -m "$(cat <<'EOF'
feat: split starter template into render and cloudflare variants

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

### Task 6: Rewire `runOrchestrator.ts` from `render: RenderClient` to `deploy: DeployClient`

**Files:**
- Modify: `src/orchestrator/runOrchestrator.ts`
- Modify: `src/orchestrator/runOrchestrator.test.ts`
- Modify: `src/orchestrator/runController.test.ts`

**Interfaces:**
- Consumes: `DeployClient`/`DeployParams`/`DeployResult` from Task 1 (`src/deploy/types.js`).
- Produces: `OrchestratorDeps.deploy: DeployClient` (replacing `OrchestratorDeps.render: RenderClient`) — Task 7 (`cli.ts`) supplies this field.

- [ ] **Step 1: Update the failing assertions in `runOrchestrator.test.ts`**

In `src/orchestrator/runOrchestrator.test.ts`, replace the `render` fake (lines 33-36) with:

```ts
  const deploy = {
    label: "Render",
    deploy: vi.fn().mockResolvedValue({ url: "https://idea-to-mvp-app-1.onrender.com" }),
  };
```

Replace `render: render as never,` (line 64) with `deploy: deploy as never,`.

Replace this assertion in the "runs every stage..." test:
```ts
    expect(deps.render.createService).toHaveBeenCalledWith({
      name: "idea-to-mvp-app-1",
      repoUrl: "https://github.com/org/idea-to-mvp-app-1",
      branch: "main",
    });
```
with:
```ts
    expect(deps.deploy.deploy).toHaveBeenCalledWith({
      name: "idea-to-mvp-app-1",
      repoUrl: "https://github.com/org/idea-to-mvp-app-1",
      branch: "main",
      workDir: "/tmp/work",
    });
```

Replace `expect(deps.render.createService).not.toHaveBeenCalled();` (in the "blocks before merging or deploying..." test) with `expect(deps.deploy.deploy).not.toHaveBeenCalled();`.

Replace `expect(deps.render.createService).toHaveBeenCalled();` (in the "proceeds through merge and deploy..." test) with `expect(deps.deploy.deploy).toHaveBeenCalled();`.

- [ ] **Step 2: Update the fake in `runController.test.ts`**

In `src/orchestrator/runController.test.ts`, replace the `render` fake (lines 32-35) with:

```ts
  const deploy = {
    label: "Render",
    deploy: vi.fn().mockResolvedValue({ url: "https://app.onrender.com" }),
  };
```

Replace `render: render as never,` (line 55) with `deploy: deploy as never,`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts src/orchestrator/runController.test.ts`
Expected: FAIL — `Property 'render' does not exist` / `deps.deploy is undefined`-style errors, since `OrchestratorDeps` and the deploy stage still reference `render`.

- [ ] **Step 4: Update `runOrchestrator.ts`**

Replace the import (currently `import type { RenderClient } from "../deploy/render.js";`) with:

```ts
import type { DeployClient } from "../deploy/types.js";
```

Replace the `render: RenderClient;` field in `OrchestratorDeps` with:

```ts
  deploy: DeployClient;
```

Replace the `"deploy"` stage's `run` body with:

```ts
    async run(ctx, params, deps) {
      ctx.pendingInput = {
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
        workDir: params.workDir,
      };
      deps.eventBus.emit(stageEvent("deploy", "running", `Deploying to ${deps.deploy.label}`, { input: ctx.pendingInput }));
      const live = await deps.deploy.deploy({
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
        workDir: params.workDir,
      });
      deps.eventBus.emit(stageEvent("deploy", "done", live.url, { output: live }));
      ctx.tracingEntries.push({ stage: "deploy", status: "done", input: ctx.pendingInput, output: live });
      ctx.deployUrl = live.url;
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts src/orchestrator/runController.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors (this surfaces any other file still referencing `RenderClient`/`deps.render` — there should be none left besides `cli.ts`, which Task 7 fixes next).

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/runOrchestrator.ts src/orchestrator/runOrchestrator.test.ts src/orchestrator/runController.test.ts
git commit -m "$(cat <<'EOF'
refactor: generalize runOrchestrator's deploy stage to DeployClient

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

### Task 7: Wire `cli.ts` to pick starter dir + deploy client by `DEPLOY_TARGET`, update README

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Config.deployTarget`/`renderApiKey`/`renderOwnerId`/`cloudflareApiToken`/`cloudflareAccountId` from Task 4 (`src/config.js`); `RenderClient` from Task 2; `CloudflareClient` from Task 3; `OrchestratorDeps.deploy` from Task 6; `templates/starter-render`/`templates/starter-cloudflare` from Task 5.

- [ ] **Step 1: Update imports in `src/cli.ts`**

Replace:
```ts
import { RenderClient } from "./deploy/render.js";
```
with:
```ts
import { CloudflareClient } from "./deploy/cloudflare.js";
import { RenderClient } from "./deploy/render.js";
import type { DeployClient } from "./deploy/types.js";
```

- [ ] **Step 2: Pick the starter dir and deploy client in `main()`**

Replace:
```ts
  const octokit = new Octokit({ auth: config.githubToken });
  const controller = new RunController({
    owner: config.targetGithubOwner,
    starterDir: fileURLToPath(new URL("../templates/starter", import.meta.url)),
    githubToken: config.githubToken,
    deps: {
      github: new GithubClient(octokit),
      render: new RenderClient(config.renderApiKey, config.renderOwnerId),
      git: { cloneRepo, createAndCheckoutBranch, resetWorkingTree, pushBranch, diffAgainstBase },
```
with:
```ts
  const octokit = new Octokit({ auth: config.githubToken });
  const starterDir =
    config.deployTarget === "cloudflare"
      ? fileURLToPath(new URL("../templates/starter-cloudflare", import.meta.url))
      : fileURLToPath(new URL("../templates/starter-render", import.meta.url));
  const deployClient: DeployClient =
    config.deployTarget === "cloudflare"
      ? new CloudflareClient(config.cloudflareApiToken!, config.cloudflareAccountId!)
      : new RenderClient(config.renderApiKey!, config.renderOwnerId!);
  const controller = new RunController({
    owner: config.targetGithubOwner,
    starterDir,
    githubToken: config.githubToken,
    deps: {
      github: new GithubClient(octokit),
      deploy: deployClient,
      git: { cloneRepo, createAndCheckoutBranch, resetWorkingTree, pushBranch, diffAgainstBase },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full backend test suite**

Run: `npm test`
Expected: all suites pass (this is the first point every changed file in this plan is exercised together).

- [ ] **Step 5: Update `README.md`**

Replace line 5's `deployed live on Render.` with `deployed live to Render or Cloudflare Workers, depending on \`DEPLOY_TARGET\`.`.

Replace the "Environment variables" table (current lines 22-29) with:

```md
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
```

Replace line 43's `The run ends either on a live Render URL (QA passed)` with `The run ends either on a live URL (QA passed, on whichever target \`DEPLOY_TARGET\` selected)`.

Replace line 57's `and Render calls are mocked` with `and Render/Cloudflare calls are mocked`.

Replace line 62's `The Render deployment polling and payload shapes have not been verified against a live Render API` with `Neither the Render deployment polling/payload shapes nor the Cloudflare Workers script-upload payload shapes have been verified against their live APIs`, keeping the rest of that sentence and paragraph unchanged.

Replace line 67-68's `Every run scaffolds a brand-new app from the bundled Node/Express starter template` with `Every run scaffolds a brand-new app from the bundled starter template for the active \`DEPLOY_TARGET\` (Node/Express for Render, a Workers \`fetch\` handler for Cloudflare)`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts README.md
git commit -m "$(cat <<'EOF'
feat: wire DEPLOY_TARGET through to starter dir and deploy client selection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DJCVUapHt6AdtHa873qeY8
EOF
)"
```

---

## Final verification

- [ ] Run `npm test` — full backend suite passes.
- [ ] Run `npx tsc --noEmit` — no type errors.
- [ ] Run `npm run build` — compiles cleanly (backend + dashboard UI).
