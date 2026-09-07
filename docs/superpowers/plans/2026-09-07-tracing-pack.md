# Tracing Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the real input/output of every pipeline stage (not just a
short message), surface it live in the dashboard, and commit it as
`TRACING_PACK.md` into the target repo at the end of each run.

**Architecture:** `RunEvent` gains optional `input`/`output` fields;
`runOrchestrator` attaches the actual typed values it already has in scope
to each stage's `running`/`done` events and accumulates them into a
`TracingPackEntry[]`; a new pure `formatTracingPackMarkdown()` turns that
into a Markdown doc that a new `GithubClient.commitFile()` pushes to the
target repo's `main` branch as a new final `"tracing_pack"` stage. The
dashboard's `StageDetailSheet` renders `input`/`output` when present,
using the same SSE feed it already has.

**Tech Stack:** TypeScript / Node 20+ / npm / Vitest (backend); Vite /
React 19 / TypeScript / Vitest + React Testing Library (`web/`).

**Spec:** `docs/superpowers/specs/2026-09-07-tracing-pack-design.md`

## Global Constraints

- No new agent calls or LLM round-trips — every input/output value comes
  from a variable already in scope inside `runOrchestrator`.
- One tracing pack commit per run, at the very end (deployed / blocked /
  failed-with-repo-created) — never per-stage, never if `create_repo`
  itself failed (no repo to commit to).
- `TRACING_PACK.md` is a new, independent file committed straight to
  `main` — it must never touch paths the PR's own diff touches.
- Backend (`src/**`) and web (`web/src/**`) each keep their own
  `RunEvent`/`StageName` type definitions in sync by hand (existing
  convention — see `web/src/types.ts`'s header comment); this plan updates
  both.

---

### Task 1: Tracing pack Markdown formatter

**Files:**
- Create: `src/orchestrator/tracingPack.ts`
- Test: `src/orchestrator/tracingPack.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports from other new code).
- Produces: `TracingPackEntry` type and `formatTracingPackMarkdown(entries:
  TracingPackEntry[], outcome: string): string`, both imported by Task 3
  (`runOrchestrator.ts`).

```ts
export interface TracingPackEntry {
  stage: StageName;
  status: StageStatus;
  input?: unknown;
  output?: unknown;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/orchestrator/tracingPack.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTracingPackMarkdown, type TracingPackEntry } from "./tracingPack.js";

describe("formatTracingPackMarkdown", () => {
  it("renders one section per entry with input/output as fenced JSON", () => {
    const entries: TracingPackEntry[] = [
      {
        stage: "analyst",
        status: "done",
        input: { ideaText: "Build a todo app" },
        output: { summary: "A todo app" },
      },
    ];

    const markdown = formatTracingPackMarkdown(entries, "deployed");

    expect(markdown).toContain("# Tracing Pack");
    expect(markdown).toContain("Outcome: **deployed**");
    expect(markdown).toContain("## analyst");
    expect(markdown).toContain("Status: `done`");
    expect(markdown).toContain('"ideaText": "Build a todo app"');
    expect(markdown).toContain('"summary": "A todo app"');
  });

  it("renders _none_ for a field that has no value yet", () => {
    const entries: TracingPackEntry[] = [
      { stage: "deploy", status: "running", input: { name: "app-1" } },
    ];

    const markdown = formatTracingPackMarkdown(entries, "failed");

    expect(markdown).toContain("**Output**\n\n_none_");
  });

  it("renders an empty tracing pack when there are no entries", () => {
    const markdown = formatTracingPackMarkdown([], "failed");

    expect(markdown).toContain("# Tracing Pack");
    expect(markdown).toContain("Outcome: **failed**");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/tracingPack.test.ts`
Expected: FAIL — `Cannot find module './tracingPack.js'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/orchestrator/tracingPack.ts`:

```ts
import type { StageName, StageStatus } from "./types.js";

export interface TracingPackEntry {
  stage: StageName;
  status: StageStatus;
  input?: unknown;
  output?: unknown;
}

function renderField(label: string, value: unknown): string {
  if (value === undefined) {
    return `**${label}**\n\n_none_`;
  }
  return `**${label}**\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function renderEntry(entry: TracingPackEntry): string {
  return [
    `## ${entry.stage}`,
    "",
    `Status: \`${entry.status}\``,
    "",
    renderField("Input", entry.input),
    "",
    renderField("Output", entry.output),
  ].join("\n");
}

export function formatTracingPackMarkdown(entries: TracingPackEntry[], outcome: string): string {
  return [
    "# Tracing Pack",
    "",
    `Outcome: **${outcome}**`,
    "",
    "Generated by the idea-to-mvp pipeline. One section per stage, showing exactly what was read (Input) and produced (Output).",
    "",
    ...entries.map(renderEntry),
  ].join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/orchestrator/tracingPack.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/tracingPack.ts src/orchestrator/tracingPack.test.ts
git commit -m "feat: add tracing pack Markdown formatter"
```

---

### Task 2: `GithubClient.commitFile()`

**Files:**
- Modify: `src/github/client.ts`
- Modify: `src/github/client.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses the existing `Octokit` instance already
  injected into `GithubClient`.
- Produces: `commitFile(owner: string, repo: string, path: string,
  content: string, branch: string): Promise<{ sha: string }>`, called by
  Task 3 (`runOrchestrator.ts`, via `deps.github.commitFile`).

- [ ] **Step 1: Write the failing test**

In `src/github/client.test.ts`, add this `it` inside the existing
`describe("GithubClient", ...)` block (after the `mergePullRequest` test):

```ts
  it("commitFile commits the given content to the given branch", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.createOrUpdateFileContents.mockResolvedValue({
      data: { content: { sha: "abc123" } },
    });
    const client = new GithubClient(octokit as never);

    const result = await client.commitFile("org", "repo", "TRACING_PACK.md", "# Tracing Pack", "main");

    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      path: "TRACING_PACK.md",
      message: "chore: add TRACING_PACK.md",
      content: Buffer.from("# Tracing Pack", "utf-8").toString("base64"),
      branch: "main",
    });
    expect(result).toEqual({ sha: "abc123" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/client.test.ts`
Expected: FAIL — `client.commitFile is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/github/client.ts`, add this method to the `GithubClient` class
(after `mergePullRequest`):

```ts
  async commitFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    branch: string,
  ): Promise<{ sha: string }> {
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `chore: add ${path}`,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch,
    });
    return { sha: (data as { content?: { sha?: string } }).content?.sha ?? "" };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/github/client.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/github/client.ts src/github/client.test.ts
git commit -m "feat: add GithubClient.commitFile for committing the tracing pack"
```

---

### Task 3: Wire input/output capture and the tracing pack commit into the orchestrator

**Files:**
- Modify: `src/orchestrator/types.ts`
- Modify: `src/orchestrator/runOrchestrator.ts`
- Modify: `src/orchestrator/runOrchestrator.test.ts`

**Interfaces:**
- Consumes: `formatTracingPackMarkdown`/`TracingPackEntry` (Task 1),
  `GithubClient.commitFile` (Task 2, available automatically since
  `OrchestratorDeps.github` is typed as `GithubClient`).
- Produces: `RunEvent` now carries `input?: unknown` / `output?: unknown`;
  `StageName` gains `"tracing_pack"`. Both are consumed by Task 4/5 (the
  web app has its own mirrored copy).

- [ ] **Step 1: Update the shared event type**

Replace the full contents of `src/orchestrator/types.ts`:

```ts
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
  | "deploy"
  | "tracing_pack";

export type StageStatus = "running" | "done" | "failed" | "blocked";

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;
  output?: unknown;
}
```

- [ ] **Step 2: Write the failing tests**

Replace the full contents of `src/orchestrator/runOrchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "./events.js";
import { runOrchestrator, type OrchestratorDeps, type OrchestratorParams } from "./runOrchestrator.js";
import type { RunEvent } from "./types.js";

const params: OrchestratorParams = {
  ideaText: "Build a todo app",
  owner: "org",
  repoName: "idea-to-mvp-app-1",
  starterDir: "/templates/starter",
  workDir: "/tmp/work",
  githubToken: "test-token",
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
    commitFile: vi.fn().mockResolvedValue({ sha: "tracing-pack-sha" }),
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
  it("runs every stage, including the final tracing_pack stage, and deploys when QA passes", async () => {
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
      "tracing_pack:running",
      "tracing_pack:done",
    ]);
  });

  it("captures each stage's input and output on its events", async () => {
    const deps = makeDeps();
    const events: RunEvent[] = [];
    deps.eventBus.onEvent((event) => events.push(event));

    await runOrchestrator(params, deps);

    const analystRunning = events.find((e) => e.stage === "analyst" && e.status === "running");
    const analystDone = events.find((e) => e.stage === "analyst" && e.status === "done");
    expect(analystRunning?.input).toEqual({ ideaText: "Build a todo app" });
    expect(analystDone?.output).toEqual({
      summary: "A todo app",
      goals: [],
      keyFeatures: [],
      nonGoals: [],
      openQuestions: [],
    });

    const createRepoDone = events.find((e) => e.stage === "create_repo" && e.status === "done");
    expect(createRepoDone?.output).toEqual({
      htmlUrl: "https://github.com/org/idea-to-mvp-app-1",
      cloneUrl: "https://github.com/org/idea-to-mvp-app-1.git",
    });

    const qaDone = events.find((e) => e.stage === "qa" && e.status === "done");
    expect(qaDone?.output).toEqual({ verdict: "pass", findings: [] });
  });

  it("commits a TRACING_PACK.md to the repo's main branch after a deployed run", async () => {
    const deps = makeDeps();

    await runOrchestrator(params, deps);

    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [owner, repo, path, content, branch] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(owner).toBe("org");
    expect(repo).toBe("idea-to-mvp-app-1");
    expect(path).toBe("TRACING_PACK.md");
    expect(branch).toBe("main");
    expect(content).toContain("Outcome: **deployed**");
    expect(content).toContain("## create_repo");
    expect(content).toContain("## deploy");
  });

  it("blocks before merging or deploying when QA reports a critical finding, and still commits a partial tracing pack", async () => {
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
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(content).toContain("Outcome: **blocked**");
    expect(content).not.toContain("## deploy");
  });

  it("reports a failed outcome at the stage that threw, and still commits a tracing pack for the repo that exists", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockRejectedValue(new Error("claude -p crashed"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "developer", error: "claude -p crashed" });
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(content).toContain("Outcome: **failed**");
    expect(content).toContain("## developer");
  });

  it("does not commit a tracing pack when the repo itself was never created", async () => {
    const deps = makeDeps();
    vi.mocked(deps.github.createRepoFromStarter).mockRejectedValue(new Error("repo already exists"));

    const outcome = await runOrchestrator(params, deps);

    expect(outcome).toEqual({ status: "failed", stage: "create_repo", error: "repo already exists" });
    expect(deps.github.commitFile).not.toHaveBeenCalled();
  });

  it("proceeds through merge and deploy when QA findings are present but none are critical", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.qa).mockResolvedValue({
      verdict: "pass",
      findings: [
        { severity: "major", category: "correctness", summary: "off-by-one in pagination", file: "server.js", line: 22 },
      ],
    });

    const outcome = await runOrchestrator(params, deps);

    expect(outcome.status).toBe("deployed");
    expect(deps.github.mergePullRequest).toHaveBeenCalledWith("org", "idea-to-mvp-app-1", 2);
    expect(deps.render.createService).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts`
Expected: FAIL — the event-sequence assertion is missing `tracing_pack:*`,
`input`/`output` are `undefined` on captured events, and
`deps.github.commitFile` is never called (TypeScript will also flag the
test file once compiled, since `deps.github.commitFile` doesn't exist on
`GithubClient` until Task 2 — Task 2 must be done first for this to even
compile; if running this plan out of order, do Task 2 before this step).

- [ ] **Step 4: Write the implementation**

Replace the full contents of `src/orchestrator/runOrchestrator.ts`:

```ts
import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "../git.js";
import type { runAnalystAgent } from "../agents/analyst.js";
import type { runArchitectAgent } from "../agents/architect.js";
import type { runDeveloperAgent } from "../agents/developer.js";
import type { runQaAgent } from "../agents/qa.js";
import type { QAFinding, QAOutput } from "../agents/schemas.js";
import type { RenderClient } from "../deploy/render.js";
import { formatTracingPackMarkdown, type TracingPackEntry } from "./tracingPack.js";
import { RunEventBus } from "./events.js";
import type { RunEvent, StageName } from "./types.js";

export interface OrchestratorParams {
  ideaText: string;
  owner: string;
  repoName: string;
  starterDir: string;
  workDir: string;
  githubToken: string;
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
const TRACING_PACK_PATH = "TRACING_PACK.md";

function stageEvent(
  stage: StageName,
  status: RunEvent["status"],
  message: string,
  extra?: { input?: unknown; output?: unknown },
): RunEvent {
  return { stage, status, message, timestamp: new Date().toISOString(), ...extra };
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
  let currentInput: unknown;
  const tracingEntries: TracingPackEntry[] = [];
  let repo: Awaited<ReturnType<typeof github.createRepoFromStarter>> | undefined;

  async function commitTracingPack(outcome: string): Promise<void> {
    if (!repo) return;
    eventBus.emit(
      stageEvent("tracing_pack", "running", "Committing the tracing pack to the repo", {
        input: { path: TRACING_PACK_PATH },
      }),
    );
    try {
      const markdown = formatTracingPackMarkdown(tracingEntries, outcome);
      const result = await github.commitFile(params.owner, params.repoName, TRACING_PACK_PATH, markdown, BASE_BRANCH);
      eventBus.emit(
        stageEvent("tracing_pack", "done", TRACING_PACK_PATH, { output: { committed: true, sha: result.sha } }),
      );
    } catch (error) {
      const err = error as Error;
      eventBus.emit(stageEvent("tracing_pack", "failed", err.message));
    }
  }

  try {
    currentStage = "create_repo";
    const starterFiles = readStarterFiles(params.starterDir);
    currentInput = {
      owner: params.owner,
      repoName: params.repoName,
      starterFilePaths: starterFiles.map((f) => f.path),
    };
    eventBus.emit(stageEvent(currentStage, "running", "Creating GitHub repo from starter template", { input: currentInput }));
    repo = await github.createRepoFromStarter({
      owner: params.owner,
      repoName: params.repoName,
      starterFiles,
    });
    const createRepoOutput = { htmlUrl: repo.htmlUrl, cloneUrl: repo.cloneUrl };
    eventBus.emit(stageEvent(currentStage, "done", repo.htmlUrl, { output: createRepoOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: createRepoOutput });

    currentStage = "analyst";
    currentInput = { ideaText: params.ideaText };
    eventBus.emit(stageEvent(currentStage, "running", "Analyzing idea", { input: currentInput }));
    const analystOutput = await agents.analyst(params.ideaText, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", analystOutput.summary, { output: analystOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: analystOutput });

    currentStage = "architect";
    currentInput = { analystOutput };
    eventBus.emit(stageEvent(currentStage, "running", "Planning implementation", { input: currentInput }));
    const architectOutput = await agents.architect(analystOutput, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", architectOutput.issueTitle, { output: architectOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: architectOutput });

    currentStage = "open_issue";
    currentInput = { title: architectOutput.issueTitle, body: architectOutput.issueBody };
    eventBus.emit(stageEvent(currentStage, "running", "Opening GitHub issue", { input: currentInput }));
    const issue = await github.createIssue(
      params.owner,
      params.repoName,
      architectOutput.issueTitle,
      architectOutput.issueBody,
    );
    eventBus.emit(stageEvent(currentStage, "done", `#${issue.number}`, { output: issue }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: issue });

    currentStage = "developer";
    currentInput = { issueBody: architectOutput.issueBody };
    eventBus.emit(stageEvent(currentStage, "running", "Implementing the plan", { input: currentInput }));
    await git.cloneRepo(repo.cloneUrl, params.workDir, params.githubToken);
    await git.createAndCheckoutBranch(params.workDir, architectOutput.branchName);
    const developerOutput = await agents.developer(architectOutput.issueBody, params.workDir);
    await git.pushBranch(params.workDir, architectOutput.branchName, params.githubToken);
    eventBus.emit(stageEvent(currentStage, "done", developerOutput.prTitle, { output: developerOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: developerOutput });

    currentStage = "open_pr";
    currentInput = {
      title: developerOutput.prTitle,
      body: developerOutput.prBody,
      head: architectOutput.branchName,
      base: BASE_BRANCH,
    };
    eventBus.emit(stageEvent(currentStage, "running", "Opening pull request", { input: currentInput }));
    const pr = await github.createPullRequest({
      owner: params.owner,
      repo: params.repoName,
      title: developerOutput.prTitle,
      body: developerOutput.prBody,
      head: architectOutput.branchName,
      base: BASE_BRANCH,
      issueNumber: issue.number,
    });
    eventBus.emit(stageEvent(currentStage, "done", pr.htmlUrl, { output: pr }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: pr });

    currentStage = "qa";
    eventBus.emit(stageEvent(currentStage, "running", "Reviewing the pull request"));
    const diff = await git.diffAgainstBase(params.workDir, BASE_BRANCH);
    currentInput = { diff };
    const qaOutput = await agents.qa(diff, params.workDir);
    eventBus.emit(stageEvent(currentStage, "done", qaOutput.verdict, { output: qaOutput }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: qaOutput });

    currentStage = "post_review";
    const comment = formatQaComment(qaOutput);
    currentInput = { comment };
    eventBus.emit(stageEvent(currentStage, "running", "Posting review comment", { input: currentInput }));
    await github.postPrComment(params.owner, params.repoName, pr.number, comment);
    eventBus.emit(stageEvent(currentStage, "done", "posted", { output: { posted: true } }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: { posted: true } });

    const hasCritical = qaOutput.findings.some((f) => f.severity === "critical");
    if (hasCritical) {
      eventBus.emit(stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped"));
      tracingEntries.push({ stage: "merge", status: "blocked", output: { findings: qaOutput.findings } });
      await commitTracingPack("blocked");
      return { status: "blocked", findings: qaOutput.findings, prUrl: pr.htmlUrl };
    }

    currentStage = "merge";
    currentInput = { prNumber: pr.number };
    eventBus.emit(stageEvent(currentStage, "running", "Merging pull request", { input: currentInput }));
    await github.mergePullRequest(params.owner, params.repoName, pr.number);
    eventBus.emit(stageEvent(currentStage, "done", "merged", { output: { merged: true } }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: { merged: true } });

    currentStage = "deploy";
    currentInput = { name: params.repoName, repoUrl: repo.htmlUrl, branch: BASE_BRANCH };
    eventBus.emit(stageEvent(currentStage, "running", "Deploying to Render", { input: currentInput }));
    const service = await render.createService({
      name: params.repoName,
      repoUrl: repo.htmlUrl,
      branch: BASE_BRANCH,
    });
    const live = await render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
    eventBus.emit(stageEvent(currentStage, "done", live.url, { output: live }));
    tracingEntries.push({ stage: currentStage, status: "done", input: currentInput, output: live });

    await commitTracingPack("deployed");
    return { status: "deployed", url: live.url, prUrl: pr.htmlUrl };
  } catch (error) {
    const err = error as Error;
    eventBus.emit(stageEvent(currentStage, "failed", err.message));
    tracingEntries.push({ stage: currentStage, status: "failed", input: currentInput, output: err.message });
    await commitTracingPack("failed");
    return { status: "failed", stage: currentStage, error: err.message };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS (all backend suites, including `events.test.ts` and
`tracingPack.test.ts` from Task 1, unaffected by this change)

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/runOrchestrator.ts src/orchestrator/runOrchestrator.test.ts
git commit -m "feat: capture stage input/output and commit the tracing pack to the target repo"
```

---

### Task 4: Mirror the type change to the web app

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/components/WorkflowsView.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RunEvent.input`/`output`, `StageName` including
  `"tracing_pack"`, `STAGE_ORDER`/`STAGE_LABELS` including it — consumed
  by Task 5 (`StageDetailSheet`) and already consumed structurally by the
  existing `WorkflowsView`/`StageCard` (no code change needed there,
  since they already map over `STAGE_ORDER`).

- [ ] **Step 1: Write the failing test**

In `web/src/components/WorkflowsView.test.tsx`, change the first
assertion in `"renders a card for every pipeline stage"` from:

```ts
    expect(screen.getAllByRole("button")).toHaveLength(10);
```

to:

```ts
    expect(screen.getAllByRole("button")).toHaveLength(11);
    expect(screen.getByText("Tracing pack")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/WorkflowsView.test.tsx`
Expected: FAIL — 10 buttons found, "Tracing pack" text not present.

- [ ] **Step 3: Update the mirrored type**

In `web/src/types.ts`, apply these three changes:

Add `"tracing_pack"` to the `StageName` union (after `"deploy"`):

```ts
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
  | "deploy"
  | "tracing_pack";
```

Add `input`/`output` to `RunEvent`:

```ts
export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;
  output?: unknown;
}
```

Add `"tracing_pack"` to `STAGE_ORDER` and `STAGE_LABELS`:

```ts
export const STAGE_ORDER: StageName[] = [
  "create_repo",
  "analyst",
  "architect",
  "open_issue",
  "developer",
  "open_pr",
  "qa",
  "post_review",
  "merge",
  "deploy",
  "tracing_pack",
];

export const STAGE_LABELS: Record<StageName, string> = {
  create_repo: "Create repo",
  analyst: "Analyst",
  architect: "Architect",
  open_issue: "Open issue",
  developer: "Developer",
  open_pr: "Open PR",
  qa: "QA review",
  post_review: "Post review",
  merge: "Merge",
  deploy: "Deploy",
  tracing_pack: "Tracing pack",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/WorkflowsView.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full web suite**

Run: `npm run test:web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/components/WorkflowsView.test.tsx
git commit -m "feat: add tracing_pack stage and input/output fields to the web types"
```

---

### Task 5: Show input/output in the dashboard's stage detail sheet

**Files:**
- Modify: `web/src/components/StageDetailSheet.tsx`
- Create: `web/src/components/StageDetailSheet.test.tsx`

**Interfaces:**
- Consumes: `RunEvent.input`/`output` (Task 4).
- Produces: nothing consumed elsewhere — this is the final, leaf task.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/StageDetailSheet.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageDetailSheet } from "./StageDetailSheet";
import type { RunEvent } from "@/types";

const baseEvent: RunEvent = {
  stage: "analyst",
  status: "done",
  message: "A todo app",
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("StageDetailSheet", () => {
  it("renders input and output as pretty-printed JSON when present", () => {
    const events: RunEvent[] = [
      { ...baseEvent, input: { ideaText: "Build a todo app" }, output: { summary: "A todo app" } },
    ];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.getByText(/"ideaText": "Build a todo app"/)).toBeInTheDocument();
    expect(screen.getByText(/"summary": "A todo app"/)).toBeInTheDocument();
  });

  it("omits input/output sections when neither is present", () => {
    const events: RunEvent[] = [baseEvent];

    render(<StageDetailSheet label="Analyst" status="done" events={events} open onOpenChange={() => {}} />);

    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/StageDetailSheet.test.tsx`
Expected: FAIL — neither "Input" nor the JSON text is rendered yet.

- [ ] **Step 3: Write the implementation**

In `web/src/components/StageDetailSheet.tsx`, replace the `<li>` body
(the block rendering `event.message`) with a version that also renders
`input`/`output` when present:

```tsx
              {events.map((event, index) => (
                <li key={`${event.timestamp}-${index}`} className="rounded-lg bg-muted px-3 py-2">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{formatTime(event.timestamp)}</span>
                    <span className={STAGE_STATUS_CONFIG[event.status].dotClassName}>
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-foreground">{event.message}</p>
                  {event.input !== undefined && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Input
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-foreground">
                        {JSON.stringify(event.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {event.output !== undefined && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Output
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-foreground">
                        {JSON.stringify(event.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </li>
              ))}
```

The rest of the file (imports, props, the empty-state branch) is
unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/StageDetailSheet.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full web suite**

Run: `npm run test:web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/StageDetailSheet.tsx web/src/components/StageDetailSheet.test.tsx
git commit -m "feat: show stage input/output in the dashboard detail sheet"
```

---

## Final verification

After all 5 tasks:

- [ ] `npm test` — full backend suite passes
- [ ] `npm run test:web` — full web suite passes
- [ ] `npm run build` — both `tsc` (backend) and the web build succeed
      (catches any type mismatch between the two hand-mirrored
      `types.ts` files)
