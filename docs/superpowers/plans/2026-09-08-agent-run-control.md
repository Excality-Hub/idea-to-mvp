# Agent Run Control (Stop/Start/Resume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user stop the currently running LLM-driven agent stage (analyst/architect/developer/qa) from the dashboard, resume it later from where it stopped, and start brand-new runs — all from the UI.

**Architecture:** `runOrchestrator` is refactored from one linear `try` block into a loop over an ordered array of stage-step descriptors sharing a mutable `PipelineContext`, so it can start at an arbitrary stage index with a pre-populated context (resume) and accept an external `AbortSignal` that only the four agent stages honor (stop). A new `RunController` owns the lifecycle (start/stop/resume) of the one active run and the swappable `RunEventBus` behind it; the dashboard server exposes it over three POST endpoints, and the web UI gains Stop/Resume buttons on agent stage nodes plus an idle-state "start a run" form.

**Tech Stack:** TypeScript/Node (Express, Vitest) on the backend; React 19 + `@xyflow/react` + Vitest/Testing Library on the frontend. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-08-agent-run-control-design.md](../specs/2026-09-08-agent-run-control-design.md)

## Global Constraints

- No persistence across process restarts — all run/control state is in-memory for the life of the dashboard server process.
- Stop/Resume apply only to the 4 agent stages: `analyst`, `architect`, `developer`, `qa`. No other stage gets a control.
- "Start" always begins the pipeline at `create_repo`; there is no way to run an individual stage out of order.
- One active run at a time. Starting a new run replaces the previous run's state entirely.
- CLI behavior (`idea-to-mvp run <idea-file>`) is unchanged from the outside: it still auto-starts a run immediately and opens the dashboard.
- Resume re-runs the stopped stage's entire block from scratch (its git setup, if any, plus the agent call) — there is no finer-grained checkpointing.

---

## Task 1: `AgentStoppedError` and abort support in `runClaudeAgent`

**Files:**
- Modify: `src/claudeAgent.ts`
- Test: `src/claudeAgent.test.ts`

**Interfaces:**
- Produces: `export class AgentStoppedError extends Error` (name `"AgentStoppedError"`); `RunClaudeAgentParams` gains `signal?: AbortSignal`. `runClaudeAgent` rejects with `AgentStoppedError` (instead of spawning, or instead of the generic exit-code error) when the signal is already aborted or aborts mid-run.

- [ ] **Step 1: Write the failing tests**

Add to `src/claudeAgent.test.ts`, inside the existing `describe("runClaudeAgent", ...)` block (after the last `it`, before its closing `});`):

```ts
  it("rejects immediately with AgentStoppedError when the signal is already aborted, without spawning", async () => {
    const controller = new AbortController();
    controller.abort();

    const promise = runClaudeAgent({
      prompt: "do it",
      cwd: "/tmp/repo",
      allowedTools: [],
      signal: controller.signal,
    });

    await expect(promise).rejects.toThrow(AgentStoppedError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("kills the process and rejects with AgentStoppedError when the signal aborts mid-run", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const controller = new AbortController();

    const promise = runClaudeAgent({
      prompt: "do it",
      cwd: "/tmp/repo",
      allowedTools: [],
      signal: controller.signal,
    });
    controller.abort();
    child.emit("close", null);

    await expect(promise).rejects.toThrow(AgentStoppedError);
    expect(child.kill).toHaveBeenCalled();
  });
```

Update the import line at the top of the file to include the new export:

```ts
import {
  AgentStoppedError,
  CLAUDE_AGENT_TIMEOUT_MS,
  extractClaudeResultText,
  MAX_OUTPUT_BYTES,
  parseJsonBlock,
  runClaudeAgent,
} from "./claudeAgent.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- claudeAgent`
Expected: FAIL — `AgentStoppedError` is not exported yet (import error), and the two new cases don't pass.

- [ ] **Step 3: Implement `AgentStoppedError` and signal handling**

Replace the full contents of `src/claudeAgent.ts` with:

```ts
import { spawn } from "node:child_process";
import type { z } from "zod";

export interface RunClaudeAgentParams {
  prompt: string;
  cwd: string;
  allowedTools: string[];
  signal?: AbortSignal;
}

export const CLAUDE_AGENT_TIMEOUT_MS = 600_000;
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export class AgentStoppedError extends Error {
  constructor(message = "Agent stopped by user") {
    super(message);
    this.name = "AgentStoppedError";
  }
}

function resolveClaudeCommand(): string {
  return process.env.CLAUDE_CLI_COMMAND || "claude";
}

export function runClaudeAgent(params: RunClaudeAgentParams): Promise<string> {
  const { prompt, cwd, allowedTools, signal } = params;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AgentStoppedError());
      return;
    }

    const args = ["-p", prompt, "--output-format", "json"];
    if (allowedTools.length > 0) {
      args.push("--allowedTools", allowedTools.join(" "));
    }
    const child = spawn(resolveClaudeCommand(), args, { cwd, timeout: CLAUDE_AGENT_TIMEOUT_MS });

    let stopped = false;
    const onAbort = () => {
      stopped = true;
      child.kill();
    };
    signal?.addEventListener("abort", onAbort);

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let outputLimitExceeded = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (outputLimitExceeded) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        child.kill();
        reject(new Error(`claude -p output exceeded ${MAX_OUTPUT_BYTES} byte limit`));
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (outputLimitExceeded) return;
      if (stopped) {
        reject(new AgentStoppedError());
        return;
      }
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
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length === 0) {
    throw new Error("No fenced ```json block found in agent output");
  }
  const lastMatch = matches[matches.length - 1];

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastMatch[1]);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- claudeAgent`
Expected: PASS — all existing cases plus the two new abort cases.

- [ ] **Step 5: Commit**

```bash
git add src/claudeAgent.ts src/claudeAgent.test.ts
git commit -m "feat: add AgentStoppedError and abort-signal support to runClaudeAgent"
```

---

## Task 2: Thread the abort signal through the four agent functions

**Files:**
- Modify: `src/agents/analyst.ts`, `src/agents/architect.ts`, `src/agents/developer.ts`, `src/agents/qa.ts`
- Test: `src/agents/analyst.test.ts`, `src/agents/architect.test.ts`, `src/agents/developer.test.ts`, `src/agents/qa.test.ts`

**Interfaces:**
- Consumes: `runClaudeAgent({ prompt, cwd, allowedTools, signal? })` from Task 1.
- Produces: `runAnalystAgent(ideaText, cwd, signal?)`, `runArchitectAgent(analystOutput, cwd, signal?)`, `runDeveloperAgent(issueBody, cwd, signal?)`, `runQaAgent(diff, cwd, signal?)` — each forwards `signal` straight through to `runClaudeAgent`.

- [ ] **Step 1: Write the failing tests**

Add to `src/agents/analyst.test.ts`, inside `describe("runAnalystAgent", ...)`:

```ts
  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Some explanation.\n\`\`\`json\n${JSON.stringify(fakeAnalystJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runAnalystAgent("Build a todo app", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
```

Add to `src/agents/architect.test.ts`, inside `describe("runArchitectAgent", ...)` (this file's existing fixtures are `analystOutput` and `fakeArchitectJson`, defined at the top of the file):

```ts
  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Plan below.\n\`\`\`json\n${JSON.stringify(fakeArchitectJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runArchitectAgent(analystOutput, "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
```

Add to `src/agents/developer.test.ts`, inside `describe("runDeveloperAgent", ...)`:

```ts
  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Done.\n\`\`\`json\n${JSON.stringify(fakeDeveloperJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runDeveloperAgent("Implement add/complete task endpoints.", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
```

Add to `src/agents/qa.test.ts`, inside `describe("runQaAgent", ...)` (this file's existing fixture is `fakeQaJson`, defined at the top of the file):

```ts
  it("forwards the abort signal to runClaudeAgent", async () => {
    const rawOutput = JSON.stringify({
      result: `Reviewed.\n\`\`\`json\n${JSON.stringify(fakeQaJson)}\n\`\`\``,
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);
    const controller = new AbortController();

    await runQaAgent("diff --git a/server.js b/server.js", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/agents`
Expected: FAIL — the 4 new "forwards the abort signal" cases fail because `signal` isn't passed to `runClaudeAgent` yet.

- [ ] **Step 3: Thread `signal` through each agent function**

In `src/agents/analyst.ts`, change the exported function to:

```ts
export async function runAnalystAgent(ideaText: string, cwd: string, signal?: AbortSignal): Promise<AnalystOutput> {
  const prompt = buildAnalystPrompt(ideaText);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [], signal });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, AnalystOutputSchema);
}
```

In `src/agents/architect.ts`:

```ts
export async function runArchitectAgent(
  analystOutput: AnalystOutput,
  cwd: string,
  signal?: AbortSignal,
): Promise<ArchitectOutput> {
  const prompt = buildArchitectPrompt(analystOutput);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [], signal });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, ArchitectOutputSchema);
}
```

In `src/agents/developer.ts`:

```ts
export async function runDeveloperAgent(
  issueBody: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<DeveloperOutput> {
  const prompt = buildDeveloperPrompt(issueBody);
  const rawOutput = await runClaudeAgent({
    prompt,
    cwd,
    allowedTools: ["Bash", "Read", "Write", "Edit"],
    signal,
  });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, DeveloperOutputSchema);
}
```

In `src/agents/qa.ts`:

```ts
export async function runQaAgent(diff: string, cwd: string, signal?: AbortSignal): Promise<QAOutput> {
  const prompt = buildQaPrompt(diff);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: ["Read"], signal });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, QAOutputSchema);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/agents`
Expected: PASS — all existing cases (unaffected, since `signal` is optional and `toHaveBeenCalledWith`'s equality treats an `undefined`-valued key the same as an absent one) plus the 4 new forwarding cases.

- [ ] **Step 5: Commit**

```bash
git add src/agents/analyst.ts src/agents/analyst.test.ts src/agents/architect.ts src/agents/architect.test.ts src/agents/developer.ts src/agents/developer.test.ts src/agents/qa.ts src/agents/qa.test.ts
git commit -m "feat: thread an optional abort signal through the four agent functions"
```

---

## Task 3: `stopped` status and `ABORTABLE_STAGES` (backend + frontend types)

**Files:**
- Modify: `src/orchestrator/types.ts`, `web/src/types.ts`, `web/src/components/status.tsx`, `web/src/lib/runEvents.ts`
- Test: `src/orchestrator/types.test.ts` (new), `web/src/lib/runEvents.test.ts`

**Interfaces:**
- Produces: `StageStatus` (both backend and frontend copies) gains `"stopped"`. `ABORTABLE_STAGES: StageName[]` (both copies) = `["analyst", "architect", "developer", "qa"]`. Frontend `OverallStatus` gains `"stopped"`; `StageDisplayStatus`/`STAGE_STATUS_CONFIG` gains a `stopped` entry; `OVERALL_STATUS_CONFIG` gains a `stopped` entry; `deriveOverallStatus` returns `"stopped"` when any stage's latest event is `stopped` and nothing has `failed`.

- [ ] **Step 1: Write the failing tests**

Create `src/orchestrator/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ABORTABLE_STAGES } from "./types.js";

describe("ABORTABLE_STAGES", () => {
  it("lists exactly the four LLM-driven agent stages", () => {
    expect(ABORTABLE_STAGES).toEqual(["analyst", "architect", "developer", "qa"]);
  });
});
```

Add to `web/src/lib/runEvents.test.ts`, inside `describe("deriveOverallStatus", ...)`:

```ts
  it("is stopped when a stage was stopped and nothing failed", () => {
    expect(
      deriveOverallStatus({
        analyst: [event({ stage: "analyst", status: "done" })],
        architect: [event({ stage: "architect", status: "stopped" })],
      }),
    ).toBe("stopped");
  });

  it("is failed, not stopped, when a stage failed after another stage was stopped", () => {
    expect(
      deriveOverallStatus({
        architect: [event({ stage: "architect", status: "stopped" })],
        developer: [event({ stage: "developer", status: "failed" })],
      }),
    ).toBe("failed");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- orchestrator/types` and `npm test --prefix web -- runEvents`
Expected: FAIL — `ABORTABLE_STAGES` doesn't exist yet; `"stopped"` isn't a valid `StageStatus`/return value yet.

- [ ] **Step 3: Add the status and constant**

In `src/orchestrator/types.ts`, change `StageStatus` and add the new constant:

```ts
export type StageStatus = "running" | "done" | "failed" | "blocked" | "stopped";
```

Add at the end of the file:

```ts
export const ABORTABLE_STAGES: StageName[] = ["analyst", "architect", "developer", "qa"];
```

In `web/src/types.ts`, change `StageStatus` and `OverallStatus`, and add the constant (mirroring the backend copy, per this file's existing "plain duplicate" convention):

```ts
export type StageStatus = "running" | "done" | "failed" | "blocked" | "stopped";
```

```ts
export type OverallStatus = "idle" | "running" | "deployed" | "blocked" | "failed" | "stopped";
```

Add after `STAGE_LABELS`:

```ts
export const ABORTABLE_STAGES: StageName[] = ["analyst", "architect", "developer", "qa"];
```

In `web/src/components/status.tsx`, update the icon import and both config records:

```ts
import { CheckCircle2, CircleDashed, CirclePause, Loader2, ShieldAlert, XCircle } from "lucide-react";
import type { OverallStatus } from "@/types";

export type StageDisplayStatus = "pending" | "running" | "done" | "failed" | "blocked" | "stopped";

interface StatusConfig {
  label: string;
  dotClassName: string;
  icon: typeof CheckCircle2;
}

export const STAGE_STATUS_CONFIG: Record<StageDisplayStatus, StatusConfig> = {
  pending: { label: "Not started", dotClassName: "text-muted-foreground", icon: CircleDashed },
  running: { label: "Running", dotClassName: "text-primary", icon: Loader2 },
  done: { label: "Done", dotClassName: "text-success", icon: CheckCircle2 },
  failed: { label: "Failed", dotClassName: "text-destructive", icon: XCircle },
  blocked: { label: "Blocked", dotClassName: "text-warning", icon: ShieldAlert },
  stopped: { label: "Stopped", dotClassName: "text-warning", icon: CirclePause },
};

export const OVERALL_STATUS_CONFIG: Record<
  OverallStatus,
  { label: string; className: string }
> = {
  idle: { label: "Idle", className: "bg-muted text-muted-foreground" },
  running: { label: "Running", className: "bg-primary/15 text-primary" },
  deployed: { label: "Deployed", className: "bg-success/15 text-success" },
  blocked: { label: "Blocked", className: "bg-warning/15 text-warning" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
  stopped: { label: "Stopped", className: "bg-warning/15 text-warning" },
};
```

In `web/src/lib/runEvents.ts`, update `deriveOverallStatus`:

```ts
export function deriveOverallStatus(eventsByStage: EventsByStage): OverallStatus {
  const allEvents = Object.values(eventsByStage).flat();
  if (allEvents.length === 0) return "idle";
  if (allEvents.some((e) => e.status === "failed" && e.stage !== "tracing_pack")) return "failed";
  if (deriveStageStatus(eventsByStage.merge) === "blocked") return "blocked";
  if (deriveStageStatus(eventsByStage.deploy) === "done") return "deployed";
  if (allEvents.some((e) => e.status === "stopped")) return "stopped";
  return "running";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- orchestrator/types` and `npm test --prefix web -- runEvents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/types.test.ts web/src/types.ts web/src/components/status.tsx web/src/lib/runEvents.ts web/src/lib/runEvents.test.ts
git commit -m "feat: add a stopped stage/overall status and the ABORTABLE_STAGES list"
```

---

## Task 4: Refactor `runOrchestrator` into a `PipelineContext` + stage-step loop (behavior-preserving)

**Files:**
- Modify: `src/orchestrator/runOrchestrator.ts`

**Interfaces:**
- Produces: `PipelineContext` (internal accumulator type), an internal `STAGE_STEPS: StageStep[]` array covering the 10 stages `create_repo` through `deploy` (not `tracing_pack`, which stays a separate `commitTracingPack` helper). `runOrchestrator(params, deps)` keeps its exact current signature and `RunOutcome` type (`deployed | blocked | failed`) — this task changes no observable behavior.

This task is a pure internal refactor. There are no new tests — the existing `src/orchestrator/runOrchestrator.test.ts` suite (8 cases) is the regression check, and every one of them must keep passing unchanged.

- [ ] **Step 1: Confirm the current suite passes before refactoring**

Run: `npm test -- runOrchestrator`
Expected: PASS (8 passing tests) — this is the baseline you must not break.

- [ ] **Step 2: Replace `runOrchestrator.ts` with the context/loop structure**

Replace the full contents of `src/orchestrator/runOrchestrator.ts` with:

```ts
import type { GithubClient } from "../github/client.js";
import type { readStarterFiles as ReadStarterFiles } from "../github/readStarterFiles.js";
import type { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "../git.js";
import type { runAnalystAgent } from "../agents/analyst.js";
import type { runArchitectAgent } from "../agents/architect.js";
import type { runDeveloperAgent } from "../agents/developer.js";
import type { runQaAgent } from "../agents/qa.js";
import type {
  AnalystOutput,
  ArchitectOutput,
  DeveloperOutput,
  QAFinding,
  QAOutput,
} from "../agents/schemas.js";
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

export interface PipelineContext {
  tracingEntries: TracingPackEntry[];
  pendingInput?: unknown;
  repo?: { owner: string; repo: string; htmlUrl: string; cloneUrl: string };
  analystOutput?: AnalystOutput;
  architectOutput?: ArchitectOutput;
  issue?: { number: number };
  developerOutput?: DeveloperOutput;
  pr?: { number: number; htmlUrl: string };
  diff?: string;
  qaOutput?: QAOutput;
  deployUrl?: string;
}

interface StageStep {
  name: StageName;
  guard?: (ctx: PipelineContext) => boolean;
  run(ctx: PipelineContext, params: OrchestratorParams, deps: OrchestratorDeps): Promise<void>;
}

const STAGE_STEPS: StageStep[] = [
  {
    name: "create_repo",
    async run(ctx, params, deps) {
      const starterFiles = deps.readStarterFiles(params.starterDir);
      ctx.pendingInput = {
        owner: params.owner,
        repoName: params.repoName,
        starterFilePaths: starterFiles.map((f) => f.path),
      };
      deps.eventBus.emit(
        stageEvent("create_repo", "running", "Creating GitHub repo from starter template", {
          input: ctx.pendingInput,
        }),
      );
      const repo = await deps.github.createRepoFromStarter({
        owner: params.owner,
        repoName: params.repoName,
        starterFiles,
      });
      const output = { htmlUrl: repo.htmlUrl, cloneUrl: repo.cloneUrl };
      deps.eventBus.emit(stageEvent("create_repo", "done", repo.htmlUrl, { output }));
      ctx.tracingEntries.push({ stage: "create_repo", status: "done", input: ctx.pendingInput, output });
      ctx.repo = repo;
    },
  },
  {
    name: "analyst",
    async run(ctx, params, deps) {
      ctx.pendingInput = { ideaText: params.ideaText };
      deps.eventBus.emit(stageEvent("analyst", "running", "Analyzing idea", { input: ctx.pendingInput }));
      const analystOutput = await deps.agents.analyst(params.ideaText, params.workDir);
      deps.eventBus.emit(stageEvent("analyst", "done", analystOutput.summary, { output: analystOutput }));
      ctx.tracingEntries.push({ stage: "analyst", status: "done", input: ctx.pendingInput, output: analystOutput });
      ctx.analystOutput = analystOutput;
    },
  },
  {
    name: "architect",
    async run(ctx, params, deps) {
      ctx.pendingInput = { analystOutput: ctx.analystOutput };
      deps.eventBus.emit(stageEvent("architect", "running", "Planning implementation", { input: ctx.pendingInput }));
      const architectOutput = await deps.agents.architect(ctx.analystOutput!, params.workDir);
      deps.eventBus.emit(stageEvent("architect", "done", architectOutput.issueTitle, { output: architectOutput }));
      ctx.tracingEntries.push({
        stage: "architect",
        status: "done",
        input: ctx.pendingInput,
        output: architectOutput,
      });
      ctx.architectOutput = architectOutput;
    },
  },
  {
    name: "open_issue",
    async run(ctx, params, deps) {
      ctx.pendingInput = { title: ctx.architectOutput!.issueTitle, body: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("open_issue", "running", "Opening GitHub issue", { input: ctx.pendingInput }));
      const issue = await deps.github.createIssue(
        params.owner,
        params.repoName,
        ctx.architectOutput!.issueTitle,
        ctx.architectOutput!.issueBody,
      );
      deps.eventBus.emit(stageEvent("open_issue", "done", `#${issue.number}`, { output: issue }));
      ctx.tracingEntries.push({ stage: "open_issue", status: "done", input: ctx.pendingInput, output: issue });
      ctx.issue = issue;
    },
  },
  {
    name: "developer",
    async run(ctx, params, deps) {
      ctx.pendingInput = { issueBody: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("developer", "running", "Implementing the plan", { input: ctx.pendingInput }));
      await deps.git.cloneRepo(ctx.repo!.cloneUrl, params.workDir, params.githubToken);
      await deps.git.createAndCheckoutBranch(params.workDir, ctx.architectOutput!.branchName);
      const developerOutput = await deps.agents.developer(ctx.architectOutput!.issueBody, params.workDir);
      await deps.git.pushBranch(params.workDir, ctx.architectOutput!.branchName, params.githubToken);
      deps.eventBus.emit(stageEvent("developer", "done", developerOutput.prTitle, { output: developerOutput }));
      ctx.tracingEntries.push({
        stage: "developer",
        status: "done",
        input: ctx.pendingInput,
        output: developerOutput,
      });
      ctx.developerOutput = developerOutput;
    },
  },
  {
    name: "open_pr",
    async run(ctx, params, deps) {
      ctx.pendingInput = {
        title: ctx.developerOutput!.prTitle,
        body: ctx.developerOutput!.prBody,
        head: ctx.architectOutput!.branchName,
        base: BASE_BRANCH,
      };
      deps.eventBus.emit(stageEvent("open_pr", "running", "Opening pull request", { input: ctx.pendingInput }));
      const pr = await deps.github.createPullRequest({
        owner: params.owner,
        repo: params.repoName,
        title: ctx.developerOutput!.prTitle,
        body: ctx.developerOutput!.prBody,
        head: ctx.architectOutput!.branchName,
        base: BASE_BRANCH,
        issueNumber: ctx.issue!.number,
      });
      deps.eventBus.emit(stageEvent("open_pr", "done", pr.htmlUrl, { output: pr }));
      ctx.tracingEntries.push({ stage: "open_pr", status: "done", input: ctx.pendingInput, output: pr });
      ctx.pr = pr;
    },
  },
  {
    name: "qa",
    async run(ctx, params, deps) {
      ctx.pendingInput = undefined;
      deps.eventBus.emit(stageEvent("qa", "running", "Reviewing the pull request"));
      const diff = await deps.git.diffAgainstBase(params.workDir, BASE_BRANCH);
      ctx.pendingInput = { diff };
      const qaOutput = await deps.agents.qa(diff, params.workDir);
      deps.eventBus.emit(stageEvent("qa", "done", qaOutput.verdict, { output: qaOutput }));
      ctx.tracingEntries.push({ stage: "qa", status: "done", input: ctx.pendingInput, output: qaOutput });
      ctx.diff = diff;
      ctx.qaOutput = qaOutput;
    },
  },
  {
    name: "post_review",
    async run(ctx, params, deps) {
      const comment = formatQaComment(ctx.qaOutput!);
      ctx.pendingInput = { comment };
      deps.eventBus.emit(stageEvent("post_review", "running", "Posting review comment", { input: ctx.pendingInput }));
      await deps.github.postPrComment(params.owner, params.repoName, ctx.pr!.number, comment);
      deps.eventBus.emit(stageEvent("post_review", "done", "posted", { output: { posted: true } }));
      ctx.tracingEntries.push({
        stage: "post_review",
        status: "done",
        input: ctx.pendingInput,
        output: { posted: true },
      });
    },
  },
  {
    name: "merge",
    guard: (ctx) => ctx.qaOutput!.findings.some((f) => f.severity === "critical"),
    async run(ctx, params, deps) {
      ctx.pendingInput = { prNumber: ctx.pr!.number };
      deps.eventBus.emit(stageEvent("merge", "running", "Merging pull request", { input: ctx.pendingInput }));
      await deps.github.mergePullRequest(params.owner, params.repoName, ctx.pr!.number);
      deps.eventBus.emit(stageEvent("merge", "done", "merged", { output: { merged: true } }));
      ctx.tracingEntries.push({ stage: "merge", status: "done", input: ctx.pendingInput, output: { merged: true } });
    },
  },
  {
    name: "deploy",
    async run(ctx, params, deps) {
      ctx.pendingInput = { name: params.repoName, repoUrl: ctx.repo!.htmlUrl, branch: BASE_BRANCH };
      deps.eventBus.emit(stageEvent("deploy", "running", "Deploying to Render", { input: ctx.pendingInput }));
      const service = await deps.render.createService({
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
      });
      const live = await deps.render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
      deps.eventBus.emit(stageEvent("deploy", "done", live.url, { output: live }));
      ctx.tracingEntries.push({ stage: "deploy", status: "done", input: ctx.pendingInput, output: live });
      ctx.deployUrl = live.url;
    },
  },
];

export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
): Promise<RunOutcome> {
  const ctx: PipelineContext = { tracingEntries: [] };

  async function commitTracingPack(outcome: string): Promise<void> {
    if (!ctx.repo) return;
    try {
      deps.eventBus.emit(
        stageEvent("tracing_pack", "running", "Committing the tracing pack to the repo", {
          input: { path: TRACING_PACK_PATH },
        }),
      );
      const markdown = formatTracingPackMarkdown(ctx.tracingEntries, outcome);
      const result = await deps.github.commitFile(
        params.owner,
        params.repoName,
        TRACING_PACK_PATH,
        markdown,
        BASE_BRANCH,
      );
      deps.eventBus.emit(
        stageEvent("tracing_pack", "done", TRACING_PACK_PATH, { output: { committed: true, sha: result.sha } }),
      );
    } catch (error) {
      const err = error as Error;
      deps.eventBus.emit(stageEvent("tracing_pack", "failed", err.message));
    }
  }

  let currentStage: StageName = "create_repo";
  for (const step of STAGE_STEPS) {
    currentStage = step.name;
    if (step.guard?.(ctx)) {
      deps.eventBus.emit(
        stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped", {
          output: { findings: ctx.qaOutput!.findings },
        }),
      );
      ctx.tracingEntries.push({ stage: "merge", status: "blocked", output: { findings: ctx.qaOutput!.findings } });
      await commitTracingPack("blocked");
      return { status: "blocked", findings: ctx.qaOutput!.findings, prUrl: ctx.pr!.htmlUrl };
    }
    try {
      await step.run(ctx, params, deps);
    } catch (error) {
      const err = error as Error;
      deps.eventBus.emit(stageEvent(currentStage, "failed", err.message));
      ctx.tracingEntries.push({ stage: currentStage, status: "failed", input: ctx.pendingInput, output: err.message });
      await commitTracingPack("failed");
      return { status: "failed", stage: currentStage, error: err.message };
    }
  }

  await commitTracingPack("deployed");
  return { status: "deployed", url: ctx.deployUrl!, prUrl: ctx.pr!.htmlUrl };
}
```

- [ ] **Step 3: Run tests to confirm the refactor is behavior-preserving**

Run: `npm test -- runOrchestrator`
Expected: PASS — the same 8 tests, unmodified, all still pass. If any fails, compare its expected event/output sequence against the corresponding `STAGE_STEPS` entry above line-by-line; do not change the test.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/runOrchestrator.ts
git commit -m "refactor: rewrite runOrchestrator as a PipelineContext + stage-step loop"
```

---

## Task 5: Add stop/resume support to `runOrchestrator`

**Files:**
- Modify: `src/orchestrator/runOrchestrator.ts`, `src/cli.ts`
- Test: `src/orchestrator/runOrchestrator.test.ts`

**Interfaces:**
- Consumes: `AgentStoppedError` from `src/claudeAgent.ts` (Task 1).
- Produces: `export interface ResumeState { stageIndex: number; ctx: PipelineContext }`. `RunOutcome` gains `{ status: "stopped"; stage: StageName; resumeState: ResumeState }`. `runOrchestrator(params, deps, resumeState?, signal?)` — a stage whose agent call rejects with `AgentStoppedError` while `signal` is the one that fired ends the run with the `"stopped"` outcome instead of `"failed"`, without committing a tracing pack. Passing a previous stopped outcome's `resumeState` back in makes the loop start at that stage index with that context instead of a fresh one.

- [ ] **Step 1: Write the failing tests**

Add to `src/orchestrator/runOrchestrator.test.ts`. First, update the import line to include `AgentStoppedError`:

```ts
import { AgentStoppedError } from "../claudeAgent.js";
```

Then add these two cases inside `describe("runOrchestrator", ...)`:

```ts
  it("stops the run when the developer agent is aborted, without committing a tracing pack", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockImplementation(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        }),
    );
    const controller = new AbortController();
    controller.abort();

    const outcome = await runOrchestrator(params, deps, undefined, controller.signal);

    expect(outcome.status).toBe("stopped");
    if (outcome.status === "stopped") {
      expect(outcome.stage).toBe("developer");
      expect(outcome.resumeState.stageIndex).toBeGreaterThanOrEqual(0);
      expect(outcome.resumeState.ctx.repo).toBeDefined();
    }
    expect(deps.github.commitFile).not.toHaveBeenCalled();
  });

  it("resumes a stopped run from the stored snapshot and continues to completion", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.developer).mockImplementationOnce(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        }),
    );
    const controller = new AbortController();
    controller.abort();
    const stopped = await runOrchestrator(params, deps, undefined, controller.signal);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");

    const outcome = await runOrchestrator(params, deps, stopped.resumeState);

    expect(outcome.status).toBe("deployed");
    expect(deps.git.createAndCheckoutBranch).toHaveBeenCalledTimes(2);
    expect(deps.github.mergePullRequest).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- runOrchestrator`
Expected: FAIL — `runOrchestrator` doesn't accept a third/fourth argument yet, and there's no `"stopped"` outcome.

- [ ] **Step 3: Add resume/stop support to the loop**

In `src/orchestrator/runOrchestrator.ts`, add the import at the top (after the existing `import { RunEventBus } from "./events.js";` line):

```ts
import { AgentStoppedError } from "../claudeAgent.js";
```

Replace the `StageStep` interface, the `STAGE_STEPS` array, and the `runOrchestrator` function (everything from `interface StageStep {` down to the closing brace of `runOrchestrator`) with the following. Everything above `interface StageStep` (imports, `OrchestratorParams`, `OrchestratorDeps`, the old `RunOutcome`, `BASE_BRANCH`, `TRACING_PACK_PATH`, `stageEvent`, `formatQaComment`, `PipelineContext`) stays exactly as Task 4 left it, except `RunOutcome` itself, which also needs replacing:

```ts
export interface ResumeState {
  stageIndex: number;
  ctx: PipelineContext;
}

export type RunOutcome =
  | { status: "deployed"; url: string; prUrl: string }
  | { status: "blocked"; findings: QAFinding[]; prUrl: string }
  | { status: "failed"; stage: StageName; error: string }
  | { status: "stopped"; stage: StageName; resumeState: ResumeState };

interface StageStep {
  name: StageName;
  abortable: boolean;
  guard?: (ctx: PipelineContext) => boolean;
  run(
    ctx: PipelineContext,
    params: OrchestratorParams,
    deps: OrchestratorDeps,
    signal?: AbortSignal,
  ): Promise<void>;
}

const STAGE_STEPS: StageStep[] = [
  {
    name: "create_repo",
    abortable: false,
    async run(ctx, params, deps) {
      const starterFiles = deps.readStarterFiles(params.starterDir);
      ctx.pendingInput = {
        owner: params.owner,
        repoName: params.repoName,
        starterFilePaths: starterFiles.map((f) => f.path),
      };
      deps.eventBus.emit(
        stageEvent("create_repo", "running", "Creating GitHub repo from starter template", {
          input: ctx.pendingInput,
        }),
      );
      const repo = await deps.github.createRepoFromStarter({
        owner: params.owner,
        repoName: params.repoName,
        starterFiles,
      });
      const output = { htmlUrl: repo.htmlUrl, cloneUrl: repo.cloneUrl };
      deps.eventBus.emit(stageEvent("create_repo", "done", repo.htmlUrl, { output }));
      ctx.tracingEntries.push({ stage: "create_repo", status: "done", input: ctx.pendingInput, output });
      ctx.repo = repo;
    },
  },
  {
    name: "analyst",
    abortable: true,
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = { ideaText: params.ideaText };
      deps.eventBus.emit(stageEvent("analyst", "running", "Analyzing idea", { input: ctx.pendingInput }));
      const analystOutput = await deps.agents.analyst(params.ideaText, params.workDir, signal);
      deps.eventBus.emit(stageEvent("analyst", "done", analystOutput.summary, { output: analystOutput }));
      ctx.tracingEntries.push({ stage: "analyst", status: "done", input: ctx.pendingInput, output: analystOutput });
      ctx.analystOutput = analystOutput;
    },
  },
  {
    name: "architect",
    abortable: true,
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = { analystOutput: ctx.analystOutput };
      deps.eventBus.emit(stageEvent("architect", "running", "Planning implementation", { input: ctx.pendingInput }));
      const architectOutput = await deps.agents.architect(ctx.analystOutput!, params.workDir, signal);
      deps.eventBus.emit(stageEvent("architect", "done", architectOutput.issueTitle, { output: architectOutput }));
      ctx.tracingEntries.push({
        stage: "architect",
        status: "done",
        input: ctx.pendingInput,
        output: architectOutput,
      });
      ctx.architectOutput = architectOutput;
    },
  },
  {
    name: "open_issue",
    abortable: false,
    async run(ctx, params, deps) {
      ctx.pendingInput = { title: ctx.architectOutput!.issueTitle, body: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("open_issue", "running", "Opening GitHub issue", { input: ctx.pendingInput }));
      const issue = await deps.github.createIssue(
        params.owner,
        params.repoName,
        ctx.architectOutput!.issueTitle,
        ctx.architectOutput!.issueBody,
      );
      deps.eventBus.emit(stageEvent("open_issue", "done", `#${issue.number}`, { output: issue }));
      ctx.tracingEntries.push({ stage: "open_issue", status: "done", input: ctx.pendingInput, output: issue });
      ctx.issue = issue;
    },
  },
  {
    name: "developer",
    abortable: true,
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = { issueBody: ctx.architectOutput!.issueBody };
      deps.eventBus.emit(stageEvent("developer", "running", "Implementing the plan", { input: ctx.pendingInput }));
      await deps.git.cloneRepo(ctx.repo!.cloneUrl, params.workDir, params.githubToken);
      await deps.git.createAndCheckoutBranch(params.workDir, ctx.architectOutput!.branchName);
      const developerOutput = await deps.agents.developer(ctx.architectOutput!.issueBody, params.workDir, signal);
      await deps.git.pushBranch(params.workDir, ctx.architectOutput!.branchName, params.githubToken);
      deps.eventBus.emit(stageEvent("developer", "done", developerOutput.prTitle, { output: developerOutput }));
      ctx.tracingEntries.push({
        stage: "developer",
        status: "done",
        input: ctx.pendingInput,
        output: developerOutput,
      });
      ctx.developerOutput = developerOutput;
    },
  },
  {
    name: "open_pr",
    abortable: false,
    async run(ctx, params, deps) {
      ctx.pendingInput = {
        title: ctx.developerOutput!.prTitle,
        body: ctx.developerOutput!.prBody,
        head: ctx.architectOutput!.branchName,
        base: BASE_BRANCH,
      };
      deps.eventBus.emit(stageEvent("open_pr", "running", "Opening pull request", { input: ctx.pendingInput }));
      const pr = await deps.github.createPullRequest({
        owner: params.owner,
        repo: params.repoName,
        title: ctx.developerOutput!.prTitle,
        body: ctx.developerOutput!.prBody,
        head: ctx.architectOutput!.branchName,
        base: BASE_BRANCH,
        issueNumber: ctx.issue!.number,
      });
      deps.eventBus.emit(stageEvent("open_pr", "done", pr.htmlUrl, { output: pr }));
      ctx.tracingEntries.push({ stage: "open_pr", status: "done", input: ctx.pendingInput, output: pr });
      ctx.pr = pr;
    },
  },
  {
    name: "qa",
    abortable: true,
    async run(ctx, params, deps, signal) {
      ctx.pendingInput = undefined;
      deps.eventBus.emit(stageEvent("qa", "running", "Reviewing the pull request"));
      const diff = await deps.git.diffAgainstBase(params.workDir, BASE_BRANCH);
      ctx.pendingInput = { diff };
      const qaOutput = await deps.agents.qa(diff, params.workDir, signal);
      deps.eventBus.emit(stageEvent("qa", "done", qaOutput.verdict, { output: qaOutput }));
      ctx.tracingEntries.push({ stage: "qa", status: "done", input: ctx.pendingInput, output: qaOutput });
      ctx.diff = diff;
      ctx.qaOutput = qaOutput;
    },
  },
  {
    name: "post_review",
    abortable: false,
    async run(ctx, params, deps) {
      const comment = formatQaComment(ctx.qaOutput!);
      ctx.pendingInput = { comment };
      deps.eventBus.emit(stageEvent("post_review", "running", "Posting review comment", { input: ctx.pendingInput }));
      await deps.github.postPrComment(params.owner, params.repoName, ctx.pr!.number, comment);
      deps.eventBus.emit(stageEvent("post_review", "done", "posted", { output: { posted: true } }));
      ctx.tracingEntries.push({
        stage: "post_review",
        status: "done",
        input: ctx.pendingInput,
        output: { posted: true },
      });
    },
  },
  {
    name: "merge",
    abortable: false,
    guard: (ctx) => ctx.qaOutput!.findings.some((f) => f.severity === "critical"),
    async run(ctx, params, deps) {
      ctx.pendingInput = { prNumber: ctx.pr!.number };
      deps.eventBus.emit(stageEvent("merge", "running", "Merging pull request", { input: ctx.pendingInput }));
      await deps.github.mergePullRequest(params.owner, params.repoName, ctx.pr!.number);
      deps.eventBus.emit(stageEvent("merge", "done", "merged", { output: { merged: true } }));
      ctx.tracingEntries.push({ stage: "merge", status: "done", input: ctx.pendingInput, output: { merged: true } });
    },
  },
  {
    name: "deploy",
    abortable: false,
    async run(ctx, params, deps) {
      ctx.pendingInput = { name: params.repoName, repoUrl: ctx.repo!.htmlUrl, branch: BASE_BRANCH };
      deps.eventBus.emit(stageEvent("deploy", "running", "Deploying to Render", { input: ctx.pendingInput }));
      const service = await deps.render.createService({
        name: params.repoName,
        repoUrl: ctx.repo!.htmlUrl,
        branch: BASE_BRANCH,
      });
      const live = await deps.render.waitForLive(service.serviceId, { maxAttempts: 30, pollIntervalMs: 10_000 });
      deps.eventBus.emit(stageEvent("deploy", "done", live.url, { output: live }));
      ctx.tracingEntries.push({ stage: "deploy", status: "done", input: ctx.pendingInput, output: live });
      ctx.deployUrl = live.url;
    },
  },
];

export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
  resumeState?: ResumeState,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  const ctx: PipelineContext = resumeState?.ctx ?? { tracingEntries: [] };
  const startIndex = resumeState?.stageIndex ?? 0;

  async function commitTracingPack(outcome: string): Promise<void> {
    if (!ctx.repo) return;
    try {
      deps.eventBus.emit(
        stageEvent("tracing_pack", "running", "Committing the tracing pack to the repo", {
          input: { path: TRACING_PACK_PATH },
        }),
      );
      const markdown = formatTracingPackMarkdown(ctx.tracingEntries, outcome);
      const result = await deps.github.commitFile(
        params.owner,
        params.repoName,
        TRACING_PACK_PATH,
        markdown,
        BASE_BRANCH,
      );
      deps.eventBus.emit(
        stageEvent("tracing_pack", "done", TRACING_PACK_PATH, { output: { committed: true, sha: result.sha } }),
      );
    } catch (error) {
      const err = error as Error;
      deps.eventBus.emit(stageEvent("tracing_pack", "failed", err.message));
    }
  }

  let currentStage: StageName = STAGE_STEPS[startIndex]?.name ?? "create_repo";
  for (let i = startIndex; i < STAGE_STEPS.length; i++) {
    const step = STAGE_STEPS[i];
    currentStage = step.name;
    if (step.guard?.(ctx)) {
      deps.eventBus.emit(
        stageEvent("merge", "blocked", "Critical finding(s) - deploy skipped", {
          output: { findings: ctx.qaOutput!.findings },
        }),
      );
      ctx.tracingEntries.push({ stage: "merge", status: "blocked", output: { findings: ctx.qaOutput!.findings } });
      await commitTracingPack("blocked");
      return { status: "blocked", findings: ctx.qaOutput!.findings, prUrl: ctx.pr!.htmlUrl };
    }
    try {
      await step.run(ctx, params, deps, step.abortable ? signal : undefined);
    } catch (error) {
      if (error instanceof AgentStoppedError) {
        deps.eventBus.emit(stageEvent(currentStage, "stopped", "Stopped by user"));
        return { status: "stopped", stage: currentStage, resumeState: { stageIndex: i, ctx } };
      }
      const err = error as Error;
      deps.eventBus.emit(stageEvent(currentStage, "failed", err.message));
      ctx.tracingEntries.push({ stage: currentStage, status: "failed", input: ctx.pendingInput, output: err.message });
      await commitTracingPack("failed");
      return { status: "failed", stage: currentStage, error: err.message };
    }
  }

  await commitTracingPack("deployed");
  return { status: "deployed", url: ctx.deployUrl!, prUrl: ctx.pr!.htmlUrl };
}
```

Finally, fix `src/cli.ts`'s outcome handling so it still compiles now that `RunOutcome` has a fourth variant. Replace:

```ts
  if (outcome.status === "deployed") {
    console.log(`Live at ${outcome.url}`);
  } else if (outcome.status === "blocked") {
    console.log(`Blocked by QA - see ${outcome.prUrl}`);
  } else {
    console.error(`Failed at stage ${outcome.stage}: ${outcome.error}`);
    process.exitCode = 1;
  }
```

with:

```ts
  if (outcome.status === "deployed") {
    console.log(`Live at ${outcome.url}`);
  } else if (outcome.status === "blocked") {
    console.log(`Blocked by QA - see ${outcome.prUrl}`);
  } else if (outcome.status === "failed") {
    console.error(`Failed at stage ${outcome.stage}: ${outcome.error}`);
    process.exitCode = 1;
  } else {
    console.error(`Run stopped at stage ${outcome.stage}`);
    process.exitCode = 1;
  }
```

(This branch is unreachable via the CLI today, since `cli.ts` never passes a `signal` — it's required only so the file keeps compiling against the wider `RunOutcome` union. Task 8 rewrites this whole function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- runOrchestrator` then `npm test`
Expected: PASS — all `runOrchestrator` cases (the original 8 plus the 2 new ones) and the full backend suite (confirming `cli.ts` still compiles and `cli.test.ts` still passes).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runOrchestrator.ts src/orchestrator/runOrchestrator.test.ts src/cli.ts
git commit -m "feat: support stopping and resuming runOrchestrator via an abort signal"
```

---

## Task 6: `RunController` (start/stop/resume lifecycle)

**Files:**
- Create: `src/orchestrator/runController.ts`
- Test: `src/orchestrator/runController.test.ts`

**Interfaces:**
- Consumes: `runOrchestrator`, `OrchestratorDeps`, `OrchestratorParams`, `ResumeState`, `RunOutcome` from `./runOrchestrator.js`; `RunEventBus` from `./events.js`; `ABORTABLE_STAGES` from `./types.js`; `AgentStoppedError` from `../claudeAgent.js` (test only).
- Produces:
  ```ts
  export type RunControllerStatus = "idle" | "running" | "stopped" | "done";
  export interface RunControllerConfig {
    owner: string;
    starterDir: string;
    githubToken: string;
    deps: Omit<OrchestratorDeps, "eventBus">;
  }
  export class RunController {
    eventBus: RunEventBus;
    constructor(config: RunControllerConfig);
    getStatus(): RunControllerStatus;
    getRunPromise(): Promise<RunOutcome> | undefined;
    onBusReplaced(listener: () => void): () => void;
    start(ideaText: string): void;   // throws if a run is running/stopped
    stop(): void;                     // throws if no abortable stage is running
    resume(): void;                   // throws if there's no stopped run
  }
  ```
  Used by Task 7 (dashboard server) and Task 8 (CLI).

- [ ] **Step 1: Write the failing tests**

Create `src/orchestrator/runController.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AgentStoppedError } from "../claudeAgent.js";
import { RunEventBus } from "./events.js";
import { RunController, type RunControllerConfig } from "./runController.js";
import type { StageName } from "./types.js";

function waitForStage(bus: RunEventBus, stage: StageName, status: string): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = bus.onEvent((event) => {
      if (event.stage === stage && event.status === status) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function makeConfig(): RunControllerConfig {
  const github = {
    createRepoFromStarter: vi.fn().mockResolvedValue({
      owner: "org",
      repo: "app",
      htmlUrl: "https://github.com/org/app",
      cloneUrl: "https://github.com/org/app.git",
    }),
    createIssue: vi.fn().mockResolvedValue({ number: 1 }),
    createPullRequest: vi.fn().mockResolvedValue({ number: 2, htmlUrl: "https://github.com/org/app/pull/2" }),
    postPrComment: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    commitFile: vi.fn().mockResolvedValue({ sha: "sha" }),
  };
  const render = {
    createService: vi.fn().mockResolvedValue({ serviceId: "srv-1" }),
    waitForLive: vi.fn().mockResolvedValue({ url: "https://app.onrender.com" }),
  };
  const git = {
    cloneRepo: vi.fn().mockResolvedValue(undefined),
    createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    diffAgainstBase: vi.fn().mockResolvedValue("diff --git a/server.js b/server.js"),
  };
  const agents = {
    analyst: vi.fn().mockResolvedValue({ summary: "s", goals: [], keyFeatures: [], nonGoals: [], openQuestions: [] }),
    architect: vi.fn().mockResolvedValue({ issueTitle: "t", issueBody: "b", branchName: "feature/x" }),
    developer: vi.fn().mockResolvedValue({ prTitle: "t", prBody: "b" }),
    qa: vi.fn().mockResolvedValue({ verdict: "pass", findings: [] }),
  };
  return {
    owner: "org",
    starterDir: "/templates/starter",
    githubToken: "test-token",
    deps: {
      github: github as never,
      render: render as never,
      git: git as never,
      agents: agents as never,
      readStarterFiles: vi.fn().mockReturnValue([{ path: "package.json", content: "{}" }]),
    },
  };
}

describe("RunController", () => {
  it("starts a run and completes it", async () => {
    const config = makeConfig();
    const controller = new RunController(config);

    controller.start("Build a todo app");
    const outcome = await controller.getRunPromise();

    expect(outcome?.status).toBe("deployed");
    expect(controller.getStatus()).toBe("done");
  });

  it("throws when starting while a run is already active", () => {
    const controller = new RunController(makeConfig());
    controller.start("Build a todo app");

    expect(() => controller.start("Another idea")).toThrow("A run is already active");
  });

  it("throws when stop() is called with no abortable stage running", () => {
    const controller = new RunController(makeConfig());
    expect(() => controller.stop()).toThrow("No abortable stage is currently running");
  });

  it("throws when resume() is called with no stopped run", () => {
    const controller = new RunController(makeConfig());
    expect(() => controller.resume()).toThrow("No stopped run to resume");
  });

  it("stops the run when the developer agent is in flight, and resumes it to completion", async () => {
    const config = makeConfig();
    let firstAttempt = true;
    vi.mocked(config.deps.agents.developer).mockImplementation(
      (_issueBody: string, _cwd: string, signal?: AbortSignal) => {
        if (!firstAttempt) return Promise.resolve({ prTitle: "t", prBody: "b" });
        firstAttempt = false;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new AgentStoppedError());
            return;
          }
          signal?.addEventListener("abort", () => reject(new AgentStoppedError()));
        });
      },
    );
    const controller = new RunController(config);

    controller.start("Build a todo app");
    await waitForStage(controller.eventBus, "developer", "running");
    controller.stop();
    const stoppedOutcome = await controller.getRunPromise();

    expect(stoppedOutcome?.status).toBe("stopped");
    expect(controller.getStatus()).toBe("stopped");

    controller.resume();
    const finalOutcome = await controller.getRunPromise();

    expect(finalOutcome?.status).toBe("deployed");
    expect(config.deps.github.mergePullRequest).toHaveBeenCalled();
  });

  it("gives a fresh event bus to a second run and notifies onBusReplaced", async () => {
    const config = makeConfig();
    const controller = new RunController(config);
    const busReplaced = vi.fn();
    controller.onBusReplaced(busReplaced);

    controller.start("First idea");
    const firstBus = controller.eventBus;
    await controller.getRunPromise();
    expect(busReplaced).not.toHaveBeenCalled();

    controller.start("Second idea");
    expect(controller.eventBus).not.toBe(firstBus);
    expect(busReplaced).toHaveBeenCalledTimes(1);
    await controller.getRunPromise();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- runController`
Expected: FAIL — `./runController.js` doesn't exist yet.

- [ ] **Step 3: Implement `RunController`**

Create `src/orchestrator/runController.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunEventBus } from "./events.js";
import {
  runOrchestrator,
  type OrchestratorDeps,
  type OrchestratorParams,
  type ResumeState,
  type RunOutcome,
} from "./runOrchestrator.js";
import { ABORTABLE_STAGES, type StageName } from "./types.js";

export type RunControllerStatus = "idle" | "running" | "stopped" | "done";

export interface RunControllerConfig {
  owner: string;
  starterDir: string;
  githubToken: string;
  deps: Omit<OrchestratorDeps, "eventBus">;
}

export class RunController {
  eventBus: RunEventBus = new RunEventBus();

  private status: RunControllerStatus = "idle";
  private currentStage: StageName | undefined;
  private activeController: AbortController | undefined;
  private snapshot: { params: OrchestratorParams; resumeState: ResumeState } | undefined;
  private runPromise: Promise<RunOutcome> | undefined;
  private busReplacedEmitter = new EventEmitter();

  constructor(private config: RunControllerConfig) {}

  getStatus(): RunControllerStatus {
    return this.status;
  }

  getRunPromise(): Promise<RunOutcome> | undefined {
    return this.runPromise;
  }

  onBusReplaced(listener: () => void): () => void {
    this.busReplacedEmitter.on("replaced", listener);
    return () => this.busReplacedEmitter.off("replaced", listener);
  }

  start(ideaText: string): void {
    if (this.status === "running" || this.status === "stopped") {
      throw new Error("A run is already active");
    }
    if (this.status === "done") {
      this.eventBus = new RunEventBus();
      this.busReplacedEmitter.emit("replaced");
    }
    const params: OrchestratorParams = {
      ideaText,
      owner: this.config.owner,
      repoName: `idea-to-mvp-${Date.now()}`,
      starterDir: this.config.starterDir,
      workDir: mkdtempSync(join(tmpdir(), "idea-to-mvp-")),
      githubToken: this.config.githubToken,
    };
    this.runFrom(params, undefined);
  }

  stop(): void {
    if (
      this.status !== "running" ||
      !this.currentStage ||
      !ABORTABLE_STAGES.includes(this.currentStage) ||
      !this.activeController
    ) {
      throw new Error("No abortable stage is currently running");
    }
    this.activeController.abort();
  }

  resume(): void {
    if (this.status !== "stopped" || !this.snapshot) {
      throw new Error("No stopped run to resume");
    }
    this.status = "running";
    this.runFrom(this.snapshot.params, this.snapshot.resumeState);
  }

  private runFrom(params: OrchestratorParams, resumeState: ResumeState | undefined): void {
    this.status = "running";
    this.currentStage = undefined;
    this.activeController = new AbortController();

    const unsubscribe = this.eventBus.onEvent((event) => {
      if (event.status === "running") this.currentStage = event.stage;
    });

    const deps: OrchestratorDeps = { ...this.config.deps, eventBus: this.eventBus };
    this.runPromise = runOrchestrator(params, deps, resumeState, this.activeController.signal).then((outcome) => {
      unsubscribe();
      if (outcome.status === "stopped") {
        this.status = "stopped";
        this.snapshot = { params, resumeState: outcome.resumeState };
      } else {
        this.status = "done";
        this.snapshot = undefined;
      }
      return outcome;
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- runController`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runController.ts src/orchestrator/runController.test.ts
git commit -m "feat: add RunController to own start/stop/resume lifecycle of the active run"
```

---

## Task 7: Dashboard server control endpoints

**Files:**
- Modify: `src/dashboard/server.ts`
- Test: `src/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `RunController` from `../orchestrator/runController.js` (Task 6).
- Produces: `export interface RunSession { eventBus: RunEventBus; onBusReplaced(listener: () => void): () => void }` (the minimal shape `createEventsHandler` needs — `RunController` satisfies it structurally). `createEventsHandler(session: RunSession)`, `createRunHandlers(controller: Pick<RunController, "start" | "stop" | "resume">)` returning `{ start, stop, resume }` Express handlers, and `createDashboardServer(controller: RunController)` wiring `GET /events`, `POST /api/run`, `POST /api/run/stop`, `POST /api/run/resume`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/dashboard/server.test.ts` with:

```ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../orchestrator/events.js";
import type { RunEvent } from "../orchestrator/types.js";
import { createEventsHandler, createRunHandlers } from "./server.js";

const sampleEvent: RunEvent = {
  stage: "analyst",
  status: "running",
  message: "Analyzing idea",
  timestamp: "2026-09-06T00:00:00.000Z",
};

function makeFakeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    json: vi.fn(),
  };
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

describe("createEventsHandler", () => {
  it("streams the session's bus events to the response as SSE data lines", () => {
    const bus = new RunEventBus();
    const session = { eventBus: bus, onBusReplaced: () => () => {} };
    const handler = createEventsHandler(session);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    bus.emit(sampleEvent);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(sampleEvent)}\n\n`);
  });

  it("stops writing once the request closes", () => {
    const bus = new RunEventBus();
    const session = { eventBus: bus, onBusReplaced: () => () => {} };
    const handler = createEventsHandler(session);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    req.emit("close");
    bus.emit(sampleEvent);

    expect(res.write).not.toHaveBeenCalled();
  });

  it("ends open connections when the session's event bus is replaced", () => {
    let busReplacedListener: (() => void) | undefined;
    const session = {
      eventBus: new RunEventBus(),
      onBusReplaced: (listener: () => void) => {
        busReplacedListener = listener;
        return () => {};
      },
    };
    const handler = createEventsHandler(session);
    const req = new EventEmitter();
    const res = makeFakeRes();

    handler(req as never, res as never, (() => {}) as never);
    busReplacedListener?.();

    expect(res.end).toHaveBeenCalled();
  });
});

describe("createRunHandlers", () => {
  it("starts a run with the request body's ideaText and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: { ideaText: "Build a todo app" } } as never, res as never, (() => {}) as never);

    expect(controller.start).toHaveBeenCalledWith("Build a todo app");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 400 when ideaText is missing", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: {} } as never, res as never, (() => {}) as never);

    expect(controller.start).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 409 when starting while a run is already active", () => {
    const controller = {
      start: vi.fn(() => {
        throw new Error("A run is already active");
      }),
      stop: vi.fn(),
      resume: vi.fn(),
    };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: { ideaText: "x" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("stops the current run and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { stop } = createRunHandlers(controller);
    const res = makeFakeRes();

    stop({} as never, res as never, (() => {}) as never);

    expect(controller.stop).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 409 when stop() finds nothing abortable running", () => {
    const controller = {
      start: vi.fn(),
      stop: vi.fn(() => {
        throw new Error("No abortable stage is currently running");
      }),
      resume: vi.fn(),
    };
    const { stop } = createRunHandlers(controller);
    const res = makeFakeRes();

    stop({} as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("resumes a stopped run and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { resume } = createRunHandlers(controller);
    const res = makeFakeRes();

    resume({} as never, res as never, (() => {}) as never);

    expect(controller.resume).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dashboard/server`
Expected: FAIL — `createRunHandlers` doesn't exist yet, and `createEventsHandler` doesn't accept a `RunSession`/doesn't close connections on bus replacement.

- [ ] **Step 3: Implement the endpoints**

Replace the full contents of `src/dashboard/server.ts` with:

```ts
import { fileURLToPath } from "node:url";
import express from "express";
import type { RunEventBus } from "../orchestrator/events.js";
import type { RunController } from "../orchestrator/runController.js";

export interface RunSession {
  eventBus: RunEventBus;
  onBusReplaced(listener: () => void): () => void;
}

export function createEventsHandler(session: RunSession): express.RequestHandler {
  const openResponses = new Set<express.Response>();
  session.onBusReplaced(() => {
    for (const res of openResponses) res.end();
    openResponses.clear();
  });

  return (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    openResponses.add(res);

    const unsubscribe = session.eventBus.onEvent((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => {
      unsubscribe();
      openResponses.delete(res);
    });
  };
}

export function createRunHandlers(controller: Pick<RunController, "start" | "stop" | "resume">): {
  start: express.RequestHandler;
  stop: express.RequestHandler;
  resume: express.RequestHandler;
} {
  const start: express.RequestHandler = (req, res) => {
    const ideaText = (req.body as { ideaText?: string } | undefined)?.ideaText;
    if (!ideaText) {
      res.status(400).json({ error: "ideaText is required" });
      return;
    }
    try {
      controller.start(ideaText);
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };

  const stop: express.RequestHandler = (_req, res) => {
    try {
      controller.stop();
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };

  const resume: express.RequestHandler = (_req, res) => {
    try {
      controller.resume();
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };

  return { start, stop, resume };
}

export function createDashboardServer(controller: RunController): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));
  app.get("/events", createEventsHandler(controller));
  const { start, stop, resume } = createRunHandlers(controller);
  app.post("/api/run", start);
  app.post("/api/run/stop", stop);
  app.post("/api/run/resume", resume);
  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dashboard/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "feat: add POST /api/run, /api/run/stop, /api/run/resume to the dashboard server"
```

---

## Task 8: Wire the CLI through `RunController`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `RunController` from `./orchestrator/runController.js` (Task 6); `createDashboardServer(controller)` from `./dashboard/server.js` (Task 7, already changed to take a controller).

No new automated test — `main()` has never had test coverage beyond `parseArgs` (see `src/cli.test.ts`, unaffected by this task), since it wires together real network/filesystem side effects. Verify this task by a full build + the existing suite, plus a manual read-through against the checklist in Step 3.

- [ ] **Step 1: Confirm the baseline**

Run: `npm test` and `npm run build`
Expected: PASS / succeeds, using the `RunOutcome`-widening compile fix already made to `cli.ts` in Task 5.

- [ ] **Step 2: Rewrite `main()` to use `RunController`**

In `src/cli.ts`, replace the imports of `RunEventBus` and `runOrchestrator` with `RunController`:

```ts
import { RunController } from "./orchestrator/runController.js";
```

(Remove the now-unused `import { RunEventBus } from "./orchestrator/events.js";` and `import { runOrchestrator } from "./orchestrator/runOrchestrator.js";` lines. Also change the top `node:fs`/`node:os`/`node:path` imports — `RunController.start()` now generates `repoName`/`workDir` internally, so `mkdtempSync`, `tmpdir`, and `join` become unused: change `import { mkdtempSync, readFileSync, realpathSync } from "node:fs";` to `import { readFileSync, realpathSync } from "node:fs";` and delete the `import { tmpdir } from "node:os";` and `import { join } from "node:path";` lines entirely.)

Replace the body of `main()` from the `const eventBus = new RunEventBus();` line through the end of the outcome `if`/`else` chain with:

```ts
  const octokit = new Octokit({ auth: config.githubToken });
  const controller = new RunController({
    owner: config.targetGithubOwner,
    starterDir: fileURLToPath(new URL("../templates/starter", import.meta.url)),
    githubToken: config.githubToken,
    deps: {
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
  });

  controller.eventBus.onEvent((event) => {
    console.log(`[${event.stage}] ${event.status}: ${event.message}`);
  });

  const app = createDashboardServer(controller);
  app.listen(config.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
  });
  await open(`http://localhost:${config.port}`);

  controller.start(ideaText);
  const outcome = await controller.getRunPromise();

  if (outcome?.status === "deployed") {
    console.log(`Live at ${outcome.url}`);
  } else if (outcome?.status === "blocked") {
    console.log(`Blocked by QA - see ${outcome.prUrl}`);
  } else if (outcome?.status === "failed") {
    console.error(`Failed at stage ${outcome.stage}: ${outcome.error}`);
    process.exitCode = 1;
  } else {
    console.error(`Run stopped at stage ${outcome?.stage}`);
    process.exitCode = 1;
  }
```

Also remove the now-unused `repoName`/`workDir` local variables above this block (`RunController.start` computes both internally) — keep `const ideaText = readFileSync(parsed.ideaFilePath, "utf-8");`, which is still needed as the argument to `controller.start(ideaText)`.

- [ ] **Step 3: Verify by hand against this checklist**

- [ ] `npm run build` succeeds (no unused-import or type errors).
- [ ] `npm test` passes (in particular `src/cli.test.ts`'s `parseArgs` cases, untouched).
- [ ] Reading `main()` top to bottom: it still (a) parses args, (b) loads config, (c) reads the idea file, (d) opens the dashboard server before the run starts, (e) opens the browser, (f) starts exactly one run immediately, (g) exits non-zero on `failed` or `stopped`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "refactor: wire the CLI through RunController instead of calling runOrchestrator directly"
```

---

## Task 9: Stop/Resume buttons on `StageNode`

**Files:**
- Modify: `web/src/components/StageNode.tsx`, `web/vite.config.ts`
- Test: `web/src/components/StageNode.test.tsx`

**Interfaces:**
- Consumes: `ABORTABLE_STAGES` from `@/types` (Task 3); `Button` from `@/components/ui/button` (existing).
- Produces: `StageNode` renders a "Stop" button (`POST /api/run/stop`) when its stage is in `ABORTABLE_STAGES` and `status === "running"`, and a "Resume" button (`POST /api/run/resume`) when `status === "stopped"`. No button otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/components/StageNode.test.tsx`. First, add the import:

```ts
import userEvent from "@testing-library/user-event";
```

Then add these cases inside `describe("StageNode", ...)`:

```ts
  it("shows a Stop button for a running agent stage", () => {
    renderStageNode({
      id: "developer",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "developer", label: "Developer", status: "running", latestEvent: undefined },
    });

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("shows a Resume button for a stopped agent stage", () => {
    renderStageNode({
      id: "developer",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "developer", label: "Developer", status: "stopped", latestEvent: undefined },
    });

    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows no Stop/Resume button for a running non-agent stage", () => {
    renderStageNode({
      id: "deploy",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "deploy", label: "Deploy", status: "running", latestEvent: undefined },
    });

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("posts to /api/run/stop when Stop is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderStageNode({
      id: "developer",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "developer", label: "Developer", status: "running", latestEvent: undefined },
    });

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/run/stop", { method: "POST" });
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix web -- StageNode`
Expected: FAIL — `StageNode` renders no buttons yet, and `vi` needs importing if not already (it already is, from the existing `import { describe, expect, it } from "vitest";` line — add `vi` to that import list).

- [ ] **Step 3: Implement the buttons**

Replace the full contents of `web/src/components/StageNode.tsx` with:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { STAGE_STATUS_CONFIG } from "@/components/status";
import { cn } from "@/lib/utils";
import { ABORTABLE_STAGES } from "@/types";
import { STAGE_NODE_WIDTH, type StageFlowNode } from "@/lib/workflowGraph";

async function postRunAction(path: string): Promise<void> {
  await fetch(path, { method: "POST" });
}

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { stage, label, status, latestEvent } = data;
  const config = STAGE_STATUS_CONFIG[status];
  const Icon = config.icon;
  const abortable = ABORTABLE_STAGES.includes(stage);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        style={{ width: STAGE_NODE_WIDTH }}
        className={cn(
          "nodrag flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm",
          status === "running" && "border-primary/40",
        )}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left">
          <Icon className={cn("size-5 shrink-0", config.dotClassName, status === "running" && "animate-spin")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{label}</span>
              <span className={cn("text-xs font-medium", config.dotClassName)}>{config.label}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {latestEvent ? latestEvent.message : "Waiting for this stage to start"}
            </p>
          </div>
        </button>
        {abortable && status === "running" && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              void postRunAction("/api/run/stop");
            }}
          >
            Stop
          </Button>
        )}
        {abortable && status === "stopped" && (
          <Button
            type="button"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              void postRunAction("/api/run/resume");
            }}
          >
            Resume
          </Button>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
```

Add the `/api` proxy alongside the existing `/events` one in `web/vite.config.ts`:

```ts
  server: {
    proxy: {
      '/events': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix web -- StageNode`
Expected: PASS — all existing cases (label/status/message rendering, pending placeholder) plus the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StageNode.tsx web/src/components/StageNode.test.tsx web/vite.config.ts
git commit -m "feat: add Stop/Resume buttons to running/stopped agent stage nodes"
```

---

## Task 10: Idle-state "Start a run" form in `WorkflowsView`

**Files:**
- Modify: `web/src/components/WorkflowsView.tsx`
- Test: `web/src/components/WorkflowsView.test.tsx`

**Interfaces:**
- Consumes: `deriveOverallStatus` from `@/lib/runEvents` (existing); `Button` from `@/components/ui/button` (existing).
- Produces: when `deriveOverallStatus(eventsByStage) === "idle"`, `WorkflowsView` renders an idea textarea (labeled "Idea") and a "Start run" button that `POST`s `{ ideaText }` to `/api/run` instead of rendering the canvas. Any other overall status renders the canvas as before.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/components/WorkflowsView.test.tsx`. First, add the import:

```ts
import { vi } from "vitest";
```

(Merge into the existing `import { describe, expect, it } from "vitest";` line instead if you prefer a single import statement.)

Then add these cases inside `describe("WorkflowsView", ...)`:

```ts
  it("shows an idea input and Start button when idle (no events yet)", () => {
    render(<WorkflowsView eventsByStage={{}} />);

    expect(screen.getByLabelText("Idea")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });

  it("posts the idea text to /api/run when Start is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<WorkflowsView eventsByStage={{}} />);

    await user.type(screen.getByLabelText("Idea"), "Build a todo app");
    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaText: "Build a todo app" }),
    });
    vi.unstubAllGlobals();
  });

  it("does not show the idea form once a run has started", () => {
    render(<WorkflowsView eventsByStage={eventsByStage} />);

    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix web -- WorkflowsView`
Expected: FAIL — there's no idea form yet, so `getByLabelText("Idea")` throws.

- [ ] **Step 3: Implement the idle-state form**

Replace the full contents of `web/src/components/WorkflowsView.tsx` with:

```tsx
import { useMemo, useState } from "react";
import { Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { StageNode } from "@/components/StageNode";
import { StageDetailSheet } from "@/components/StageDetailSheet";
import { deriveOverallStatus, deriveStageStatus, type EventsByStage } from "@/lib/runEvents";
import { buildStageEdges, buildStageNodes } from "@/lib/workflowGraph";
import { STAGE_LABELS, type StageName } from "@/types";

interface WorkflowsViewProps {
  eventsByStage: EventsByStage;
}

const nodeTypes = { stage: StageNode };

export function WorkflowsView({ eventsByStage }: WorkflowsViewProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [starting, setStarting] = useState(false);

  const nodes = useMemo(() => buildStageNodes(eventsByStage), [eventsByStage]);
  const edges = useMemo(() => buildStageEdges(eventsByStage), [eventsByStage]);
  const isIdle = deriveOverallStatus(eventsByStage) === "idle";

  const selectedEvents = selectedStage ? (eventsByStage[selectedStage] ?? []) : [];

  async function handleStart() {
    setStarting(true);
    try {
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText }),
      });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Live pipeline stages for the current run. Click a stage to see its full log.
        </p>
      </div>
      {isIdle ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6">
          <label htmlFor="idea-text" className="text-sm font-medium text-foreground">
            Idea
          </label>
          <textarea
            id="idea-text"
            className="w-full max-w-lg rounded-lg border border-border bg-background p-3 text-sm"
            style={{ minHeight: 96 }}
            placeholder="Describe the product idea to build..."
            value={ideaText}
            onChange={(event) => setIdeaText(event.target.value)}
          />
          <Button onClick={handleStart} disabled={!ideaText.trim() || starting}>
            {starting ? "Starting..." : "Start run"}
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedStage(node.data.stage)}
              fitView
              // All 11 stage nodes span (11 - 1) * STAGE_NODE_X_SPACING + STAGE_NODE_WIDTH = 3040px at
              // zoom 1. React Flow's default minZoom (0.5) can't zoom out far enough for fitView to fit
              // that span into a typical ~900-1000px canvas pane (would need ~0.33), so it clamps at 0.5
              // and only a subset of stages are visible on first render. Lowering minZoom lets fitView
              // zoom out as far as the math requires, even on a fairly narrow window.
              minZoom={0.1}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              elementsSelectable={false}
            >
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      )}
      <StageDetailSheet
        label={selectedStage ? STAGE_LABELS[selectedStage] : undefined}
        status={deriveStageStatus(selectedEvents)}
        events={selectedEvents}
        open={selectedStage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedStage(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix web -- WorkflowsView`
Expected: PASS — the 3 existing cases (they use `eventsByStage` with an `analyst` entry, so `isIdle` is `false` and the canvas still renders) plus the 3 new idle-form cases.

- [ ] **Step 5: Run the full test suites one last time**

Run: `npm test && npm test --prefix web`
Expected: PASS — full backend and frontend suites green.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/WorkflowsView.tsx web/src/components/WorkflowsView.test.tsx
git commit -m "feat: show an idea input and Start button in the dashboard when idle"
```
