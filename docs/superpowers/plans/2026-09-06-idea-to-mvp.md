# idea-to-mvp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI + local orchestrator + web dashboard that takes an idea/brief in Markdown, drives it through Analyst → Architect → Developer → QA `claude -p` agents plus deterministic GitHub/Render integration, and ends with a merged PR deployed live on Render.

**Architecture:** A deterministic TypeScript orchestrator sequences ten pipeline stages, delegating judgment to four `claude -p` subprocess agents (Analyst, Architect, Developer, QA) and handling all GitHub/Render/git mechanics itself. Progress is published on an in-process event bus that a local Express server streams to a browser dashboard over SSE.

**Tech Stack:** Node.js 20+, TypeScript (ESM), Vitest, Express, `@octokit/rest`, `zod`, `open`. No AI SDK — agents shell out to the local `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-09-06-idea-to-mvp-design.md`

## Global Constraints

- Node.js 20+, TypeScript, npm, Vitest — matches the other Excality-Hub repos' toolchain.
- ESM throughout: `"type": "module"` in `package.json`; TS source imports use explicit `.js` extensions (they resolve to the compiled `.js` at runtime).
- No Anthropic API key handling in this repo — all four agents shell out to the local `claude` CLI (`claude -p`), relying on whatever Claude Code auth is already configured on the machine.
- All GitHub, Render, and git calls happen in deterministic code (`src/github/`, `src/deploy/`, `src/git.ts`), never inside an agent's `claude -p` prompt/tool access.
- Deploy is deterministic code, not a `claude -p` agent.
- Deploy is blocked only when at least one QA finding has `severity: "critical"`; every other severity is advisory only.
- `TARGET_GITHUB_OWNER` must be a GitHub organization (repo creation uses the org-scoped Octokit endpoint, `repos.createInOrg`).
- No retries and no silent fallbacks on stage failure — a failed stage halts the run.
- Run state is in-memory only for v1 — no persistence across restarts, no run-history list.
- All GitHub/Render/`claude -p`/git-subprocess calls are mocked in tests — no end-to-end tests against real APIs or subprocesses.

---

## Task 1: Project scaffold + config loader

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces: `export interface Config { githubToken: string; targetGithubOwner: string; renderApiKey: string; port: number }` and `export function loadConfig(env?: NodeJS.ProcessEnv): Config` from `src/config.ts`. Every later task that needs configuration imports `loadConfig`/`Config` from here.

- [ ] **Step 1: Create the project scaffold**

`package.json`:
```json
{
  "name": "idea-to-mvp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "idea-to-mvp": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "@octokit/rest": "^21.0.0",
    "express": "^4.19.2",
    "open": "^10.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

`.gitignore`:
```
node_modules/
dist/
.env
```

`.env.example`:
```
GITHUB_TOKEN=
TARGET_GITHUB_OWNER=
RENDER_API_KEY=
PORT=3000
```

Run: `npm install`

- [ ] **Step 2: Write the failing test for the config loader**

```ts
// src/config.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnv = {
  GITHUB_TOKEN: "gh-token",
  TARGET_GITHUB_OWNER: "excality-sandbox",
  RENDER_API_KEY: "render-key",
};

describe("loadConfig", () => {
  it("returns a config object from valid env vars, defaulting PORT to 3000", () => {
    expect(loadConfig(validEnv)).toEqual({
      githubToken: "gh-token",
      targetGithubOwner: "excality-sandbox",
      renderApiKey: "render-key",
      port: 3000,
    });
  });

  it("uses PORT from env when provided", () => {
    expect(loadConfig({ ...validEnv, PORT: "4000" }).port).toBe(4000);
  });

  it("throws if GITHUB_TOKEN is missing", () => {
    const { GITHUB_TOKEN, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow("GITHUB_TOKEN is required");
  });

  it("throws if TARGET_GITHUB_OWNER is missing", () => {
    const { TARGET_GITHUB_OWNER, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow("TARGET_GITHUB_OWNER is required");
  });

  it("throws if RENDER_API_KEY is missing", () => {
    const { RENDER_API_KEY, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow("RENDER_API_KEY is required");
  });

  it("throws if PORT is not a number", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "not-a-number" })).toThrow(
      "PORT must be a number",
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `src/config.ts` does not exist yet.

- [ ] **Step 4: Implement the config loader**

```ts
// src/config.ts
export interface Config {
  githubToken: string;
  targetGithubOwner: string;
  renderApiKey: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const githubToken = env.GITHUB_TOKEN;
  const targetGithubOwner = env.TARGET_GITHUB_OWNER;
  const renderApiKey = env.RENDER_API_KEY;

  if (!githubToken) throw new Error("GITHUB_TOKEN is required");
  if (!targetGithubOwner) throw new Error("TARGET_GITHUB_OWNER is required");
  if (!renderApiKey) throw new Error("RENDER_API_KEY is required");

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (Number.isNaN(port)) throw new Error("PORT must be a number");

  return { githubToken, targetGithubOwner, renderApiKey, port };
}
```

- [ ] **Step 5: Run the test to verify it passes, and verify the build works**

Run: `npx vitest run src/config.test.ts`
Expected: PASS (all 6 cases)

Run: `npm run build`
Expected: compiles cleanly to `dist/`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/config.ts src/config.test.ts
git commit -m "feat: project scaffold and config loader"
```

---

## Task 2: Orchestrator types & event bus

**Files:**
- Create: `src/orchestrator/types.ts`
- Create: `src/orchestrator/events.ts`
- Test: `src/orchestrator/events.test.ts`

**Interfaces:**
- Produces: `StageName`, `StageStatus`, `RunEvent` types from `src/orchestrator/types.ts`; `RunEventBus` class with `emit(event: RunEvent): void` and `onEvent(listener: (event: RunEvent) => void): () => void` from `src/orchestrator/events.ts`. Task 12 (orchestrator) and Task 13 (dashboard) both depend on this exact shape.

- [ ] **Step 1: Write the types**

```ts
// src/orchestrator/types.ts
export type StageName =
  | "create_repo"
  | "analyst"
  | "architect"
  | "open_issue"
  | "developer"
  | "open_pr"
  | "qa"
  | "post_review"
  | "merge"
  | "deploy";

export type StageStatus = "running" | "done" | "failed" | "blocked";

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
}
```

- [ ] **Step 2: Write the failing test for the event bus**

```ts
// src/orchestrator/events.test.ts
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "./events.js";
import type { RunEvent } from "./types.js";

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-06T00:00:00.000Z",
};

describe("RunEventBus", () => {
  it("delivers emitted events to a subscribed listener", () => {
    const bus = new RunEventBus();
    const listener = vi.fn();
    bus.onEvent(listener);

    bus.emit(sampleEvent);

    expect(listener).toHaveBeenCalledWith(sampleEvent);
  });

  it("delivers events to multiple listeners", () => {
    const bus = new RunEventBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    bus.onEvent(listenerA);
    bus.onEvent(listenerB);

    bus.emit(sampleEvent);

    expect(listenerA).toHaveBeenCalledWith(sampleEvent);
    expect(listenerB).toHaveBeenCalledWith(sampleEvent);
  });

  it("stops delivering events after unsubscribe", () => {
    const bus = new RunEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.onEvent(listener);

    unsubscribe();
    bus.emit(sampleEvent);

    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/orchestrator/events.test.ts`
Expected: FAIL — `src/orchestrator/events.ts` does not exist yet.

- [ ] **Step 4: Implement the event bus**

```ts
// src/orchestrator/events.ts
import { EventEmitter } from "node:events";
import type { RunEvent } from "./types.js";

export class RunEventBus {
  private emitter = new EventEmitter();

  emit(event: RunEvent): void {
    this.emitter.emit("event", event);
  }

  onEvent(listener: (event: RunEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/orchestrator/events.test.ts`
Expected: PASS (all 3 cases)

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/events.ts src/orchestrator/events.test.ts
git commit -m "feat: orchestrator run event types and event bus"
```

---

## Task 3: `claude -p` agent runner

**Files:**
- Create: `src/claudeAgent.ts`
- Test: `src/claudeAgent.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function runClaudeAgent(params: { prompt: string; cwd: string; allowedTools: string[] }): Promise<string>`, `export function extractClaudeResultText(rawOutput: string): string`, `export function parseJsonBlock<T>(text: string, schema: import("zod").ZodType<T>): T`. Tasks 8–11 (the four agents) all build on these three functions.

- [ ] **Step 1: Write the failing tests**

```ts
// src/claudeAgent.test.ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "./claudeAgent.js";

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("runClaudeAgent", () => {
  it("resolves with stdout when the process exits 0", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runClaudeAgent({ prompt: "do it", cwd: "/tmp/repo", allowedTools: [] });
    child.stdout.emit("data", Buffer.from('{"result":"hi"}'));
    child.emit("close", 0);

    await expect(promise).resolves.toBe('{"result":"hi"}');
  });

  it("rejects with stderr when the process exits non-zero", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runClaudeAgent({ prompt: "do it", cwd: "/tmp/repo", allowedTools: [] });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 1);

    await expect(promise).rejects.toThrow("claude -p exited with code 1: boom");
  });
});

describe("extractClaudeResultText", () => {
  it("returns the result field from the claude -p JSON envelope", () => {
    expect(extractClaudeResultText('{"result":"hello world"}')).toBe("hello world");
  });

  it("throws if the envelope has no result field", () => {
    expect(() => extractClaudeResultText("{}")).toThrow(
      "claude -p output did not include a 'result' string field",
    );
  });
});

describe("parseJsonBlock", () => {
  const schema = z.object({ ok: z.boolean() });

  it("parses a fenced json block matching the schema", () => {
    const text = 'Some explanation.\n```json\n{"ok": true}\n```';
    expect(parseJsonBlock(text, schema)).toEqual({ ok: true });
  });

  it("throws if there is no fenced json block", () => {
    expect(() => parseJsonBlock("no block here", schema)).toThrow(
      "No fenced ```json block found in agent output",
    );
  });

  it("throws if the fenced block is not valid JSON", () => {
    expect(() => parseJsonBlock("```json\nnot json\n```", schema)).toThrow(
      "Fenced JSON block was not valid JSON",
    );
  });

  it("throws if the parsed JSON does not match the schema", () => {
    expect(() => parseJsonBlock('```json\n{"ok": "not a boolean"}\n```', schema)).toThrow(
      "Agent output JSON did not match expected schema",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/claudeAgent.test.ts`
Expected: FAIL — `src/claudeAgent.ts` does not exist yet.

- [ ] **Step 3: Implement the agent runner**

```ts
// src/claudeAgent.ts
import { spawn } from "node:child_process";
import type { z } from "zod";

export interface RunClaudeAgentParams {
  prompt: string;
  cwd: string;
  allowedTools: string[];
}

export function runClaudeAgent(params: RunClaudeAgentParams): Promise<string> {
  const { prompt, cwd, allowedTools } = params;
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json"];
    if (allowedTools.length > 0) {
      args.push("--allowedTools", allowedTools.join(" "));
    }
    const child = spawn("claude", args, { cwd });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p exited with code ${code}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function extractClaudeResultText(rawOutput: string): string {
  const envelope = JSON.parse(rawOutput) as { result?: unknown };
  if (typeof envelope.result !== "string") {
    throw new Error("claude -p output did not include a 'result' string field");
  }
  return envelope.result;
}

export function parseJsonBlock<T>(text: string, schema: z.ZodType<T>): T {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    throw new Error("No fenced ```json block found in agent output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Fenced JSON block was not valid JSON: ${(error as Error).message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Agent output JSON did not match expected schema: ${result.error.message}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/claudeAgent.test.ts`
Expected: PASS (all 9 cases)

- [ ] **Step 5: Commit**

```bash
git add src/claudeAgent.ts src/claudeAgent.test.ts
git commit -m "feat: claude -p subprocess runner and structured output parsing"
```

---

## Task 4: Starter template files + reader

**Files:**
- Create: `templates/starter/package.json`
- Create: `templates/starter/server.js`
- Create: `templates/starter/README.md`
- Create: `templates/starter/.gitignore`
- Create: `src/github/readStarterFiles.ts`
- Test: `src/github/readStarterFiles.test.ts`

**Interfaces:**
- Produces: `export interface StarterFile { path: string; content: string }` and `export function readStarterFiles(starterDir: string): StarterFile[]` from `src/github/readStarterFiles.ts`. Task 6 (GitHub client) and Task 12 (orchestrator) consume this.

- [ ] **Step 1: Create the starter template files**

`templates/starter/package.json`:
```json
{
  "name": "idea-to-mvp-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

`templates/starter/server.js`:
```js
import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.send("Hello from idea-to-mvp");
});

app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
```

`templates/starter/README.md`:
```md
# App

Generated by idea-to-mvp. Run `npm install && npm start`.
```

`templates/starter/.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Write the failing test for the reader**

```ts
// src/github/readStarterFiles.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStarterFiles } from "./readStarterFiles.js";

describe("readStarterFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "starter-test-"));
    writeFileSync(join(dir, "package.json"), '{"name":"app"}');
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "file.txt"), "hello");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns every file with a path relative to the starter dir and its content", () => {
    const files = readStarterFiles(dir).sort((a, b) => a.path.localeCompare(b.path));

    expect(files).toEqual([
      { path: "nested/file.txt", content: "hello" },
      { path: "package.json", content: '{"name":"app"}' },
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/github/readStarterFiles.test.ts`
Expected: FAIL — `src/github/readStarterFiles.ts` does not exist yet.

- [ ] **Step 4: Implement the reader**

```ts
// src/github/readStarterFiles.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface StarterFile {
  path: string;
  content: string;
}

export function readStarterFiles(starterDir: string): StarterFile[] {
  const files: StarterFile[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else {
        files.push({
          path: relative(starterDir, fullPath).split("\\").join("/"),
          content: readFileSync(fullPath, "utf-8"),
        });
      }
    }
  }

  walk(starterDir);
  return files;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/github/readStarterFiles.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add templates/starter src/github/readStarterFiles.ts src/github/readStarterFiles.test.ts
git commit -m "feat: bundled starter template and starter file reader"
```

---

## Task 5: Git helper

**Files:**
- Create: `src/git.ts`
- Test: `src/git.test.ts`

**Interfaces:**
- Produces: `export function cloneRepo(cloneUrl: string, targetDir: string): Promise<void>`, `export function createAndCheckoutBranch(repoDir: string, branchName: string): Promise<void>`, `export function pushBranch(repoDir: string, branchName: string): Promise<void>`, `export function diffAgainstBase(repoDir: string, baseBranch: string): Promise<string>`. Task 12 (orchestrator) consumes all four.

- [ ] **Step 1: Write the failing tests**

```ts
// src/git.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "./git.js";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecFileOnce(stdout: string) {
  vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback;
    callback(null, stdout, "");
    return {} as never;
  }) as never);
}

describe("git helper", () => {
  it("cloneRepo runs git clone with the url and target dir", async () => {
    mockExecFileOnce("");
    await cloneRepo("git@github.com:org/repo.git", "/tmp/work");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["clone", "git@github.com:org/repo.git", "/tmp/work"],
      expect.any(Function),
    );
  });

  it("createAndCheckoutBranch runs git checkout -b in the repo dir", async () => {
    mockExecFileOnce("");
    await createAndCheckoutBranch("/tmp/work", "feature/x");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["checkout", "-b", "feature/x"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });

  it("pushBranch runs git push -u origin <branch> in the repo dir", async () => {
    mockExecFileOnce("");
    await pushBranch("/tmp/work", "feature/x");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["push", "-u", "origin", "feature/x"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });

  it("diffAgainstBase returns the diff output against origin/<base>", async () => {
    mockExecFileOnce("diff --git a/x b/x");
    const diff = await diffAgainstBase("/tmp/work", "main");
    expect(diff).toBe("diff --git a/x b/x");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["diff", "origin/main"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/git.test.ts`
Expected: FAIL — `src/git.ts` does not exist yet.

- [ ] **Step 3: Implement the git helper**

```ts
// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function cloneRepo(cloneUrl: string, targetDir: string): Promise<void> {
  await execFileAsync("git", ["clone", cloneUrl, targetDir]);
}

export async function createAndCheckoutBranch(repoDir: string, branchName: string): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", branchName], { cwd: repoDir });
}

export async function pushBranch(repoDir: string, branchName: string): Promise<void> {
  await execFileAsync("git", ["push", "-u", "origin", branchName], { cwd: repoDir });
}

export async function diffAgainstBase(repoDir: string, baseBranch: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["diff", `origin/${baseBranch}`], { cwd: repoDir });
  return stdout;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/git.test.ts`
Expected: PASS (all 4 cases)

- [ ] **Step 5: Commit**

```bash
git add src/git.ts src/git.test.ts
git commit -m "feat: git helper for clone, branch, push and diff"
```

---

## Task 6: GitHub API client

**Files:**
- Create: `src/github/client.ts`
- Test: `src/github/client.test.ts`

**Interfaces:**
- Consumes: `StarterFile` from `src/github/readStarterFiles.ts` (Task 4).
- Produces: `export class GithubClient` with methods `createRepoFromStarter(params: { owner: string; repoName: string; starterFiles: StarterFile[] }): Promise<{ owner: string; repo: string; htmlUrl: string; cloneUrl: string }>`, `createIssue(owner: string, repo: string, title: string, body: string): Promise<{ number: number }>`, `createPullRequest(params: { owner: string; repo: string; title: string; body: string; head: string; base: string; issueNumber: number }): Promise<{ number: number; htmlUrl: string }>`, `postPrComment(owner: string, repo: string, prNumber: number, body: string): Promise<void>`, `mergePullRequest(owner: string, repo: string, prNumber: number): Promise<void>`. Task 12 (orchestrator) consumes this class.

- [ ] **Step 1: Write the failing tests**

```ts
// src/github/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { GithubClient } from "./client.js";
import type { StarterFile } from "./readStarterFiles.js";

function makeFakeOctokit() {
  return {
    repos: {
      createInOrg: vi.fn().mockResolvedValue({
        data: { html_url: "https://github.com/org/repo", clone_url: "https://github.com/org/repo.git" },
      }),
      createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
    },
    issues: {
      create: vi.fn().mockResolvedValue({ data: { number: 7 } }),
      createComment: vi.fn().mockResolvedValue({}),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({ data: { number: 12, html_url: "https://github.com/org/repo/pull/12" } }),
      merge: vi.fn().mockResolvedValue({}),
    },
  };
}

const starterFiles: StarterFile[] = [{ path: "package.json", content: '{"name":"app"}' }];

describe("GithubClient", () => {
  it("createRepoFromStarter creates the repo and commits each starter file", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    const result = await client.createRepoFromStarter({ owner: "org", repoName: "repo", starterFiles });

    expect(octokit.repos.createInOrg).toHaveBeenCalledWith({ org: "org", name: "repo", private: false });
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      path: "package.json",
      message: "add package.json",
      content: Buffer.from('{"name":"app"}', "utf-8").toString("base64"),
    });
    expect(result).toEqual({
      owner: "org",
      repo: "repo",
      htmlUrl: "https://github.com/org/repo",
      cloneUrl: "https://github.com/org/repo.git",
    });
  });

  it("createIssue creates an issue and returns its number", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    const result = await client.createIssue("org", "repo", "Add feature", "Do the thing");

    expect(octokit.issues.create).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      title: "Add feature",
      body: "Do the thing",
    });
    expect(result).toEqual({ number: 7 });
  });

  it("createPullRequest opens a PR that closes the linked issue", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    const result = await client.createPullRequest({
      owner: "org",
      repo: "repo",
      title: "Add feature",
      body: "Did the thing",
      head: "feature/x",
      base: "main",
      issueNumber: 7,
    });

    expect(octokit.pulls.create).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      title: "Add feature",
      body: "Did the thing\n\nCloses #7",
      head: "feature/x",
      base: "main",
    });
    expect(result).toEqual({ number: 12, htmlUrl: "https://github.com/org/repo/pull/12" });
  });

  it("postPrComment posts a comment on the PR's issue thread", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    await client.postPrComment("org", "repo", 12, "QA review: pass");

    expect(octokit.issues.createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 12,
      body: "QA review: pass",
    });
  });

  it("mergePullRequest squash-merges the PR", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    await client.mergePullRequest("org", "repo", 12);

    expect(octokit.pulls.merge).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 12,
      merge_method: "squash",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/github/client.test.ts`
Expected: FAIL — `src/github/client.ts` does not exist yet.

- [ ] **Step 3: Implement the GitHub client**

```ts
// src/github/client.ts
import type { Octokit } from "@octokit/rest";
import type { StarterFile } from "./readStarterFiles.js";

export interface CreateRepoParams {
  owner: string;
  repoName: string;
  starterFiles: StarterFile[];
}

export interface CreatePullRequestParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  issueNumber: number;
}

export class GithubClient {
  constructor(private octokit: Octokit) {}

  async createRepoFromStarter(
    params: CreateRepoParams,
  ): Promise<{ owner: string; repo: string; htmlUrl: string; cloneUrl: string }> {
    const { owner, repoName, starterFiles } = params;
    const { data: repo } = await this.octokit.repos.createInOrg({
      org: owner,
      name: repoName,
      private: false,
    });

    for (const file of starterFiles) {
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: file.path,
        message: `add ${file.path}`,
        content: Buffer.from(file.content, "utf-8").toString("base64"),
      });
    }

    return { owner, repo: repoName, htmlUrl: repo.html_url, cloneUrl: repo.clone_url };
  }

  async createIssue(owner: string, repo: string, title: string, body: string): Promise<{ number: number }> {
    const { data } = await this.octokit.issues.create({ owner, repo, title, body });
    return { number: data.number };
  }

  async createPullRequest(
    params: CreatePullRequestParams,
  ): Promise<{ number: number; htmlUrl: string }> {
    const { data } = await this.octokit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: `${params.body}\n\nCloses #${params.issueNumber}`,
      head: params.head,
      base: params.base,
    });
    return { number: data.number, htmlUrl: data.html_url };
  }

  async postPrComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
  }

  async mergePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber, merge_method: "squash" });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/github/client.test.ts`
Expected: PASS (all 5 cases)

- [ ] **Step 5: Commit**

```bash
git add src/github/client.ts src/github/client.test.ts
git commit -m "feat: GitHub API client for repo/issue/PR/comment/merge"
```

---

## Task 7: Render deploy client

**Files:**
- Create: `src/deploy/render.ts`
- Test: `src/deploy/render.test.ts`

**Interfaces:**
- Produces: `export class RenderClient` constructed as `new RenderClient(apiKey: string, fetchImpl?: typeof fetch)`, with `createService(params: { name: string; repoUrl: string; branch: string }): Promise<{ serviceId: string }>` and `waitForLive(serviceId: string, options: { maxAttempts: number; pollIntervalMs: number }): Promise<{ url: string }>`. Task 12 (orchestrator) consumes this class.

- [ ] **Step 1: Write the failing tests**

```ts
// src/deploy/render.test.ts
import { describe, expect, it, vi } from "vitest";
import { RenderClient } from "./render.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("RenderClient", () => {
  it("createService posts to the Render API and returns the service id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ service: { id: "srv-1" } }));
    const client = new RenderClient("key-1", fetchImpl);

    const result = await client.createService({ name: "app", repoUrl: "https://github.com/org/app", branch: "main" });

    expect(result).toEqual({ serviceId: "srv-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.render.com/v1/services");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer key-1");
  });

  it("createService throws when the Render API responds with an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "bad request" }, false, 400));
    const client = new RenderClient("key-1", fetchImpl);

    await expect(
      client.createService({ name: "app", repoUrl: "https://github.com/org/app", branch: "main" }),
    ).rejects.toThrow("Render createService failed: 400");
  });

  it("waitForLive resolves once the service reports a url", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ service: { serviceDetails: {} } }))
      .mockResolvedValueOnce(jsonResponse({ service: { serviceDetails: { url: "https://app.onrender.com" } } }));
    const client = new RenderClient("key-1", fetchImpl);

    const result = await client.waitForLive("srv-1", { maxAttempts: 2, pollIntervalMs: 0 });

    expect(result).toEqual({ url: "https://app.onrender.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waitForLive throws after exhausting maxAttempts without a url", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ service: { serviceDetails: {} } }));
    const client = new RenderClient("key-1", fetchImpl);

    await expect(client.waitForLive("srv-1", { maxAttempts: 2, pollIntervalMs: 0 })).rejects.toThrow(
      "Render service srv-1 did not become live after 2 attempts",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/deploy/render.test.ts`
Expected: FAIL — `src/deploy/render.ts` does not exist yet.

- [ ] **Step 3: Implement the Render client**

```ts
// src/deploy/render.ts
export class RenderClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async createService(params: { name: string; repoUrl: string; branch: string }): Promise<{ serviceId: string }> {
    const res = await this.fetchImpl("https://api.render.com/v1/services", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "web_service",
        name: params.name,
        repo: params.repoUrl,
        branch: params.branch,
        serviceDetails: {
          env: "node",
          envSpecificDetails: { buildCommand: "npm install", startCommand: "npm start" },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Render createService failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { service: { id: string } };
    return { serviceId: data.service.id };
  }

  async waitForLive(
    serviceId: string,
    options: { maxAttempts: number; pollIntervalMs: number },
  ): Promise<{ url: string }> {
    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      const res = await this.fetchImpl(`https://api.render.com/v1/services/${serviceId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        throw new Error(`Render getService failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { service: { serviceDetails?: { url?: string } } };
      const url = data.service.serviceDetails?.url;
      if (url) {
        return { url };
      }

      if (attempt < options.maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
      }
    }

    throw new Error(`Render service ${serviceId} did not become live after ${options.maxAttempts} attempts`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/deploy/render.test.ts`
Expected: PASS (all 4 cases)

- [ ] **Step 5: Commit**

```bash
git add src/deploy/render.ts src/deploy/render.test.ts
git commit -m "feat: Render deploy client"
```

---

## Task 8: Agent output schemas + Analyst agent

**Files:**
- Create: `src/agents/schemas.ts`
- Create: `src/agents/analyst.ts`
- Test: `src/agents/analyst.test.ts`

**Interfaces:**
- Consumes: `runClaudeAgent`, `extractClaudeResultText`, `parseJsonBlock` from `src/claudeAgent.ts` (Task 3).
- Produces: from `src/agents/schemas.ts`: `AnalystOutputSchema`/`AnalystOutput`, `ArchitectOutputSchema`/`ArchitectOutput`, `DeveloperOutputSchema`/`DeveloperOutput`, `QAFindingSchema`/`QAFinding`, `QAOutputSchema`/`QAOutput` (all four schemas are defined here even though only Analyst is consumed in this task, since Tasks 9–11 import them). From `src/agents/analyst.ts`: `export function buildAnalystPrompt(ideaText: string): string` and `export async function runAnalystAgent(ideaText: string, cwd: string): Promise<AnalystOutput>`.

- [ ] **Step 1: Write the schemas**

```ts
// src/agents/schemas.ts
import { z } from "zod";

export const AnalystOutputSchema = z.object({
  summary: z.string(),
  goals: z.array(z.string()),
  keyFeatures: z.array(z.string()),
  nonGoals: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

export const ArchitectOutputSchema = z.object({
  issueTitle: z.string(),
  issueBody: z.string(),
  branchName: z.string(),
});
export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;

export const DeveloperOutputSchema = z.object({
  prTitle: z.string(),
  prBody: z.string(),
});
export type DeveloperOutput = z.infer<typeof DeveloperOutputSchema>;

export const QAFindingSchema = z.object({
  severity: z.enum(["info", "minor", "major", "critical"]),
  category: z.string(),
  summary: z.string(),
  file: z.string(),
  line: z.number(),
});
export type QAFinding = z.infer<typeof QAFindingSchema>;

export const QAOutputSchema = z.object({
  verdict: z.enum(["pass", "block"]),
  findings: z.array(QAFindingSchema),
});
export type QAOutput = z.infer<typeof QAOutputSchema>;
```

- [ ] **Step 2: Write the failing test for the Analyst agent**

```ts
// src/agents/analyst.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildAnalystPrompt, runAnalystAgent } from "./analyst.js";

const fakeAnalystJson = {
  summary: "A todo app",
  goals: ["let users track tasks"],
  keyFeatures: ["add task", "mark done"],
  nonGoals: ["auth"],
  openQuestions: [],
};

describe("buildAnalystPrompt", () => {
  it("includes the idea text and the expected output shape", () => {
    const prompt = buildAnalystPrompt("Build a todo app");
    expect(prompt).toContain("Build a todo app");
    expect(prompt).toContain("openQuestions");
  });
});

describe("runAnalystAgent", () => {
  it("returns the parsed analyst output from the claude -p result", async () => {
    const rawOutput = JSON.stringify({
      result: `Some explanation.\n\`\`\`json\n${JSON.stringify(fakeAnalystJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runAnalystAgent("Build a todo app", "/tmp/work");

    expect(result).toEqual(fakeAnalystJson);
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Build a todo app"),
      cwd: "/tmp/work",
      allowedTools: [],
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/agents/analyst.test.ts`
Expected: FAIL — `src/agents/analyst.ts` does not exist yet.

- [ ] **Step 4: Implement the Analyst agent**

```ts
// src/agents/analyst.ts
import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { AnalystOutputSchema, type AnalystOutput } from "./schemas.js";

export function buildAnalystPrompt(ideaText: string): string {
  return [
    "You are the Analyst stage of an idea-to-MVP pipeline.",
    "Read the following idea/brief and produce a structured understanding of it.",
    "Do not ask clarifying questions back - note any ambiguity in openQuestions instead.",
    "",
    "IDEA:",
    ideaText,
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"summary": string, "goals": string[], "keyFeatures": string[], "nonGoals": string[], "openQuestions": string[]}',
    "```",
  ].join("\n");
}

export async function runAnalystAgent(ideaText: string, cwd: string): Promise<AnalystOutput> {
  const prompt = buildAnalystPrompt(ideaText);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [] });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, AnalystOutputSchema);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/agents/analyst.test.ts`
Expected: PASS (both cases)

- [ ] **Step 6: Commit**

```bash
git add src/agents/schemas.ts src/agents/analyst.ts src/agents/analyst.test.ts
git commit -m "feat: agent output schemas and Analyst agent"
```

---

## Task 9: Architect agent

**Files:**
- Create: `src/agents/architect.ts`
- Test: `src/agents/architect.test.ts`

**Interfaces:**
- Consumes: `AnalystOutput`, `ArchitectOutputSchema`/`ArchitectOutput` from `src/agents/schemas.ts` (Task 8); `runClaudeAgent`, `extractClaudeResultText`, `parseJsonBlock` from `src/claudeAgent.ts` (Task 3).
- Produces: `export function buildArchitectPrompt(analystOutput: AnalystOutput): string` and `export async function runArchitectAgent(analystOutput: AnalystOutput, cwd: string): Promise<ArchitectOutput>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/agents/architect.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildArchitectPrompt, runArchitectAgent } from "./architect.js";
import type { AnalystOutput } from "./schemas.js";

const analystOutput: AnalystOutput = {
  summary: "A todo app",
  goals: ["let users track tasks"],
  keyFeatures: ["add task", "mark done"],
  nonGoals: ["auth"],
  openQuestions: [],
};

const fakeArchitectJson = {
  issueTitle: "Add task tracking",
  issueBody: "Implement add/complete task endpoints and a simple UI.",
  branchName: "feature/task-tracking",
};

describe("buildArchitectPrompt", () => {
  it("includes the analyst output and the expected output shape", () => {
    const prompt = buildArchitectPrompt(analystOutput);
    expect(prompt).toContain("A todo app");
    expect(prompt).toContain("branchName");
  });
});

describe("runArchitectAgent", () => {
  it("returns the parsed architect output from the claude -p result", async () => {
    const rawOutput = JSON.stringify({
      result: `Plan below.\n\`\`\`json\n${JSON.stringify(fakeArchitectJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runArchitectAgent(analystOutput, "/tmp/work");

    expect(result).toEqual(fakeArchitectJson);
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("A todo app"),
      cwd: "/tmp/work",
      allowedTools: [],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agents/architect.test.ts`
Expected: FAIL — `src/agents/architect.ts` does not exist yet.

- [ ] **Step 3: Implement the Architect agent**

```ts
// src/agents/architect.ts
import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { ArchitectOutputSchema, type AnalystOutput, type ArchitectOutput } from "./schemas.js";

export function buildArchitectPrompt(analystOutput: AnalystOutput): string {
  return [
    "You are the Architect stage of an idea-to-MVP pipeline.",
    "The app will be built inside a fixed Node/Express starter template with this layout:",
    "- package.json (Express dependency, `npm start` runs server.js)",
    "- server.js (a single Express app listening on process.env.PORT)",
    "- README.md",
    "",
    "Given the following structured understanding of the idea, produce a concrete implementation plan for the Developer agent.",
    "",
    JSON.stringify(analystOutput, null, 2),
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"issueTitle": string, "issueBody": string, "branchName": string}',
    "```",
  ].join("\n");
}

export async function runArchitectAgent(analystOutput: AnalystOutput, cwd: string): Promise<ArchitectOutput> {
  const prompt = buildArchitectPrompt(analystOutput);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [] });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, ArchitectOutputSchema);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/agents/architect.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Commit**

```bash
git add src/agents/architect.ts src/agents/architect.test.ts
git commit -m "feat: Architect agent"
```

---

## Task 10: Developer agent

**Files:**
- Create: `src/agents/developer.ts`
- Test: `src/agents/developer.test.ts`

**Interfaces:**
- Consumes: `DeveloperOutputSchema`/`DeveloperOutput` from `src/agents/schemas.ts` (Task 8); `runClaudeAgent`, `extractClaudeResultText`, `parseJsonBlock` from `src/claudeAgent.ts` (Task 3).
- Produces: `export function buildDeveloperPrompt(issueBody: string): string` and `export async function runDeveloperAgent(issueBody: string, cwd: string): Promise<DeveloperOutput>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/agents/developer.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildDeveloperPrompt, runDeveloperAgent } from "./developer.js";

const fakeDeveloperJson = {
  prTitle: "Add task tracking",
  prBody: "Implemented add/complete task endpoints.",
};

describe("buildDeveloperPrompt", () => {
  it("includes the issue body and instructs the agent not to open a PR itself", () => {
    const prompt = buildDeveloperPrompt("Implement add/complete task endpoints.");
    expect(prompt).toContain("Implement add/complete task endpoints.");
    expect(prompt).toContain("Do not open a pull request yourself");
  });
});

describe("runDeveloperAgent", () => {
  it("runs with file and bash tools enabled and returns the parsed output", async () => {
    const rawOutput = JSON.stringify({
      result: `Done.\n\`\`\`json\n${JSON.stringify(fakeDeveloperJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runDeveloperAgent("Implement add/complete task endpoints.", "/tmp/work");

    expect(result).toEqual(fakeDeveloperJson);
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Implement add/complete task endpoints."),
      cwd: "/tmp/work",
      allowedTools: ["Bash", "Read", "Write", "Edit"],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agents/developer.test.ts`
Expected: FAIL — `src/agents/developer.ts` does not exist yet.

- [ ] **Step 3: Implement the Developer agent**

```ts
// src/agents/developer.ts
import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { DeveloperOutputSchema, type DeveloperOutput } from "./schemas.js";

export function buildDeveloperPrompt(issueBody: string): string {
  return [
    "You are the Developer stage of an idea-to-MVP pipeline.",
    "You are working in a git checkout of the app repository, on a fresh branch.",
    "Implement the following plan by editing files, then commit and push your branch to origin.",
    "Do not open a pull request yourself - that is handled outside this agent.",
    "",
    "PLAN:",
    issueBody,
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"prTitle": string, "prBody": string}',
    "```",
  ].join("\n");
}

export async function runDeveloperAgent(issueBody: string, cwd: string): Promise<DeveloperOutput> {
  const prompt = buildDeveloperPrompt(issueBody);
  const rawOutput = await runClaudeAgent({
    prompt,
    cwd,
    allowedTools: ["Bash", "Read", "Write", "Edit"],
  });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, DeveloperOutputSchema);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/agents/developer.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Commit**

```bash
git add src/agents/developer.ts src/agents/developer.test.ts
git commit -m "feat: Developer agent"
```

---

## Task 11: QA agent

**Files:**
- Create: `src/agents/qa.ts`
- Test: `src/agents/qa.test.ts`

**Interfaces:**
- Consumes: `QAOutputSchema`/`QAOutput` from `src/agents/schemas.ts` (Task 8); `runClaudeAgent`, `extractClaudeResultText`, `parseJsonBlock` from `src/claudeAgent.ts` (Task 3).
- Produces: `export function buildQaPrompt(diff: string): string` and `export async function runQaAgent(diff: string, cwd: string): Promise<QAOutput>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/agents/qa.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildQaPrompt, runQaAgent } from "./qa.js";

const fakeQaJson = {
  verdict: "pass",
  findings: [
    { severity: "minor", category: "style", summary: "inconsistent quotes", file: "server.js", line: 4 },
  ],
};

describe("buildQaPrompt", () => {
  it("includes the diff and instructs conservative use of critical severity", () => {
    const prompt = buildQaPrompt("diff --git a/server.js b/server.js");
    expect(prompt).toContain("diff --git a/server.js b/server.js");
    expect(prompt).toContain("be conservative");
  });
});

describe("runQaAgent", () => {
  it("runs with read-only tools and returns the parsed verdict and findings", async () => {
    const rawOutput = JSON.stringify({
      result: `Reviewed.\n\`\`\`json\n${JSON.stringify(fakeQaJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runQaAgent("diff --git a/server.js b/server.js", "/tmp/work");

    expect(result).toEqual(fakeQaJson);
    expect(runClaudeAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("diff --git a/server.js b/server.js"),
      cwd: "/tmp/work",
      allowedTools: ["Read"],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agents/qa.test.ts`
Expected: FAIL — `src/agents/qa.ts` does not exist yet.

- [ ] **Step 3: Implement the QA agent**

```ts
// src/agents/qa.ts
import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { QAOutputSchema, type QAOutput } from "./schemas.js";

export function buildQaPrompt(diff: string): string {
  return [
    "You are the QA stage of an idea-to-MVP pipeline.",
    "Review the following pull request diff for correctness and security issues.",
    'Only use severity "critical" for issues that would break the app or introduce a serious vulnerability - be conservative, this decides whether the app ships.',
    "",
    "DIFF:",
    diff,
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"verdict": "pass"|"block", "findings": [{"severity": "info"|"minor"|"major"|"critical", "category": string, "summary": string, "file": string, "line": number}]}',
    "```",
  ].join("\n");
}

export async function runQaAgent(diff: string, cwd: string): Promise<QAOutput> {
  const prompt = buildQaPrompt(diff);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: ["Read"] });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, QAOutputSchema);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/agents/qa.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Commit**

```bash
git add src/agents/qa.ts src/agents/qa.test.ts
git commit -m "feat: QA agent"
```

---

## Task 12: Orchestrator

**Files:**
- Create: `src/orchestrator/runOrchestrator.ts`
- Test: `src/orchestrator/runOrchestrator.test.ts`

**Interfaces:**
- Consumes: `RunEventBus`, `StageName` from `src/orchestrator/events.ts`/`types.ts` (Task 2); `GithubClient` from `src/github/client.ts` (Task 6); `RenderClient` from `src/deploy/render.ts` (Task 7); `cloneRepo`, `createAndCheckoutBranch`, `pushBranch`, `diffAgainstBase` from `src/git.ts` (Task 5); `readStarterFiles` from `src/github/readStarterFiles.ts` (Task 4); `runAnalystAgent`, `runArchitectAgent`, `runDeveloperAgent`, `runQaAgent` from Tasks 8–11; `QAFinding` from `src/agents/schemas.ts` (Task 8).
- Produces: `export interface OrchestratorParams { ideaText: string; owner: string; repoName: string; starterDir: string; workDir: string }`, `export interface OrchestratorDeps { eventBus: RunEventBus; github: GithubClient; render: RenderClient; git: { cloneRepo, createAndCheckoutBranch, pushBranch, diffAgainstBase }; agents: { analyst, architect, developer, qa }; readStarterFiles: typeof readStarterFiles }`, `export type RunOutcome = { status: "deployed"; url: string; prUrl: string } | { status: "blocked"; findings: QAFinding[]; prUrl: string } | { status: "failed"; stage: StageName; error: string }`, and `export async function runOrchestrator(params: OrchestratorParams, deps: OrchestratorDeps): Promise<RunOutcome>`. Task 14 (CLI) consumes this function directly.

- [ ] **Step 1: Write the failing tests**

```ts
// src/orchestrator/runOrchestrator.test.ts
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "./events.js";
import { runOrchestrator, type OrchestratorDeps, type OrchestratorParams } from "./runOrchestrator.js";

const params: OrchestratorParams = {
  ideaText: "Build a todo app",
  owner: "org",
  repoName: "idea-to-mvp-app-1",
  starterDir: "/templates/starter",
  workDir: "/tmp/work",
};

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const github = {
    createRepoFromStarter: vi.fn().mockResolvedValue({
      owner: "org",
      repo: "idea-to-mvp-app-1",
      htmlUrl: "https://github.com/org/idea-to-mvp-app-1",
      cloneUrl: "https://github.com/org/idea-to-mvp-app-1.git",
    }),
    createIssue: vi.fn().mockResolvedValue({ number: 1 }),
    createPullRequest: vi.fn().mockResolvedValue({
      number: 2,
      htmlUrl: "https://github.com/org/idea-to-mvp-app-1/pull/2",
    }),
    postPrComment: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
  };
  const render = {
    createService: vi.fn().mockResolvedValue({ serviceId: "srv-1" }),
    waitForLive: vi.fn().mockResolvedValue({ url: "https://idea-to-mvp-app-1.onrender.com" }),
  };
  const git = {
    cloneRepo: vi.fn().mockResolvedValue(undefined),
    createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    diffAgainstBase: vi.fn().mockResolvedValue("diff --git a/server.js b/server.js"),
  };
  const agents = {
    analyst: vi.fn().mockResolvedValue({
      summary: "A todo app",
      goals: [],
      keyFeatures: [],
      nonGoals: [],
      openQuestions: [],
    }),
    architect: vi.fn().mockResolvedValue({
      issueTitle: "Add task tracking",
      issueBody: "Implement it",
      branchName: "feature/x",
    }),
    developer: vi.fn().mockResolvedValue({ prTitle: "Add task tracking", prBody: "Done" }),
    qa: vi.fn().mockResolvedValue({ verdict: "pass", findings: [] }),
  };

  return {
    eventBus: new RunEventBus(),
    github: github as never,
    render: render as never,
    git: git as never,
    agents: agents as never,
    readStarterFiles: vi.fn().mockReturnValue([{ path: "package.json", content: "{}" }]),
    ...overrides,
  };
}

describe("runOrchestrator", () => {
  it("runs every stage and deploys when QA passes with no critical findings", async () => {
    const deps = makeDeps();
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({
      status: "deployed",
      url: "https://idea-to-mvp-app-1.onrender.com",
      prUrl: "https://github.com/org/idea-to-mvp-app-1/pull/2",
    });
    expect(deps.github.mergePullRequest).toHaveBeenCalledWith("org", "idea-to-mvp-app-1", 2);
    expect(deps.render.createService).toHaveBeenCalledWith({
      name: "idea-to-mvp-app-1",
      repoUrl: "https://github.com/org/idea-to-mvp-app-1",
      branch: "main",
    });
    expect(events).toEqual([
      "create_repo:running",
      "create_repo:done",
      "analyst:running",
      "analyst:done",
      "architect:running",
      "architect:done",
      "open_issue:running",
      "open_issue:done",
      "developer:running",
      "developer:done",
      "open_pr:running",
      "open_pr:done",
      "qa:running",
      "qa:done",
      "post_review:running",
      "post_review:done",
      "merge:running",
      "merge:done",
      "deploy:running",
      "deploy:done",
    ]);
  });

  it("blocks before merging or deploying when QA reports a critical finding", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.qa).mockResolvedValue({
      verdict: "block",
      findings: [
        { severity: "critical", category: "security", summary: "SQL injection", file: "server.js", line: 10 },
      ],
    });

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("blocked");
    expect(deps.github.mergePullRequest).not.toHaveBeenCalled();
    expect(deps.render.createService).not.toHaveBeenCalled();
  });

  it("reports a failed outcome at the stage that threw", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockRejectedValue(new Error("claude -p crashed"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "developer", error: "claude -p crashed" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts`
Expected: FAIL — `src/orchestrator/runOrchestrator.ts` does not exist yet.

- [ ] **Step 3: Implement the orchestrator**

```ts
// src/orchestrator/runOrchestrator.ts
import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "../git.js";
import type { runAnalystAgent } from "../agents/analyst.js";
import type { runArchitectAgent } from "../agents/architect.js";
import type { runDeveloperAgent } from "../agents/developer.js";
import type { runQaAgent } from "../agents/qa.js";
import type { QAFinding, QAOutput } from "../agents/schemas.js";
import type { RenderClient } from "../deploy/render.js";
import { RunEventBus } from "./events.js";
import type { RunEvent, StageName } from "./types.js";

export interface OrchestratorParams {
  ideaText: string;
  owner: string;
  repoName: string;
  starterDir: string;
  workDir: string;
}

export interface OrchestratorDeps {
  eventBus: RunEventBus;
  github: GithubClient;
  render: RenderClient;
  git: {
    cloneRepo: typeof cloneRepo;
    createAndCheckoutBranch: typeof createAndCheckoutBranch;
    pushBranch: typeof pushBranch;
    diffAgainstBase: typeof diffAgainstBase;
  };
  agents: {
    analyst: typeof runAnalystAgent;
    architect: typeof runArchitectAgent;
    developer: typeof runDeveloperAgent;
    qa: typeof runQaAgent;
  };
  readStarterFiles: typeof ReadStarterFiles;
}

export type RunOutcome =
  | { status: "deployed"; url: string; prUrl: string }
  | { status: "blocked"; findings: QAFinding[]; prUrl: string }
  | { status: "failed"; stage: StageName; error: string };

const BASE_BRANCH = "main";

function stageEvent(stage: StageName, status: RunEvent["status"], message: string): RunEvent {
  return { stage, status, message, timestamp: new Date().toISOString() };
}

function formatQaComment(qa: QAOutput): string {
  if (qa.findings.length === 0) {
    return `QA review: ${qa.verdict}. No findings.`;
  }
  const lines = qa.findings.map(
    (f) => `- **${f.severity}** [${f.category}] ${f.file}:${f.line} - ${f.summary}`,
  );
  return [`QA review: ${qa.verdict}`, "", ...lines].join("\n");
}

export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
): Promise<RunOutcome> {
  const { eventBus, github, render, git, agents, readStarterFiles } = deps;
  let currentStage: StageName = "create_repo";

  try {
    eventBus.emit(stageEvent(currentStage, "running", "Creating GitHub repo from starter template"));
    const starterFiles = readStarterFiles(params.starterDir);
    const repo = await github.createRepoFromStarter({
      owner: params.owner,
      repoName: params.repoName,
      starterFiles,
    });
    eventBus.emit(stageEvent(currentStage, "done", repo.htmlUrl));

    currentStage = "analyst";
    eventBus.emit(stageEvent(currentStage, "running", "Analyzing idea"));
    const analystOutput = await agents.analyst(params.ideaText, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", analystOutput.summary));

    currentStage = "architect";
    eventBus.emit(stageEvent(currentStage, "running", "Planning implementation"));
    const architectOutput = await agents.architect(analystOutput, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", architectOutput.issueTitle));

    currentStage = "open_issue";
    eventBus.emit(stageEvent(currentStage, "running", "Opening GitHub issue"));
    const issue = await github.createIssue(
      params.owner,
      params.repoName,
      architectOutput.issueTitle,
      architectOutput.issueBody,
    );
    eventBus.emit(stageEvent(currentStage, "done", `#${issue.number}`));

    currentStage = "developer";
    eventBus.emit(stageEvent(currentStage, "running", "Implementing the plan"));
    await git.cloneRepo(repo.cloneUrl, params.workDir);
    await git.createAndCheckoutBranch(params.workDir, architectOutput.branchName);
    const developerOutput = await agents.developer(architectOutput.issueBody, params.workDir);
    await git.pushBranch(params.workDir, architectOutput.branchName);
    eventBus.emit(stageEvent(currentStage, "done", developerOutput.prTitle));

    currentStage = "open_pr";
    eventBus.emit(stageEvent(currentStage, "running", "Opening pull request"));
    const pr = await github.createPullRequest({
      owner: params.owner,
      repo: params.repoName,
      title: developerOutput.prTitle,
      body: developerOutput.prBody,
      head: architectOutput.branchName,
      base: BASE_BRANCH,
      issueNumber: issue.number,
    });
    eventBus.emit(stageEvent(currentStage, "done", pr.htmlUrl));

    currentStage = "qa";
    eventBus.emit(stageEvent(currentStage, "running", "Reviewing the pull request"));
    const diff = await git.diffAgainstBase(params.workDir, BASE_BRANCH);
    const qaOutput = await agents.qa(diff, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", qaOutput.verdict));

    currentStage = "post_review";
    eventBus.emit(stageEvent(currentStage, "running", "Posting review comment"));
    await github.postPrComment(params.owner, params.repoName, pr.number, formatQaComment(qaOutput));
    eventBus.emit(stageEvent(currentStage, "done", ""));

    const hasCritical = qaOutput.findings.some((f) => f.severity === "critical");
    if (hasCritical) {
      eventBus.emit(stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped"));
      return { status: "blocked", findings: qaOutput.findings, prUrl: pr.htmlUrl };
    }

    currentStage = "merge";
    eventBus.emit(stageEvent(currentStage, "running", "Merging pull request"));
    await github.mergePullRequest(params.owner, params.repoName, pr.number);
    eventBus.emit(stageEvent(currentStage, "done", ""));

    currentStage = "deploy";
    eventBus.emit(stageEvent(currentStage, "running", "Deploying to Render"));
    const service = await render.createService({
      name: params.repoName,
      repoUrl: repo.htmlUrl,
      branch: BASE_BRANCH,
    });
    const live = await render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
    eventBus.emit(stageEvent(currentStage, "done", live.url));

    return { status: "deployed", url: live.url, prUrl: pr.htmlUrl };
  } catch (error) {
    const err = error as Error;
    eventBus.emit(stageEvent(currentStage, "failed", err.message));
    return { status: "failed", stage: currentStage, error: err.message };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts`
Expected: PASS (all 3 cases)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runOrchestrator.ts src/orchestrator/runOrchestrator.test.ts
git commit -m "feat: orchestrator ties stages together with critical-severity gate"
```

---

## Task 13: Dashboard server + static UI

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `public/index.html`
- Create: `public/dashboard.js`
- Test: `src/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `RunEventBus`, `RunEvent` from `src/orchestrator/events.ts`/`types.ts` (Task 2).
- Produces: `export function createEventsHandler(eventBus: RunEventBus): express.RequestHandler` and `export function createDashboardServer(eventBus: RunEventBus): express.Express`. Task 14 (CLI) consumes `createDashboardServer`.

- [ ] **Step 1: Write the failing test**

```ts
// src/dashboard/server.test.ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../orchestrator/events.js";
import type { RunEvent } from "../orchestrator/types.js";
import { createEventsHandler } from "./server.js";

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-06T00:00:00.000Z",
};

function makeFakeRes() {
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
  };
}

describe("createEventsHandler", () => {
  it("streams bus events to the response as SSE data lines", () => {
    const bus = new RunEventBus();
    const handler = createEventsHandler(bus);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    bus.emit(sampleEvent);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(sampleEvent)}\n\n`);
  });

  it("stops writing once the request closes", () => {
    const bus = new RunEventBus();
    const handler = createEventsHandler(bus);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    req.emit("close");
    bus.emit(sampleEvent);

    expect(res.write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: FAIL — `src/dashboard/server.ts` does not exist yet.

- [ ] **Step 3: Implement the dashboard server**

```ts
// src/dashboard/server.ts
import { fileURLToPath } from "node:url";
import express from "express";
import type { RunEventBus } from "../orchestrator/events.js";

export function createEventsHandler(eventBus: RunEventBus): express.RequestHandler {
  return (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const unsubscribe = eventBus.onEvent((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => unsubscribe());
  };
}

export function createDashboardServer(eventBus: RunEventBus): express.Express {
  const app = express();
  app.use(express.static(fileURLToPath(new URL("../../public", import.meta.url))));
  app.get("/events", createEventsHandler(eventBus));
  return app;
}
```

`public/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>idea-to-mvp</title>
  </head>
  <body>
    <h1>idea-to-mvp run</h1>
    <ul id="stages"></ul>
    <script src="/dashboard.js"></script>
  </body>
</html>
```

`public/dashboard.js`:
```js
const stageElements = new Map();
const list = document.getElementById("stages");
const source = new EventSource("/events");

source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  let item = stageElements.get(data.stage);
  if (!item) {
    item = document.createElement("li");
    stageElements.set(data.stage, item);
    list.appendChild(item);
  }
  item.textContent = `${data.stage}: ${data.status} - ${data.message}`;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts public/index.html public/dashboard.js
git commit -m "feat: local dashboard server with SSE stage stream"
```

---

## Task 14: CLI entry

**Files:**
- Create: `src/cli.ts`
- Test: `src/cli.test.ts`
- Modify: `package.json` (add `open` dependency — already listed in Task 1's `package.json`, so only `npm install` is needed here if it wasn't run yet)

**Interfaces:**
- Consumes: `loadConfig` from `src/config.ts` (Task 1); `RunEventBus` from `src/orchestrator/events.ts` (Task 2); `runOrchestrator` from `src/orchestrator/runOrchestrator.ts` (Task 12); `createDashboardServer` from `src/dashboard/server.ts` (Task 13); `GithubClient` from `src/github/client.ts` (Task 6); `RenderClient` from `src/deploy/render.ts` (Task 7); `readStarterFiles` from `src/github/readStarterFiles.ts` (Task 4); `cloneRepo`/`createAndCheckoutBranch`/`pushBranch`/`diffAgainstBase` from `src/git.ts` (Task 5); `runAnalystAgent`/`runArchitectAgent`/`runDeveloperAgent`/`runQaAgent` from Tasks 8–11.
- Produces: `export function parseArgs(argv: string[]): { ideaFilePath: string } | null` (unit tested directly); `main()` wires everything together and is exercised only by the manual demo (Task 15), per the spec's "mocked, no e2e" testing rule — a full run needs real `claude`, GitHub, and Render credentials.

- [ ] **Step 1: Write the failing test for argument parsing**

```ts
// src/cli.test.ts
import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";

describe("parseArgs", () => {
  it("returns the idea file path for `run <file>`", () => {
    expect(parseArgs(["node", "cli.js", "run", "idea.md"])).toEqual({ ideaFilePath: "idea.md" });
  });

  it("returns null when the command is missing", () => {
    expect(parseArgs(["node", "cli.js"])).toBeNull();
  });

  it("returns null when the command is not 'run'", () => {
    expect(parseArgs(["node", "cli.js", "bogus", "idea.md"])).toBeNull();
  });

  it("returns null when the idea file path is missing", () => {
    expect(parseArgs(["node", "cli.js", "run"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL — `src/cli.ts` does not exist yet.

- [ ] **Step 3: Implement the CLI**

```ts
#!/usr/bin/env node
// src/cli.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";
import open from "open";
import { runAnalystAgent } from "./agents/analyst.js";
import { runArchitectAgent } from "./agents/architect.js";
import { runDeveloperAgent } from "./agents/developer.js";
import { runQaAgent } from "./agents/qa.js";
import { loadConfig } from "./config.js";
import { createDashboardServer } from "./dashboard/server.js";
import { RenderClient } from "./deploy/render.js";
import { GithubClient } from "./github/client.js";
import { readStarterFiles } from "./github/readStarterFiles.js";
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "./git.js";
import { RunEventBus } from "./orchestrator/events.js";
import { runOrchestrator } from "./orchestrator/runOrchestrator.js";

export function parseArgs(argv: string[]): { ideaFilePath: string } | null {
  const [, , command, ideaFilePath] = argv;
  if (command !== "run" || !ideaFilePath) {
    return null;
  }
  return { ideaFilePath };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error("Usage: idea-to-mvp run <idea-file>");
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const ideaText = readFileSync(parsed.ideaFilePath, "utf-8");
  const repoName = `idea-to-mvp-${Date.now()}`;
  const workDir = mkdtempSync(join(tmpdir(), "idea-to-mvp-"));

  const eventBus = new RunEventBus();
  eventBus.onEvent((event) => {
    console.log(`[${event.stage}] ${event.status}: ${event.message}`);
  });

  const app = createDashboardServer(eventBus);
  app.listen(config.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
  });
  await open(`http://localhost:${config.port}`);

  const octokit = new Octokit({ auth: config.githubToken });
  const outcome = await runOrchestrator(
    {
      ideaText,
      owner: config.targetGithubOwner,
      repoName,
      starterDir: fileURLToPath(new URL("../templates/starter", import.meta.url)),
      workDir,
    },
    {
      eventBus,
      github: new GithubClient(octokit),
      render: new RenderClient(config.renderApiKey),
      git: { cloneRepo, createAndCheckoutBranch, pushBranch, diffAgainstBase },
      agents: {
        analyst: runAnalystAgent,
        architect: runArchitectAgent,
        developer: runDeveloperAgent,
        qa: runQaAgent,
      },
      readStarterFiles,
    },
  );

  if (outcome.status === "deployed") {
    console.log(`Live at ${outcome.url}`);
  } else if (outcome.status === "blocked") {
    console.log(`Blocked by QA - see ${outcome.prUrl}`);
  } else {
    console.error(`Failed at stage ${outcome.stage}: ${outcome.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run the test to verify it passes, then verify the full build**

Run: `npx vitest run src/cli.test.ts`
Expected: PASS (all 4 cases)

Run: `npm run build`
Expected: compiles cleanly; `dist/cli.js` exists and starts with the shebang line.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: CLI entry wiring config, agents, orchestrator and dashboard together"
```

---

## Task 15: README and manual demo

**Files:**
- Create: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the README**

```md
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and manual demo instructions"
```
