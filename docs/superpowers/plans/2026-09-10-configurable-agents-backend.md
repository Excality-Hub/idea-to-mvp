# Configurable Agents & Workflows — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a run be driven by a named, persisted `WorkflowDefinition` that inserts user-defined, read-only `AgentDefinition` steps at three fixed points around the pipeline's unchanged backbone (`create_repo → analyst → architect → open_issue → developer → open_pr → qa → post_review → merge/deploy → tracing_pack`), fully exercised through unit tests and the dashboard's HTTP API — no UI in this plan.

**Architecture:** Two flat-JSON-file-backed stores (`AgentStore`, `WorkflowStore`) built on one generic `JsonStore<T>` helper. `runOrchestrator.ts`'s hardcoded `STAGE_STEPS` array becomes a `buildStageSteps(resolvedWorkflow)` function that splices generated custom-agent steps into the unchanged backbone steps at three slots (`afterAnalyst`, `afterArchitect`, `afterQa`). `RunController.start(ideaText, workflowId)` resolves the named workflow's agent ids into full `AgentDefinition`s before calling `runOrchestrator`, and records the resulting stage order for a new `GET /api/run/plan` endpoint. New `/api/agents` and `/api/workflows` REST endpoints provide CRUD. One deliberate simplification versus the design spec: a `customOutputs` context field was dropped in favor of reusing the existing `ctx.tracingEntries` (already accumulates every prior stage's output) to build a custom agent's "context so far" — same behavior, one field instead of two. `GET /api/run/plan` returns a plain ordered `StageName[]` rather than `{stage, label}[]` — the dashboard (a later plan) already has hardcoded backbone labels and can get a custom stage's label from `GET /api/agents` by id, so the backend doesn't need to know about display labels at all.

**Tech Stack:** TypeScript, Node 20+, Express, Zod, Vitest — matching the rest of this repo. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-configurable-agents-design.md`

## Global Constraints

- Custom agents are read-only: `allowedTools` is `["Read"]` when `repoAccess` is true, `[]` otherwise — never `Bash`/`Write`/`Edit`.
- The backbone's 10 `STAGE_STEPS` entries (`create_repo` through `deploy`) and their relative order are unchanged; only insertion of custom steps is new.
- An agent may appear in at most one slot, at most once, within a single workflow (stage names must stay unique within a run) — enforced by the workflow-create handler, not by the store.
- Persistence is flat JSON files under `data/` (`data/agents.json`, `data/workflows.json`), gitignored, via a generic synchronous `JsonStore<T>` — no database.
- The built-in workflow with id `"default"` always exists, has all-empty slots, and cannot be edited or deleted.
- All existing tests must keep passing unchanged in behavior (only shared test fixtures gain the new required fields) — this is a refactor of the pipeline's construction, not a behavior change for the default workflow.

---

### Task 1: Generic JSON file store

**Files:**
- Create: `src/jsonStore.ts`
- Test: `src/jsonStore.test.ts`

**Interfaces:**
- Produces: `interface JsonStore<T extends { id: string }> { list(): T[]; get(id: string): T | undefined; create(item: T): void; delete(id: string): void; }` and `function createJsonStore<T extends { id: string }>(filePath: string, seed?: T[]): JsonStore<T>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/jsonStore.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonStore } from "./jsonStore.js";

interface Widget {
  id: string;
  name: string;
}

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "json-store-test-"));
  return join(dir, "widgets.json");
}

describe("createJsonStore", () => {
  it("seeds the file with the given items when it doesn't exist yet", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, [{ id: "a", name: "A" }]);

    expect(store.list()).toEqual([{ id: "a", name: "A" }]);
  });

  it("starts empty when no seed is given and the file doesn't exist", () => {
    const store = createJsonStore<Widget>(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("persists a created item so a fresh store reading the same file sees it", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, []);

    store.create({ id: "b", name: "B" });

    const reopened = createJsonStore<Widget>(filePath, []);
    expect(reopened.list()).toEqual([{ id: "b", name: "B" }]);
  });

  it("get() finds an item by id, or returns undefined", () => {
    const store = createJsonStore<Widget>(tempFile(), [{ id: "a", name: "A" }]);

    expect(store.get("a")).toEqual({ id: "a", name: "A" });
    expect(store.get("missing")).toBeUndefined();
  });

  it("delete() removes an item by id and persists the removal", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, [{ id: "a", name: "A" }, { id: "b", name: "B" }]);

    store.delete("a");

    expect(store.list()).toEqual([{ id: "b", name: "B" }]);
    const reopened = createJsonStore<Widget>(filePath, []);
    expect(reopened.list()).toEqual([{ id: "b", name: "B" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/jsonStore.test.ts`
Expected: FAIL — `Cannot find module './jsonStore.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/jsonStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface JsonStore<T extends { id: string }> {
  list(): T[];
  get(id: string): T | undefined;
  create(item: T): void;
  delete(id: string): void;
}

export function createJsonStore<T extends { id: string }>(filePath: string, seed: T[] = []): JsonStore<T> {
  function readAll(): T[] {
    if (!existsSync(filePath)) return seed;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T[];
  }

  function writeAll(items: T[]): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(items, null, 2));
  }

  if (!existsSync(filePath) && seed.length > 0) {
    writeAll(seed);
  }

  return {
    list: () => readAll(),
    get: (id) => readAll().find((item) => item.id === id),
    create: (item) => writeAll([...readAll(), item]),
    delete: (id) => writeAll(readAll().filter((item) => item.id !== id)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/jsonStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/jsonStore.ts src/jsonStore.test.ts
git commit -m "feat: add generic JSON file-backed store"
```

---

### Task 2: Agent definition type and input schema

**Files:**
- Create: `src/agents/types.ts`

**Interfaces:**
- Consumes: nothing new (only `zod`, already a dependency).
- Produces: `interface AgentDefinition { id: string; name: string; instructions: string; repoAccess: boolean; createdAt: string; }`, `const AgentDefinitionInputSchema: z.ZodType<{ name: string; instructions: string; repoAccess: boolean }>`, `type AgentDefinitionInput`.

No dedicated test file — this file is pure declarations, matching the existing convention in `src/agents/schemas.ts` (also untested directly; exercised through its consumers).

- [ ] **Step 1: Write the file**

```typescript
// src/agents/types.ts
import { z } from "zod";

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  createdAt: string;
}

export const AgentDefinitionInputSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  repoAccess: z.boolean(),
});
export type AgentDefinitionInput = z.infer<typeof AgentDefinitionInputSchema>;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/agents/types.ts
git commit -m "feat: add AgentDefinition type and input schema"
```

---

### Task 3: Agent store

**Files:**
- Create: `src/agents/agentStore.ts`
- Test: `src/agents/agentStore.test.ts`

**Interfaces:**
- Consumes: `createJsonStore` from `../jsonStore.js` (Task 1), `AgentDefinition` from `./types.js` (Task 2).
- Produces: `type AgentStore = JsonStore<AgentDefinition>` and `function createAgentStore(filePath: string): AgentStore`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/agents/agentStore.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentStore } from "./agentStore.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-store-test-"));
  return join(dir, "agents.json");
}

describe("createAgentStore", () => {
  it("starts empty when the file doesn't exist yet", () => {
    const store = createAgentStore(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("creates and lists an agent", () => {
    const store = createAgentStore(tempFile());
    const agent = {
      id: "sec-1",
      name: "Security Reviewer",
      instructions: "Look for injection and auth bypass issues.",
      repoAccess: true,
      createdAt: "2026-09-10T00:00:00.000Z",
    };

    store.create(agent);

    expect(store.list()).toEqual([agent]);
    expect(store.get("sec-1")).toEqual(agent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/agents/agentStore.test.ts`
Expected: FAIL — `Cannot find module './agentStore.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/agents/agentStore.ts
import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { AgentDefinition } from "./types.js";

export type AgentStore = JsonStore<AgentDefinition>;

export function createAgentStore(filePath: string): AgentStore {
  return createJsonStore<AgentDefinition>(filePath, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/agents/agentStore.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agents/agentStore.ts src/agents/agentStore.test.ts
git commit -m "feat: add agent store"
```

---

### Task 4: Extend orchestrator types for workflows

**Files:**
- Modify: `src/orchestrator/types.ts`

**Interfaces:**
- Consumes: `AgentDefinition` from `../agents/types.js` (Task 2).
- Produces: `StageName` now includes `` `custom:${string}` ``; `interface WorkflowDefinition { id: string; name: string; slots: { afterAnalyst: string[]; afterArchitect: string[]; afterQa: string[] }; createdAt: string; }`; `const WorkflowInputSchema` (zod) and `type WorkflowInput`; `interface ResolvedWorkflow { afterAnalyst: AgentDefinition[]; afterArchitect: AgentDefinition[]; afterQa: AgentDefinition[]; }`.

This task only adds new exports and widens `StageName` — it doesn't change `ABORTABLE_STAGES` or `RunEvent`, so `types.test.ts` keeps passing unchanged.

- [ ] **Step 1: Modify the file**

Add `import { z } from "zod";` to the top, change the `StageName` union, and append the new types at the end:

```typescript
// src/orchestrator/types.ts
import { z } from "zod";
import type { AgentUsage } from "../claudeAgent.js";
import type { AgentDefinition } from "../agents/types.js";

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
  | "tracing_pack"
  | `custom:${string}`;

export type StageStatus = "running" | "done" | "failed" | "blocked" | "stopped";

export interface RunEvent {
  stage: StageName;
  status: StageStatus;
  message: string;
  timestamp: string;
  input?: unknown;
  output?: unknown;
  usage?: AgentUsage;
}

export const ABORTABLE_STAGES: StageName[] = ["analyst", "architect", "developer", "qa"];

export interface WorkflowDefinition {
  id: string;
  name: string;
  slots: {
    afterAnalyst: string[];
    afterArchitect: string[];
    afterQa: string[];
  };
  createdAt: string;
}

export const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  slots: z.object({
    afterAnalyst: z.array(z.string()),
    afterArchitect: z.array(z.string()),
    afterQa: z.array(z.string()),
  }),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export interface ResolvedWorkflow {
  afterAnalyst: AgentDefinition[];
  afterArchitect: AgentDefinition[];
  afterQa: AgentDefinition[];
}
```

- [ ] **Step 2: Run the existing test to confirm nothing broke**

Run: `npm test -- src/orchestrator/types.test.ts`
Expected: PASS (1 test, unchanged)

- [ ] **Step 3: Verify the whole project still compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/types.ts
git commit -m "feat: add WorkflowDefinition, ResolvedWorkflow, and a custom StageName variant"
```

---

### Task 5: Workflow store, seeded with the default workflow

**Files:**
- Create: `src/orchestrator/workflowStore.ts`
- Test: `src/orchestrator/workflowStore.test.ts`

**Interfaces:**
- Consumes: `createJsonStore` from `../jsonStore.js` (Task 1), `WorkflowDefinition` from `./types.js` (Task 4).
- Produces: `type WorkflowStore = JsonStore<WorkflowDefinition>`, `function createWorkflowStore(filePath: string): WorkflowStore`, `const DEFAULT_WORKFLOW_ID = "default"`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/orchestrator/workflowStore.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflowStore, DEFAULT_WORKFLOW_ID } from "./workflowStore.js";

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-store-test-"));
  return join(dir, "workflows.json");
}

describe("createWorkflowStore", () => {
  it("seeds a default workflow with empty slots when the file doesn't exist yet", () => {
    const store = createWorkflowStore(tempFile());

    const workflows = store.list();
    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      id: DEFAULT_WORKFLOW_ID,
      name: "Default",
      slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
    });
  });

  it("creates and lists an additional workflow alongside the default", () => {
    const store = createWorkflowStore(tempFile());
    const workflow = {
      id: "with-review",
      name: "With security review",
      slots: { afterAnalyst: [], afterArchitect: ["sec-1"], afterQa: [] },
      createdAt: "2026-09-10T00:00:00.000Z",
    };

    store.create(workflow);

    expect(store.list().map((w) => w.id)).toEqual([DEFAULT_WORKFLOW_ID, "with-review"]);
    expect(store.get("with-review")).toEqual(workflow);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/orchestrator/workflowStore.test.ts`
Expected: FAIL — `Cannot find module './workflowStore.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/orchestrator/workflowStore.ts
import { createJsonStore, type JsonStore } from "../jsonStore.js";
import type { WorkflowDefinition } from "./types.js";

export type WorkflowStore = JsonStore<WorkflowDefinition>;

export const DEFAULT_WORKFLOW_ID = "default";

const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: DEFAULT_WORKFLOW_ID,
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: new Date(0).toISOString(),
};

export function createWorkflowStore(filePath: string): WorkflowStore {
  return createJsonStore<WorkflowDefinition>(filePath, [DEFAULT_WORKFLOW]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/orchestrator/workflowStore.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/workflowStore.ts src/orchestrator/workflowStore.test.ts
git commit -m "feat: add workflow store seeded with the default workflow"
```

---

### Task 6: Custom agent runner

**Files:**
- Create: `src/agents/custom.ts`
- Test: `src/agents/custom.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition` from `./types.js` (Task 2); `runClaudeAgent`, `extractClaudeResultText`, `extractClaudeUsage`, `type AgentResult` from `../claudeAgent.js` (existing).
- Produces: `interface CustomAgentOutput { text: string }`, `function buildCustomAgentPrompt(agent: AgentDefinition, contextText: string): string`, `function runCustomAgent(agent: AgentDefinition, contextText: string, cwd: string, signal?: AbortSignal): Promise<AgentResult<CustomAgentOutput>>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/agents/custom.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../claudeAgent.js", async () => {
  const actual = await vi.importActual<typeof import("../claudeAgent.js")>("../claudeAgent.js");
  return { ...actual, runClaudeAgent: vi.fn() };
});

import { runClaudeAgent } from "../claudeAgent.js";
import { buildCustomAgentPrompt, runCustomAgent } from "./custom.js";
import type { AgentDefinition } from "./types.js";

const agent: AgentDefinition = {
  id: "sec-1",
  name: "Security Reviewer",
  instructions: "Look for injection and auth bypass issues.",
  repoAccess: true,
  createdAt: "2026-09-10T00:00:00.000Z",
};

describe("buildCustomAgentPrompt", () => {
  it("includes the agent's name, instructions, and the given context", () => {
    const prompt = buildCustomAgentPrompt(agent, "IDEA:\nBuild a todo app");

    expect(prompt).toContain("Security Reviewer");
    expect(prompt).toContain("Look for injection and auth bypass issues.");
    expect(prompt).toContain("Build a todo app");
  });
});

describe("runCustomAgent", () => {
  it("returns the claude -p result text as output.text, with token usage", async () => {
    const rawOutput = JSON.stringify({
      result: "No injection issues found.",
      total_cost_usd: 0.02,
      usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    vi.mocked(runClaudeAgent).mockResolvedValue(rawOutput);

    const result = await runCustomAgent(agent, "IDEA:\nBuild a todo app", "/tmp/work");

    expect(result).toEqual({
      output: { text: "No injection issues found." },
      usage: {
        inputTokens: 200,
        outputTokens: 40,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.02,
      },
    });
  });

  it("requests the Read tool when repoAccess is true, and no tools when false", async () => {
    vi.mocked(runClaudeAgent).mockResolvedValue(JSON.stringify({ result: "ok" }));

    await runCustomAgent(agent, "context", "/tmp/work");
    expect(runClaudeAgent).toHaveBeenCalledWith(expect.objectContaining({ allowedTools: ["Read"] }));

    await runCustomAgent({ ...agent, repoAccess: false }, "context", "/tmp/work");
    expect(runClaudeAgent).toHaveBeenCalledWith(expect.objectContaining({ allowedTools: [] }));
  });

  it("forwards the abort signal to runClaudeAgent", async () => {
    vi.mocked(runClaudeAgent).mockResolvedValue(JSON.stringify({ result: "ok" }));
    const controller = new AbortController();

    await runCustomAgent(agent, "context", "/tmp/work", controller.signal);

    expect(runClaudeAgent).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/agents/custom.test.ts`
Expected: FAIL — `Cannot find module './custom.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/agents/custom.ts
import { extractClaudeResultText, extractClaudeUsage, runClaudeAgent, type AgentResult } from "../claudeAgent.js";
import type { AgentDefinition } from "./types.js";

export interface CustomAgentOutput {
  text: string;
}

export function buildCustomAgentPrompt(agent: AgentDefinition, contextText: string): string {
  return [
    `You are a custom pipeline stage named "${agent.name}", part of an idea-to-MVP pipeline.`,
    "",
    contextText,
    "",
    "INSTRUCTIONS:",
    agent.instructions,
    "",
    "Respond in plain text with your findings or output. Do not include a fenced JSON code block.",
  ].join("\n");
}

export async function runCustomAgent(
  agent: AgentDefinition,
  contextText: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentResult<CustomAgentOutput>> {
  const prompt = buildCustomAgentPrompt(agent, contextText);
  const rawOutput = await runClaudeAgent({
    prompt,
    cwd,
    allowedTools: agent.repoAccess ? ["Read"] : [],
    signal,
  });
  const resultText = extractClaudeResultText(rawOutput);
  return { output: { text: resultText }, usage: extractClaudeUsage(rawOutput) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/agents/custom.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agents/custom.ts src/agents/custom.test.ts
git commit -m "feat: add custom agent runner"
```

---

### Task 7: Dynamic stage-step assembly in the orchestrator

**Files:**
- Modify: `src/orchestrator/runOrchestrator.ts`
- Modify: `src/orchestrator/runOrchestrator.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition` from `../agents/types.js` (Task 2), `runCustomAgent` from `../agents/custom.js` (Task 6), `ResolvedWorkflow` from `./types.js` (Task 4).
- Produces: `OrchestratorParams` gains `resolvedWorkflow: ResolvedWorkflow`; `OrchestratorDeps["agents"]` gains `custom: typeof runCustomAgent`; exported `function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[]` (used by Task 8's `RunController`).

- [ ] **Step 1: Update the shared test fixtures so existing tests still compile and pass**

In `src/orchestrator/runOrchestrator.test.ts`, add the import and the two new required fields to the shared `params` and `makeDeps()`:

```typescript
// add near the top, alongside the existing imports
import type { ResolvedWorkflow } from "./types.js";

// replace the existing `const params: OrchestratorParams = { ... };` with:
const EMPTY_WORKFLOW: ResolvedWorkflow = { afterAnalyst: [], afterArchitect: [], afterQa: [] };

const params: OrchestratorParams = {
  ideaText: "Build a todo app",
  owner: "org",
  repoName: "idea-to-mvp-app-1",
  starterDir: "/templates/starter",
  workDir: "/tmp/work",
  githubToken: "test-token",
  resolvedWorkflow: EMPTY_WORKFLOW,
};

// inside makeDeps()'s `agents` object literal, add a `custom` field alongside analyst/architect/developer/qa:
    custom: vi.fn(),
```

- [ ] **Step 2: Run the existing suite to confirm it still fails only on missing implementation, not on the fixture change**

Run: `npm test -- src/orchestrator/runOrchestrator.test.ts`
Expected: same as before this task (all passing) once Step 3 below lands — for now, `npx tsc --noEmit` should show the fixtures type-check against the *current* `OrchestratorParams`/`OrchestratorDeps` (which don't have these fields yet), so this step will show type errors until Step 3 adds the fields. Note this and proceed directly to Step 3 — the fixture update and the implementation change are two halves of one compiling whole.

- [ ] **Step 3: Modify `runOrchestrator.ts`**

Add imports at the top:

```typescript
import type { AgentDefinition } from "../agents/types.js";
import type { runCustomAgent } from "../agents/custom.js";
```

and change the `type { ABORTABLE_STAGES, type RunEvent, type StageName }` import line to also bring in `ResolvedWorkflow`:

```typescript
import { ABORTABLE_STAGES, type ResolvedWorkflow, type RunEvent, type StageName } from "./types.js";
```

Add `resolvedWorkflow: ResolvedWorkflow;` to `OrchestratorParams`:

```typescript
export interface OrchestratorParams {
  ideaText: string;
  owner: string;
  repoName: string;
  starterDir: string;
  workDir: string;
  githubToken: string;
  resolvedWorkflow: ResolvedWorkflow;
}
```

Add `custom: typeof runCustomAgent;` to `OrchestratorDeps["agents"]`:

```typescript
  agents: {
    analyst: typeof runAnalystAgent;
    architect: typeof runArchitectAgent;
    developer: typeof runDeveloperAgent;
    qa: typeof runQaAgent;
    custom: typeof runCustomAgent;
  };
```

Rename the existing `const STAGE_STEPS: StageStep[] = [ ... ];` to `const BACKBONE_STEPS: StageStep[] = [ ... ];` — the array's contents (all 10 entries, `create_repo` through `deploy`) are unchanged, only the constant's name changes.

Immediately after the `BACKBONE_STEPS` constant (and before `export async function runOrchestrator`), add:

```typescript
function renderContextSoFar(ideaText: string, entries: TracingPackEntry[]): string {
  const sections = entries.map((entry) => `## ${entry.stage}\n${JSON.stringify(entry.output ?? {}, null, 2)}`);
  return [
    "IDEA:",
    ideaText,
    "",
    "OUTPUT SO FAR FROM EARLIER PIPELINE STAGES:",
    sections.length > 0 ? sections.join("\n\n") : "(none yet)",
  ].join("\n");
}

function buildCustomStep(agent: AgentDefinition): StageStep {
  const stageName = `custom:${agent.id}` as StageName;
  return {
    name: stageName,
    abortable: true,
    async run(ctx, params, deps, signal) {
      const contextText = renderContextSoFar(params.ideaText, ctx.tracingEntries);
      ctx.pendingInput = { agentName: agent.name, instructions: agent.instructions, repoAccess: agent.repoAccess };
      deps.eventBus.emit(stageEvent(stageName, "running", `Running ${agent.name}`, { input: ctx.pendingInput }));
      const { output, usage } = await deps.agents.custom(agent, contextText, params.workDir, signal);
      deps.eventBus.emit(stageEvent(stageName, "done", output.text.slice(0, 200), { output, usage }));
      ctx.tracingEntries.push({ stage: stageName, status: "done", input: ctx.pendingInput, output, usage });
    },
  };
}

export function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[] {
  const steps: StageStep[] = [];
  for (const step of BACKBONE_STEPS) {
    steps.push(step);
    if (step.name === "analyst") {
      steps.push(...resolvedWorkflow.afterAnalyst.map(buildCustomStep));
    } else if (step.name === "architect") {
      steps.push(...resolvedWorkflow.afterArchitect.map(buildCustomStep));
    } else if (step.name === "qa") {
      steps.push(...resolvedWorkflow.afterQa.map(buildCustomStep));
    }
  }
  return steps;
}
```

Finally, inside `runOrchestrator`, replace the two references to `STAGE_STEPS` with a locally computed `stageSteps`:

```typescript
export async function runOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDeps,
  resumeState?: ResumeState,
  onAbortableStep?: (controller: AbortController | undefined) => void,
): Promise<RunOutcome> {
  const ctx: PipelineContext = resumeState?.ctx ?? { tracingEntries: [] };
  const startIndex = resumeState?.stageIndex ?? 0;
  const stageSteps = buildStageSteps(params.resolvedWorkflow);

  // ... commitTracingPack unchanged ...

  let currentStage: StageName = stageSteps[startIndex]?.name ?? "create_repo";
  for (let i = startIndex; i < stageSteps.length; i++) {
    const step = stageSteps[i];
    // ... rest of the loop body unchanged, referencing `step` as before ...
```

(Only the two `STAGE_STEPS` identifiers become `stageSteps`; nothing else in the loop body changes.)

- [ ] **Step 4: Run the full orchestrator test file to confirm the refactor is behavior-preserving**

Run: `npm test -- src/orchestrator/runOrchestrator.test.ts`
Expected: PASS (all pre-existing tests, unchanged behavior since `EMPTY_WORKFLOW` produces the identical stage order)

- [ ] **Step 5: Write a new failing test for custom-stage insertion**

Append to `src/orchestrator/runOrchestrator.test.ts`:

```typescript
it("inserts a custom agent step after analyst, running it with the idea and prior output as context", async () => {
  const deps = makeDeps();
  vi.mocked(deps.agents.custom).mockResolvedValue({
    output: { text: "No security issues found." },
    usage: fakeUsage,
  });
  const workflowParams: OrchestratorParams = {
    ...params,
    resolvedWorkflow: {
      afterAnalyst: [
        {
          id: "sec-1",
          name: "Security Reviewer",
          instructions: "Look for auth bypass issues.",
          repoAccess: true,
          createdAt: "2026-09-10T00:00:00.000Z",
        },
      ],
      afterArchitect: [],
      afterQa: [],
    },
  };
  const events: string[] = [];
  deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

  const outcome = await runOrchestrator(workflowParams, deps);

  expect(outcome.status).toBe("deployed");
  const analystIndex = events.indexOf("analyst:done");
  const architectIndex = events.indexOf("architect:running");
  expect(events.slice(analystIndex + 1, architectIndex)).toEqual(["custom:sec-1:running", "custom:sec-1:done"]);
  expect(deps.agents.custom).toHaveBeenCalledWith(
    expect.objectContaining({ id: "sec-1", name: "Security Reviewer" }),
    expect.stringContaining("Build a todo app"),
    "/tmp/work",
    expect.anything(),
  );
});
```

- [ ] **Step 6: Run test to verify it fails for the right reason, then confirm it passes**

Run: `npm test -- src/orchestrator/runOrchestrator.test.ts`
Expected: with the Step 3 implementation already in place, this new test should PASS immediately (12 tests total, all passing). If it fails, the implementation in Step 3 has a bug — fix it before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/runOrchestrator.ts src/orchestrator/runOrchestrator.test.ts
git commit -m "feat: assemble stage steps from a resolved workflow instead of a fixed list"
```

---

### Task 8: RunController resolves workflows and exposes the run plan

**Files:**
- Modify: `src/orchestrator/runController.ts`
- Modify: `src/orchestrator/runController.test.ts`

**Interfaces:**
- Consumes: `AgentStore` from `../agents/agentStore.js` (Task 3), `WorkflowStore`, `DEFAULT_WORKFLOW_ID` from `./workflowStore.js` (Task 5), `buildStageSteps` from `./runOrchestrator.js` (Task 7), `ResolvedWorkflow`, `StageName` from `./types.js`.
- Produces: `RunControllerConfig` gains `agentStore: AgentStore; workflowStore: WorkflowStore;`; `RunController.start(ideaText: string, workflowId?: string): void` (default `"default"`); new `RunController.getPlan(): StageName[] | undefined`.

- [ ] **Step 1: Update `runController.test.ts`'s fixtures**

Add imports and two fake in-memory stores, then wire them into `makeConfig()`:

```typescript
// add near the top, alongside the existing imports
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import type { WorkflowDefinition } from "./types.js";
import type { WorkflowStore } from "./workflowStore.js";

function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: () => agents,
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[]): WorkflowStore {
  return {
    list: () => workflows,
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: "default",
  name: "Default",
  slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};
```

Then, inside `makeConfig()`, add `custom: vi.fn()` to the `agents` object and add the two new top-level fields to the returned config:

```typescript
  const agents = {
    analyst: vi.fn().mockResolvedValue({ /* unchanged */ }),
    architect: vi.fn().mockResolvedValue({ /* unchanged */ }),
    developer: vi.fn().mockResolvedValue({ /* unchanged */ }),
    qa: vi.fn().mockResolvedValue({ /* unchanged */ }),
    custom: vi.fn(),
  };
  return {
    owner: "org",
    starterDir: "/templates/starter",
    githubToken: "test-token",
    agentStore: makeAgentStore(),
    workflowStore: makeWorkflowStore([DEFAULT_WORKFLOW]),
    deps: {
      /* unchanged */
    },
  };
```

(The `/* unchanged */` markers above mean: keep the existing mock bodies exactly as they are today — only the new lines are additions.)

- [ ] **Step 2: Run the existing suite to see it fail on the config shape**

Run: `npm test -- src/orchestrator/runController.test.ts`
Expected: FAIL — TypeScript error, `agentStore`/`workflowStore` missing on `RunControllerConfig` (they don't exist yet) or, once added to the test, a runtime error inside `start()` since the implementation doesn't use them yet. Proceed to Step 3.

- [ ] **Step 3: Modify `runController.ts`**

Add imports:

```typescript
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import { DEFAULT_WORKFLOW_ID, type WorkflowStore } from "./workflowStore.js";
import type { ResolvedWorkflow, StageName } from "./types.js";
```

and change the `buildStageSteps` import in alongside the existing `runOrchestrator` import:

```typescript
import {
  buildStageSteps,
  runOrchestrator,
  type OrchestratorDeps,
  type OrchestratorParams,
  type ResumeState,
  type RunOutcome,
} from "./runOrchestrator.js";
```

Add the two new fields to `RunControllerConfig`:

```typescript
export interface RunControllerConfig {
  owner: string;
  starterDir: string;
  githubToken: string;
  agentStore: AgentStore;
  workflowStore: WorkflowStore;
  deps: Omit<OrchestratorDeps, "eventBus">;
}
```

Add a `private plan: StageName[] | undefined;` field to the class, a `getPlan()` accessor, and rewrite `start()`:

```typescript
export class RunController {
  eventBus: RunEventBus = new RunEventBus();

  private status: RunControllerStatus = "idle";
  private activeController: AbortController | undefined;
  private snapshot: { params: OrchestratorParams; resumeState: ResumeState } | undefined;
  private runPromise: Promise<RunOutcome> | undefined;
  private busReplacedEmitter = new EventEmitter();
  private plan: StageName[] | undefined;

  constructor(private config: RunControllerConfig) {}

  getStatus(): RunControllerStatus {
    return this.status;
  }

  getRunPromise(): Promise<RunOutcome> | undefined {
    return this.runPromise;
  }

  getPlan(): StageName[] | undefined {
    return this.plan;
  }

  onBusReplaced(listener: () => void): () => void {
    this.busReplacedEmitter.on("replaced", listener);
    return () => this.busReplacedEmitter.off("replaced", listener);
  }

  start(ideaText: string, workflowId: string = DEFAULT_WORKFLOW_ID): void {
    if (this.status === "running" || this.status === "stopped") {
      throw new Error("A run is already active");
    }
    if (this.status === "done") {
      this.eventBus = new RunEventBus();
      this.busReplacedEmitter.emit("replaced");
    }
    const workflow = this.config.workflowStore.get(workflowId);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
    const resolveAgents = (ids: string[]): AgentDefinition[] =>
      ids.map((id) => {
        const agent = this.config.agentStore.get(id);
        if (!agent) throw new Error(`Unknown agent: ${id}`);
        return agent;
      });
    const resolvedWorkflow: ResolvedWorkflow = {
      afterAnalyst: resolveAgents(workflow.slots.afterAnalyst),
      afterArchitect: resolveAgents(workflow.slots.afterArchitect),
      afterQa: resolveAgents(workflow.slots.afterQa),
    };
    this.plan = [...buildStageSteps(resolvedWorkflow).map((step) => step.name), "tracing_pack"];
    const params: OrchestratorParams = {
      ideaText,
      owner: this.config.owner,
      repoName: `idea-to-mvp-${Date.now()}`,
      starterDir: this.config.starterDir,
      workDir: mkdtempSync(join(tmpdir(), "idea-to-mvp-")),
      githubToken: this.config.githubToken,
      resolvedWorkflow,
    };
    this.runFrom(params, undefined);
  }

  // stop(), resume(), and runFrom() are unchanged.
```

- [ ] **Step 4: Run the existing suite to confirm it's behavior-preserving**

Run: `npm test -- src/orchestrator/runController.test.ts`
Expected: PASS (all 6 pre-existing tests)

- [ ] **Step 5: Write new failing tests for workflow resolution and the plan**

Append to `src/orchestrator/runController.test.ts`:

```typescript
it("throws when starting with an unknown workflow id", () => {
  const controller = new RunController(makeConfig());

  expect(() => controller.start("Build a todo app", "nope")).toThrow("Unknown workflow: nope");
});

it("exposes the resolved stage order via getPlan()", async () => {
  const controller = new RunController(makeConfig());

  controller.start("Build a todo app");
  await controller.getRunPromise();

  expect(controller.getPlan()).toEqual([
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
  ]);
});

it("runs a custom agent inserted by a non-default workflow", async () => {
  const config = makeConfig();
  const securityReviewer: AgentDefinition = {
    id: "sec-1",
    name: "Security Reviewer",
    instructions: "Look for auth bypass issues.",
    repoAccess: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  config.agentStore = makeAgentStore([securityReviewer]);
  config.workflowStore = makeWorkflowStore([
    DEFAULT_WORKFLOW,
    {
      id: "with-review",
      name: "With security review",
      slots: { afterAnalyst: ["sec-1"], afterArchitect: [], afterQa: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  vi.mocked(config.deps.agents.custom).mockResolvedValue({
    output: { text: "No issues found." },
    usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.001 },
  });
  const controller = new RunController(config);

  controller.start("Build a todo app", "with-review");
  const outcome = await controller.getRunPromise();

  expect(outcome?.status).toBe("deployed");
  expect(controller.getPlan()).toContain("custom:sec-1");
  expect(config.deps.agents.custom).toHaveBeenCalled();
});
```

- [ ] **Step 6: Run test to verify these pass**

Run: `npm test -- src/orchestrator/runController.test.ts`
Expected: PASS (9 tests total)

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/runController.ts src/orchestrator/runController.test.ts
git commit -m "feat: resolve named workflows in RunController and expose the run plan"
```

---

### Task 9: Dashboard API for agents and workflows

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `AgentStore` (Task 3), `AgentDefinitionInputSchema`, `AgentDefinition` (Task 2), `WorkflowStore`, `DEFAULT_WORKFLOW_ID` (Task 5), `WorkflowInputSchema`, `WorkflowDefinition` (Task 4), `RunController.getPlan()` (Task 8).
- Produces: `createAgentHandlers(agentStore, workflowStore)`, `createWorkflowHandlers(workflowStore, agentStore)`, and `createDashboardServer(controller, agentStore, workflowStore)` (signature change — now takes the two stores).

- [ ] **Step 1: Write the failing tests**

Append to `src/dashboard/server.test.ts` (add these imports alongside the existing ones):

```typescript
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStore } from "../agents/agentStore.js";
import type { WorkflowDefinition } from "../orchestrator/types.js";
import type { WorkflowStore } from "../orchestrator/workflowStore.js";
import { createAgentHandlers, createWorkflowHandlers } from "./server.js";

function makeAgentStore(agents: AgentDefinition[] = []): AgentStore {
  return {
    list: vi.fn(() => agents),
    get: (id) => agents.find((a) => a.id === id),
    create: vi.fn((item) => agents.push(item)),
    delete: vi.fn(),
  };
}

function makeWorkflowStore(workflows: WorkflowDefinition[] = []): WorkflowStore {
  return {
    list: vi.fn(() => workflows),
    get: (id) => workflows.find((w) => w.id === id),
    create: vi.fn((item) => workflows.push(item)),
    delete: vi.fn(),
  };
}

describe("createAgentHandlers", () => {
  it("lists agents", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { list } = createAgentHandlers(agentStore, makeWorkflowStore());
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(agentStore.list());
  });

  it("creates an agent from a valid body and returns 201", () => {
    const agentStore = makeAgentStore();
    const { create } = createAgentHandlers(agentStore, makeWorkflowStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Security Reviewer", instructions: "check for bugs", repoAccess: true } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(agentStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Security Reviewer", instructions: "check for bugs", repoAccess: true }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when the create body is invalid", () => {
    const { create } = createAgentHandlers(makeAgentStore(), makeWorkflowStore());
    const res = makeFakeRes();

    create({ body: { name: "" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes an agent not referenced by any workflow", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { remove } = createAgentHandlers(agentStore, makeWorkflowStore([]));
    const res = makeFakeRes();

    remove({ params: { id: "a" } } as never, res as never, (() => {}) as never);

    expect(agentStore.delete).toHaveBeenCalledWith("a");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 409 when deleting an agent referenced by a workflow", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore([
      { id: "w1", name: "W1", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { remove } = createAgentHandlers(agentStore, workflowStore);
    const res = makeFakeRes();

    remove({ params: { id: "a" } } as never, res as never, (() => {}) as never);

    expect(agentStore.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("createWorkflowHandlers", () => {
  it("lists workflows", () => {
    const workflowStore = makeWorkflowStore([
      { id: "default", name: "Default", slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const { list } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    list({} as never, res as never, (() => {}) as never);

    expect(res.json).toHaveBeenCalledWith(workflowStore.list());
  });

  it("creates a workflow referencing only existing agents, and returns 201", () => {
    const agentStore = makeAgentStore([
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, agentStore);
    const res = makeFakeRes();

    create(
      { body: { name: "With A", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "With A", slots: { afterAnalyst: ["a"], afterArchitect: [], afterQa: [] } }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when a slot references an unknown agent id", () => {
    const { create } = createWorkflowHandlers(makeWorkflowStore(), makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Bad", slots: { afterAnalyst: ["missing"], afterArchitect: [], afterQa: [] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects deleting the default workflow with 400", () => {
    const workflowStore = makeWorkflowStore();
    const { remove } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    remove({ params: { id: "default" } } as never, res as never, (() => {}) as never);

    expect(workflowStore.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes a non-default workflow and returns 204", () => {
    const workflowStore = makeWorkflowStore();
    const { remove } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    remove({ params: { id: "with-review" } } as never, res as never, (() => {}) as never);

    expect(workflowStore.delete).toHaveBeenCalledWith("with-review");
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe("createRunHandlers with a workflowId", () => {
  it("starts a run with the given workflowId when provided", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn() };
    const { start } = createRunHandlers(controller);
    const res = makeFakeRes();

    start({ body: { ideaText: "Build a todo app", workflowId: "with-review" } } as never, res as never, (() => {}) as never);

    expect(controller.start).toHaveBeenCalledWith("Build a todo app", "with-review");
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/dashboard/server.test.ts`
Expected: FAIL — `createAgentHandlers`/`createWorkflowHandlers` are not exported yet

- [ ] **Step 3: Modify `server.ts`**

Add imports:

```typescript
import { randomUUID } from "node:crypto";
import type { AgentStore } from "../agents/agentStore.js";
import { AgentDefinitionInputSchema, type AgentDefinition } from "../agents/types.js";
import { DEFAULT_WORKFLOW_ID, type WorkflowStore } from "../orchestrator/workflowStore.js";
import { WorkflowInputSchema, type WorkflowDefinition } from "../orchestrator/types.js";
```

Add the two handler factories (after `createRunHandlers`, before `createDashboardServer`):

```typescript
export function createAgentHandlers(
  agentStore: AgentStore,
  workflowStore: WorkflowStore,
): { list: express.RequestHandler; create: express.RequestHandler; remove: express.RequestHandler } {
  const list: express.RequestHandler = (_req, res) => {
    res.json(agentStore.list());
  };

  const create: express.RequestHandler = (req, res) => {
    const parsed = AgentDefinitionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const agent: AgentDefinition = { id: randomUUID(), ...parsed.data, createdAt: new Date().toISOString() };
    agentStore.create(agent);
    res.status(201).json(agent);
  };

  const remove: express.RequestHandler = (req, res) => {
    const id = req.params.id;
    const inUse = workflowStore
      .list()
      .some((w) => w.slots.afterAnalyst.includes(id) || w.slots.afterArchitect.includes(id) || w.slots.afterQa.includes(id));
    if (inUse) {
      res.status(409).json({ error: "Agent is used by a workflow" });
      return;
    }
    agentStore.delete(id);
    res.status(204).end();
  };

  return { list, create, remove };
}

export function createWorkflowHandlers(
  workflowStore: WorkflowStore,
  agentStore: AgentStore,
): { list: express.RequestHandler; create: express.RequestHandler; remove: express.RequestHandler } {
  const list: express.RequestHandler = (_req, res) => {
    res.json(workflowStore.list());
  };

  const create: express.RequestHandler = (req, res) => {
    const parsed = WorkflowInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const allIds = [
      ...parsed.data.slots.afterAnalyst,
      ...parsed.data.slots.afterArchitect,
      ...parsed.data.slots.afterQa,
    ];
    const unknownId = allIds.find((id) => !agentStore.get(id));
    if (unknownId) {
      res.status(400).json({ error: `Unknown agent id: ${unknownId}` });
      return;
    }
    const workflow: WorkflowDefinition = { id: randomUUID(), ...parsed.data, createdAt: new Date().toISOString() };
    workflowStore.create(workflow);
    res.status(201).json(workflow);
  };

  const remove: express.RequestHandler = (req, res) => {
    if (req.params.id === DEFAULT_WORKFLOW_ID) {
      res.status(400).json({ error: "Cannot delete the default workflow" });
      return;
    }
    workflowStore.delete(req.params.id);
    res.status(204).end();
  };

  return { list, create, remove };
}
```

Update `createRunHandlers`'s `start` handler to accept an optional `workflowId`:

```typescript
  const start: express.RequestHandler = (req, res) => {
    const body = req.body as { ideaText?: string; workflowId?: string } | undefined;
    const ideaText = body?.ideaText;
    if (!ideaText) {
      res.status(400).json({ error: "ideaText is required" });
      return;
    }
    try {
      if (body?.workflowId) {
        controller.start(ideaText, body.workflowId);
      } else {
        controller.start(ideaText);
      }
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };
```

Update `createDashboardServer` to take the two stores and wire the new routes:

```typescript
export function createDashboardServer(
  controller: RunController,
  agentStore: AgentStore,
  workflowStore: WorkflowStore,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));
  app.get("/events", createEventsHandler(controller));
  const { start, stop, resume } = createRunHandlers(controller);
  app.post("/api/run", start);
  app.post("/api/run/stop", stop);
  app.post("/api/run/resume", resume);
  app.get("/api/run/plan", (_req, res) => {
    res.json(controller.getPlan() ?? []);
  });
  const agentHandlers = createAgentHandlers(agentStore, workflowStore);
  app.get("/api/agents", agentHandlers.list);
  app.post("/api/agents", agentHandlers.create);
  app.delete("/api/agents/:id", agentHandlers.remove);
  const workflowHandlers = createWorkflowHandlers(workflowStore, agentStore);
  app.get("/api/workflows", workflowHandlers.list);
  app.post("/api/workflows", workflowHandlers.create);
  app.delete("/api/workflows/:id", workflowHandlers.remove);
  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/dashboard/server.test.ts`
Expected: PASS (all pre-existing tests plus the new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "feat: add agents/workflows CRUD API and workflowId support to /api/run"
```

---

### Task 10: Wire stores into the CLI

**Files:**
- Modify: `src/cli.ts`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createAgentStore` (Task 3), `createWorkflowStore` (Task 5), `runCustomAgent` (Task 6), the new `createDashboardServer` signature (Task 9).

- [ ] **Step 1: Modify `src/cli.ts`**

Add imports:

```typescript
import { createAgentStore } from "./agents/agentStore.js";
import { runCustomAgent } from "./agents/custom.js";
import { createWorkflowStore } from "./orchestrator/workflowStore.js";
```

Inside `main()`, before constructing `RunController`, create the two stores and pass them through:

```typescript
  const agentStore = createAgentStore(fileURLToPath(new URL("../data/agents.json", import.meta.url)));
  const workflowStore = createWorkflowStore(fileURLToPath(new URL("../data/workflows.json", import.meta.url)));
  const controller = new RunController({
    owner: config.targetGithubOwner,
    starterDir,
    githubToken: config.githubToken,
    agentStore,
    workflowStore,
    deps: {
      github: new GithubClient(octokit),
      deploy: deployClient,
      git: { cloneRepo, createAndCheckoutBranch, resetWorkingTree, pushBranch, diffAgainstBase },
      agents: {
        analyst: runAnalystAgent,
        architect: runArchitectAgent,
        developer: runDeveloperAgent,
        qa: runQaAgent,
        custom: runCustomAgent,
      },
      readStarterFiles,
    },
  });
```

and update the `createDashboardServer` call:

```typescript
  const app = createDashboardServer(controller, agentStore, workflowStore);
```

- [ ] **Step 2: Add `data/` to `.gitignore`**

```
node_modules/
dist/
.env
.superpowers/
data/
```

- [ ] **Step 3: Add a short README note**

In `README.md`, in the "Manual demo" section, after the existing numbered steps, add:

```markdown
Custom agents and workflows you create are persisted to `data/agents.json`
and `data/workflows.json` (gitignored) via `POST /api/agents` and
`POST /api/workflows` — see `docs/superpowers/specs/2026-09-10-configurable-agents-design.md`.
There is no dashboard UI for authoring them yet; use the API directly, e.g.:

```bash
curl -X POST localhost:3000/api/agents -H 'Content-Type: application/json' \
  -d '{"name":"Security Reviewer","instructions":"Look for auth bypass and injection issues.","repoAccess":true}'
```
```

- [ ] **Step 4: Verify the full build and test suite**

Run: `npm run build && npm test && npx tsc --noEmit`
Expected: build succeeds, all tests pass, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts .gitignore README.md
git commit -m "feat: wire agent and workflow stores into the CLI"
```

---

## Definition of done

- `npm test` and `npx tsc --noEmit` both pass.
- `npm run build` succeeds.
- Manually: boot the dashboard (`npm run dev`), `POST /api/agents` to create a read-access agent, `POST /api/workflows` with that agent in `afterAnalyst`, `POST /api/run` with that `workflowId`, and confirm via `GET /api/run/plan` and the `/events` SSE stream that the custom stage runs at the right point and its output appears in the emitted events and the repo's committed `TRACING_PACK.md`.

## Next plan

Once this lands, a follow-up plan builds the dashboard UI: an "Agents" page and a "Pipelines" page (create/list/delete agents and workflows visually instead of via `curl`), a workflow picker on the idle idea-input form, and making the live canvas fetch `GET /api/run/plan` (joined with `GET /api/agents` for custom-stage labels) instead of its current hardcoded `STAGE_ORDER`.
