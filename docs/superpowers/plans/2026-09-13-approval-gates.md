# Human Approval Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drop an "Approval gate" onto any splice point in the pipeline canvas; when a run reaches it, the run pauses until a human approves (continue) or rejects (end the run, blocked) from the dashboard.

**Architecture:** A gate is a bare `gate:<uuid>` marker string living in the existing `WorkflowDefinition.slots` arrays alongside agent ids — no new store, no schema migration. The orchestrator resolves each marker into a `SlotEntry` (`{kind:"agent"|"gate", ...}`), builds a `StageStep` for it that pauses the run (reusing the existing stopped/resumeState/snapshot machinery already used for user-initiated stops) until a decision is recorded, then either continues or ends the run blocked. The canvas and live-run UI get a new node/stage type (`gate:${string}`) alongside the existing `custom:${string}` one.

**Tech Stack:** TypeScript, Express, React, @xyflow/react (React Flow), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-13-approval-gates-design.md`

## Global Constraints

- A gate has no name, no metadata, no configurable review content — just a pause/approve/reject point (per spec Non-goals).
- No new backend store: a gate is a `gate:<uuid>` string in the existing `WorkflowDefinition.slots` string arrays.
- Rejecting a gate ends the run permanently (like today's QA-critical block) — no revision/resend loop.
- Gate ids are generated client-side with `crypto.randomUUID()` when the gate is dropped on the canvas.
- Stage name convention: a gate's `StageName` is `` `gate:${gateId}` ``, mirroring the existing `` `custom:${agentId}` `` convention.

---

### Task 1: Backend gate identity helpers + `StageName` type

**Files:**
- Modify: `src/orchestrator/types.ts`
- Test: `src/orchestrator/types.test.ts`

**Interfaces:**
- Produces: `GATE_ID_PREFIX: string`, `isGateEntry(id: string): boolean`, `parseGateId(id: string): string`, and `StageName` gaining the `` `gate:${string}` `` variant — all consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `src/orchestrator/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ABORTABLE_STAGES, isGateEntry, parseGateId } from "./types.js";

describe("ABORTABLE_STAGES", () => {
  it("lists exactly the four LLM-driven agent stages", () => {
    expect(ABORTABLE_STAGES).toEqual(["analyst", "architect", "developer", "qa"]);
  });
});

describe("isGateEntry", () => {
  it("is true for a gate-prefixed id", () => {
    expect(isGateEntry("gate:abc-123")).toBe(true);
  });

  it("is false for a plain agent id", () => {
    expect(isGateEntry("abc-123")).toBe(false);
  });
});

describe("parseGateId", () => {
  it("strips the gate: prefix", () => {
    expect(parseGateId("gate:abc-123")).toBe("abc-123");
  });
});
```

This replaces the file's existing content (the `ABORTABLE_STAGES` import line gains `isGateEntry, parseGateId`; the `ABORTABLE_STAGES` describe block is unchanged, just shown here for full file context).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root): `npx vitest run src/orchestrator/types.test.ts`
Expected: FAIL — `isGateEntry`/`parseGateId` are not exported from `./types.js`.

- [ ] **Step 3: Implement**

In `src/orchestrator/types.ts`, change the `StageName` union (currently ending in `` | \`custom:${string}\`; ``):

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
  | "tracing_pack"
  | `custom:${string}`
  | `gate:${string}`;
```

Then add, directly after the `export type BackboneStage = (typeof BACKBONE_STAGES)[number];` line:

```ts
export const GATE_ID_PREFIX = "gate:";

export function isGateEntry(id: string): boolean {
  return id.startsWith(GATE_ID_PREFIX);
}

export function parseGateId(id: string): string {
  return id.slice(GATE_ID_PREFIX.length);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/orchestrator/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/types.test.ts
git commit -m "$(cat <<'EOF'
feat: add gate id helpers and a gate stage name variant

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 2: Web mirror of gate identity helpers + `StageName`/`isGateStage`

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/types.test.ts`

**Interfaces:**
- Consumes: nothing (pure mirror of Task 1, independent codebase per `OVERVIEW.md`'s existing web/src/types.ts duplication convention).
- Produces: `GATE_ID_PREFIX`, `isGateEntry`, `parseGateId`, `isGateStage(stage): stage is \`gate:${string}\``, and `StageName` gaining `` `gate:${string}` `` — consumed by Tasks 6, 8, 9.

- [ ] **Step 1: Write the failing tests**

Create `web/src/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GATE_ID_PREFIX, isGateEntry, isGateStage, parseGateId } from "./types";

describe("isGateEntry", () => {
  it("is true for a gate-prefixed id", () => {
    expect(isGateEntry("gate:abc-123")).toBe(true);
  });

  it("is false for a plain agent id", () => {
    expect(isGateEntry("abc-123")).toBe(false);
  });
});

describe("parseGateId", () => {
  it("strips the gate: prefix", () => {
    expect(parseGateId(`${GATE_ID_PREFIX}abc-123`)).toBe("abc-123");
  });
});

describe("isGateStage", () => {
  it("is true for a gate stage name", () => {
    expect(isGateStage("gate:abc-123")).toBe(true);
  });

  it("is false for a backbone or custom stage name", () => {
    expect(isGateStage("analyst")).toBe(false);
    expect(isGateStage("custom:abc-123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/types.test.ts`
Expected: FAIL — `GATE_ID_PREFIX`/`isGateEntry`/`parseGateId`/`isGateStage` are not exported.

- [ ] **Step 3: Implement**

In `web/src/types.ts`, change the `StageName` union (mirrors Task 1's backend change):

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
  | "tracing_pack"
  | `custom:${string}`
  | `gate:${string}`;
```

Add, directly after `export type BackboneStage = (typeof BACKBONE_STAGES)[number];`:

```ts
export const GATE_ID_PREFIX = "gate:";

export function isGateEntry(id: string): boolean {
  return id.startsWith(GATE_ID_PREFIX);
}

export function parseGateId(id: string): string {
  return id.slice(GATE_ID_PREFIX.length);
}
```

Add, directly after the existing `isCustomStage` function:

```ts
export function isCustomStage(stage: StageName): stage is `custom:${string}` {
  return stage.startsWith("custom:");
}

export function isGateStage(stage: StageName): stage is `gate:${string}` {
  return stage.startsWith(GATE_ID_PREFIX);
}
```

(The `isCustomStage` line above is shown only for placement context — it already exists; only the new `isGateStage` function is added below it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/types.test.ts
git commit -m "$(cat <<'EOF'
feat: mirror gate id helpers and isGateStage on the web side

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 3: Orchestrator — pause/approve/reject core

**Files:**
- Modify: `src/orchestrator/types.ts`
- Modify: `src/orchestrator/runOrchestrator.ts`
- Test: `src/orchestrator/runOrchestrator.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (uses `StageName`'s `gate:${string}` variant from Task 1, but doesn't call `isGateEntry`/`parseGateId` — it receives already-resolved `SlotEntry` values).
- Produces: `SlotEntry` type (`{kind:"agent", agent} | {kind:"gate", id}`), `ResolvedWorkflow.slots: Partial<Record<BackboneStage, SlotEntry[]>>`, `RunOutcome` gaining `{status:"gate_rejected", stage}`, `buildStageSteps` now interleaving agent and gate steps — consumed by Task 4 (`RunController`).

- [ ] **Step 1: Rewrite existing fixtures and add failing tests**

In `src/orchestrator/runOrchestrator.test.ts`, the four existing tests that construct a `resolvedWorkflow.slots` entry with a raw `AgentDefinition` object literal must be updated to wrap each agent in `{kind: "agent", agent: {...}}`, since `ResolvedWorkflow.slots` is about to become `SlotEntry[]` instead of `AgentDefinition[]`.

Change (in the test `"inserts a custom agent step after analyst, running it with the idea and prior output as context"`):

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              id: "sec-1",
              name: "Security Reviewer",
              instructions: "Look for auth bypass issues.",
              repoAccess: true,
              createdAt: "2026-09-10T00:00:00.000Z",
            },
          ],
        },
      },
    };
```

to:

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              kind: "agent",
              agent: {
                id: "sec-1",
                name: "Security Reviewer",
                instructions: "Look for auth bypass issues.",
                repoAccess: true,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
```

Change (in the test `"inserts a custom agent step after create_repo, before analyst even starts"`):

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          create_repo: [
            {
              id: "repo-checker",
              name: "Repo Checker",
              instructions: "Sanity-check the new repo.",
              repoAccess: false,
              createdAt: "2026-09-10T00:00:00.000Z",
            },
          ],
        },
      },
    };
```

to:

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          create_repo: [
            {
              kind: "agent",
              agent: {
                id: "repo-checker",
                name: "Repo Checker",
                instructions: "Sanity-check the new repo.",
                repoAccess: false,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
```

Change (in the test `"clones the repo before running a repoAccess custom agent placed before the developer stage..."`):

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              id: "repo-agent",
              name: "Repo Reader",
              instructions: "Read the repo.",
              repoAccess: true,
              createdAt: "2026-09-10T00:00:00.000Z",
            },
          ],
        },
      },
    };
```

to:

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              kind: "agent",
              agent: {
                id: "repo-agent",
                name: "Repo Reader",
                instructions: "Read the repo.",
                repoAccess: true,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
```

Change (in the test `"does not clone the repo for a custom agent without repoAccess placed before the developer stage"`):

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              id: "text-agent",
              name: "Brainstormer",
              instructions: "Suggest ideas.",
              repoAccess: false,
              createdAt: "2026-09-10T00:00:00.000Z",
            },
          ],
        },
      },
    };
```

to:

```ts
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            {
              kind: "agent",
              agent: {
                id: "text-agent",
                name: "Brainstormer",
                instructions: "Suggest ideas.",
                repoAccess: false,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
```

Then add four new tests, inserted immediately after that last test (`"does not clone the repo for a custom agent without repoAccess..."`) and before the closing `});` of the top-level `describe("runOrchestrator", ...)` block (i.e. immediately before the `describe("BACKBONE_STEPS / BACKBONE_STAGES invariant", ...)` block):

```ts
  it("pauses at a gate and waits for a decision, without committing a tracing pack", async () => {
    const deps = makeDeps();
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [{ kind: "gate", id: "g1" }],
        },
      },
    };

    const outcome = await runOrchestrator(workflowParams, deps);

    expect(outcome.status).toBe("stopped");
    if (outcome.status === "stopped") {
      expect(outcome.stage).toBe("gate:g1");
      expect(outcome.resumeState.ctx.gateDecisions).toBeUndefined();
    }
    expect(events).toContain("gate:g1:running");
    expect(events).toContain("gate:g1:stopped");
    expect(deps.github.commitFile).not.toHaveBeenCalled();
  });

  it("continues past a gate once its decision is recorded as approved on resume", async () => {
    const deps = makeDeps();
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [{ kind: "gate", id: "g1" }],
        },
      },
    };
    const stopped = await runOrchestrator(workflowParams, deps);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");
    stopped.resumeState.ctx.gateDecisions = { g1: "approved" };

    const outcome = await runOrchestrator(workflowParams, deps, stopped.resumeState);

    expect(outcome.status).toBe("deployed");
  });

  it("ends the run blocked when a gate's decision is recorded as rejected on resume, and commits the tracing pack", async () => {
    const deps = makeDeps();
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [{ kind: "gate", id: "g1" }],
        },
      },
    };
    const stopped = await runOrchestrator(workflowParams, deps);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");
    stopped.resumeState.ctx.gateDecisions = { g1: "rejected" };

    const outcome = await runOrchestrator(workflowParams, deps, stopped.resumeState);

    expect(outcome).toEqual({ status: "gate_rejected", stage: "gate:g1" });
    expect(deps.github.commitFile).toHaveBeenCalledTimes(1);
    const [, , , content] = vi.mocked(deps.github.commitFile).mock.calls[0];
    expect(content).toContain("Outcome: **blocked**");
    expect(deps.agents.architect).not.toHaveBeenCalled();
  });

  it("runs a gate and a custom agent placed in the same slot in array order", async () => {
    const deps = makeDeps();
    vi.mocked(deps.agents.custom).mockResolvedValue({
      output: { text: "Looks fine." },
      usage: fakeUsage,
    });
    const workflowParams: OrchestratorParams = {
      ...params,
      resolvedWorkflow: {
        slots: {
          analyst: [
            { kind: "gate", id: "g1" },
            {
              kind: "agent",
              agent: {
                id: "sec-1",
                name: "Security Reviewer",
                instructions: "Look for auth bypass issues.",
                repoAccess: false,
                createdAt: "2026-09-10T00:00:00.000Z",
              },
            },
          ],
        },
      },
    };
    const stopped = await runOrchestrator(workflowParams, deps);
    if (stopped.status !== "stopped") throw new Error("expected a stopped outcome");
    stopped.resumeState.ctx.gateDecisions = { g1: "approved" };
    const events: string[] = [];
    deps.eventBus.onEvent((event) => events.push(`${event.stage}:${event.status}`));

    const outcome = await runOrchestrator(workflowParams, deps, stopped.resumeState);

    expect(outcome.status).toBe("deployed");
    expect(events.slice(0, 4)).toEqual([
      "gate:g1:running",
      "gate:g1:done",
      "custom:sec-1:running",
      "custom:sec-1:done",
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts`
Expected: FAIL — compile error (object literal isn't assignable to `AgentDefinition`, `kind`/`gate` are unknown) or runtime failure once it does compile.

- [ ] **Step 3: Implement**

In `src/orchestrator/types.ts`, replace:

```ts
export interface ResolvedWorkflow {
  slots: Partial<Record<BackboneStage, AgentDefinition[]>>;
}
```

with:

```ts
export type SlotEntry = { kind: "agent"; agent: AgentDefinition } | { kind: "gate"; id: string };

export interface ResolvedWorkflow {
  slots: Partial<Record<BackboneStage, SlotEntry[]>>;
}
```

In `src/orchestrator/runOrchestrator.ts`, make four changes:

**3a.** Add `gateDecisions` to `PipelineContext` (currently ending in `deployUrl?: string;`):

```ts
export interface PipelineContext {
  tracingEntries: TracingPackEntry[];
  pendingInput?: unknown;
  repo?: { owner: string; repo: string; htmlUrl: string; cloneUrl: string };
  repoCloned?: boolean;
  analystOutput?: AnalystOutput;
  architectOutput?: ArchitectOutput;
  issue?: { number: number };
  developerOutput?: DeveloperOutput;
  pr?: { number: number; htmlUrl: string };
  diff?: string;
  qaOutput?: QAOutput;
  deployUrl?: string;
  gateDecisions?: Record<string, "approved" | "rejected">;
}
```

**3b.** Add the `gate_rejected` variant to `RunOutcome`:

```ts
export type RunOutcome =
  | { status: "deployed"; url: string; prUrl: string }
  | { status: "blocked"; findings: QAFinding[]; prUrl: string }
  | { status: "gate_rejected"; stage: StageName }
  | { status: "failed"; stage: StageName; error: string }
  | { status: "stopped"; stage: StageName; resumeState: ResumeState };
```

**3c.** Add the two gate error classes directly before `interface StageStep {`:

```ts
class GateWaitingError extends Error {}
class GateRejectedError extends Error {}

interface StageStep {
```

**3d.** Replace `buildCustomStep`'s trailing `buildStageSteps` function — the whole block from `function buildCustomStep` through the end of the original `buildStageSteps` — with `buildCustomStep` unchanged, a new `buildGateStep`, and a rewritten `buildStageSteps`:

```ts
function buildCustomStep(agent: AgentDefinition): StageStep {
  const stageName = `custom:${agent.id}` as StageName;
  return {
    name: stageName,
    abortable: true,
    async run(ctx, params, deps, signal) {
      const contextText = renderContextSoFar(params.ideaText, ctx.tracingEntries);
      ctx.pendingInput = { agentName: agent.name, instructions: agent.instructions, repoAccess: agent.repoAccess };
      deps.eventBus.emit(stageEvent(stageName, "running", `Running ${agent.name}`, { input: ctx.pendingInput }));
      if (agent.repoAccess && !ctx.repoCloned) {
        await deps.git.cloneRepo(ctx.repo!.cloneUrl, params.workDir, params.githubToken);
        ctx.repoCloned = true;
      }
      const { output, usage } = await deps.agents.custom(agent, contextText, params.workDir, signal);
      deps.eventBus.emit(stageEvent(stageName, "done", output.text.slice(0, 200), { output, usage }));
      ctx.tracingEntries.push({ stage: stageName, status: "done", input: ctx.pendingInput, output, usage });
    },
  };
}

function buildGateStep(id: string): StageStep {
  const stageName = `gate:${id}` as StageName;
  return {
    name: stageName,
    abortable: false,
    async run(ctx, _params, deps) {
      deps.eventBus.emit(stageEvent(stageName, "running", "Awaiting review"));
      const decision = ctx.gateDecisions?.[id];
      if (decision === "approved") {
        deps.eventBus.emit(stageEvent(stageName, "done", "Approved"));
        ctx.tracingEntries.push({ stage: stageName, status: "done", output: { decision } });
        return;
      }
      if (decision === "rejected") {
        throw new GateRejectedError();
      }
      throw new GateWaitingError();
    },
  };
}

export function buildStageSteps(resolvedWorkflow: ResolvedWorkflow): StageStep[] {
  const steps: StageStep[] = [];
  for (const step of BACKBONE_STEPS) {
    steps.push(step);
    const afterThisStage = resolvedWorkflow.slots[step.name as BackboneStage] ?? [];
    for (const entry of afterThisStage) {
      steps.push(entry.kind === "gate" ? buildGateStep(entry.id) : buildCustomStep(entry.agent));
    }
  }
  return steps;
}
```

**3e.** In the main loop inside `runOrchestrator`, replace the `catch` block:

```ts
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
    } finally {
```

with:

```ts
    } catch (error) {
      if (error instanceof AgentStoppedError || error instanceof GateWaitingError) {
        const message = error instanceof GateWaitingError ? "Waiting for approval" : "Stopped by user";
        deps.eventBus.emit(stageEvent(currentStage, "stopped", message));
        return { status: "stopped", stage: currentStage, resumeState: { stageIndex: i, ctx } };
      }
      if (error instanceof GateRejectedError) {
        deps.eventBus.emit(stageEvent(currentStage, "blocked", "Rejected by reviewer"));
        ctx.tracingEntries.push({ stage: currentStage, status: "blocked" });
        await commitTracingPack("blocked");
        return { status: "gate_rejected", stage: currentStage };
      }
      const err = error as Error;
      deps.eventBus.emit(stageEvent(currentStage, "failed", err.message));
      ctx.tracingEntries.push({ stage: currentStage, status: "failed", input: ctx.pendingInput, output: err.message });
      await commitTracingPack("failed");
      return { status: "failed", stage: currentStage, error: err.message };
    } finally {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/orchestrator/runOrchestrator.test.ts`
Expected: PASS (all tests, including the four rewritten fixtures)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/runOrchestrator.ts src/orchestrator/runOrchestrator.test.ts
git commit -m "$(cat <<'EOF'
feat: pause the pipeline at a gate until a human approves or rejects it

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 4: `RunController` — resolve gate entries, `decideGate`

**Files:**
- Modify: `src/orchestrator/runController.ts`
- Test: `src/orchestrator/runController.test.ts`

**Interfaces:**
- Consumes: `isGateEntry`, `parseGateId`, `SlotEntry` (Tasks 1 & 3).
- Produces: `RunController.decideGate(gateId: string, decision: "approved" | "rejected"): void` — consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `src/orchestrator/runController.test.ts`, inside the `describe("RunController", ...)` block, immediately before its closing `});`:

```ts
  it("pauses at a gate placed via workflow slots, then approves and continues to completion", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "with-gate",
        name: "With a gate",
        slots: { analyst: ["gate:g1"] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-gate");
    await waitForStage(controller.eventBus, "gate:g1", "stopped");
    const stoppedOutcome = await controller.getRunPromise();

    expect(stoppedOutcome?.status).toBe("stopped");
    expect(controller.getStatus()).toBe("stopped");

    controller.decideGate("g1", "approved");
    const finalOutcome = await controller.getRunPromise();

    expect(finalOutcome?.status).toBe("deployed");
  });

  it("ends the run blocked when a gate is rejected", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "with-gate",
        name: "With a gate",
        slots: { analyst: ["gate:g1"] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-gate");
    await waitForStage(controller.eventBus, "gate:g1", "stopped");
    controller.decideGate("g1", "rejected");
    const finalOutcome = await controller.getRunPromise();

    expect(finalOutcome).toEqual({ status: "gate_rejected", stage: "gate:g1" });
    expect(controller.getStatus()).toBe("done");
  });

  it("throws when decideGate is called with no stopped run", () => {
    const controller = new RunController(makeConfig());
    expect(() => controller.decideGate("g1", "approved")).toThrow("No stopped run to decide");
  });

  it("throws when decideGate is called for a gate that isn't the run's current stopped stage", async () => {
    const config = makeConfig();
    config.workflowStore = makeWorkflowStore([
      DEFAULT_WORKFLOW,
      {
        id: "with-gate",
        name: "With a gate",
        slots: { analyst: ["gate:g1"] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const controller = new RunController(config);

    controller.start("Build a todo app", "with-gate");
    await waitForStage(controller.eventBus, "gate:g1", "stopped");

    expect(() => controller.decideGate("other-gate", "approved")).toThrow(
      "Gate other-gate is not the run's current stopped stage",
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/orchestrator/runController.test.ts`
Expected: FAIL — `controller.decideGate` is not a function; also `slots: { analyst: ["gate:g1"] }` currently resolves through `resolveAgents`, which would throw `Unknown agent: gate:g1`.

- [ ] **Step 3: Implement**

In `src/orchestrator/runController.ts`:

Remove the now-unused import:

```ts
import type { AgentDefinition } from "../agents/types.js";
```

Change the import from `./types.js` (currently `BACKBONE_STAGES, DEFAULT_WORKFLOW_ID` — note `DEFAULT_WORKFLOW_ID` actually comes from `./workflowStore.js`; the `./types.js` import line is `import { BACKBONE_STAGES, type BackboneStage, type ResolvedWorkflow, type StageName } from "./types.js";`) to:

```ts
import {
  BACKBONE_STAGES,
  isGateEntry,
  parseGateId,
  type BackboneStage,
  type ResolvedWorkflow,
  type SlotEntry,
  type StageName,
} from "./types.js";
```

Replace the `resolveAgents`/`resolvedWorkflow` block inside `start()`:

```ts
    const resolveAgents = (ids: string[]): AgentDefinition[] =>
      ids.map((id) => {
        const agent = this.config.agentStore.get(id);
        if (!agent) throw new Error(`Unknown agent: ${id}`);
        return agent;
      });
    const resolvedWorkflow: ResolvedWorkflow = {
      slots: Object.fromEntries(
        BACKBONE_STAGES.map((stage) => [stage, resolveAgents(workflow.slots[stage] ?? [])]),
      ) as Partial<Record<BackboneStage, AgentDefinition[]>>,
    };
```

with:

```ts
    const resolveEntries = (ids: string[]): SlotEntry[] =>
      ids.map((id) => {
        if (isGateEntry(id)) return { kind: "gate", id: parseGateId(id) };
        const agent = this.config.agentStore.get(id);
        if (!agent) throw new Error(`Unknown agent: ${id}`);
        return { kind: "agent", agent };
      });
    const resolvedWorkflow: ResolvedWorkflow = {
      slots: Object.fromEntries(
        BACKBONE_STAGES.map((stage) => [stage, resolveEntries(workflow.slots[stage] ?? [])]),
      ) as Partial<Record<BackboneStage, SlotEntry[]>>,
    };
```

Add a new method directly after `resume()`:

```ts
  decideGate(gateId: string, decision: "approved" | "rejected"): void {
    if (this.status !== "stopped" || !this.snapshot) {
      throw new Error("No stopped run to decide");
    }
    const stageIndex = this.snapshot.resumeState.stageIndex;
    if (this.plan?.[stageIndex] !== `gate:${gateId}`) {
      throw new Error(`Gate ${gateId} is not the run's current stopped stage`);
    }
    const ctx = this.snapshot.resumeState.ctx;
    ctx.gateDecisions = { ...ctx.gateDecisions, [gateId]: decision };
    this.status = "running";
    this.runFrom(this.snapshot.params, this.snapshot.resumeState);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/orchestrator/runController.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runController.ts src/orchestrator/runController.test.ts
git commit -m "$(cat <<'EOF'
feat: resolve gate entries in workflows and let RunController decide them

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 5: Dashboard API — gate approve/reject routes, workflow validation

**Files:**
- Modify: `src/dashboard/server.ts`
- Test: `src/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `RunController.decideGate` (Task 4), `isGateEntry` (Task 1).
- Produces: `POST /api/run/gates/:id/approve`, `POST /api/run/gates/:id/reject`.

- [ ] **Step 1: Update existing fixtures and write failing tests**

`createRunHandlers`'s parameter type is about to require a `decideGate` method, so every test-local fake controller object needs one. In `src/dashboard/server.test.ts`, five occurrences of the exact literal:

```ts
{ start: vi.fn(), stop: vi.fn(), resume: vi.fn() }
```

(at the "starts a run...", "returns 400 when ideaText is missing", "stops the current run...", "resumes a stopped run...", and "starts a run with the given workflowId..." tests) must become:

```ts
{ start: vi.fn(), stop: vi.fn(), resume: vi.fn(), decideGate: vi.fn() }
```

Additionally, two multi-line fakes need `decideGate: vi.fn(),` added. Change (in `"returns 409 when starting while a run is already active"`):

```ts
    const controller = {
      start: vi.fn(() => {
        throw new Error("A run is already active");
      }),
      stop: vi.fn(),
      resume: vi.fn(),
    };
```

to:

```ts
    const controller = {
      start: vi.fn(() => {
        throw new Error("A run is already active");
      }),
      stop: vi.fn(),
      resume: vi.fn(),
      decideGate: vi.fn(),
    };
```

Change (in `"returns 409 when stop() finds nothing abortable running"`):

```ts
    const controller = {
      start: vi.fn(),
      stop: vi.fn(() => {
        throw new Error("No abortable stage is currently running");
      }),
      resume: vi.fn(),
    };
```

to:

```ts
    const controller = {
      start: vi.fn(),
      stop: vi.fn(() => {
        throw new Error("No abortable stage is currently running");
      }),
      resume: vi.fn(),
      decideGate: vi.fn(),
    };
```

Then add two new `describe` blocks. Insert the first immediately after the closing `});` of `describe("createRunHandlers", ...)` and before `function makeAgentStore(...)`:

```ts
describe("createRunHandlers gate routes", () => {
  it("approves a gate and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn(), decideGate: vi.fn() };
    const { approveGate } = createRunHandlers(controller);
    const res = makeFakeRes();

    approveGate({ params: { id: "g1" } } as never, res as never, (() => {}) as never);

    expect(controller.decideGate).toHaveBeenCalledWith("g1", "approved");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("rejects a gate and returns 204", () => {
    const controller = { start: vi.fn(), stop: vi.fn(), resume: vi.fn(), decideGate: vi.fn() };
    const { rejectGate } = createRunHandlers(controller);
    const res = makeFakeRes();

    rejectGate({ params: { id: "g1" } } as never, res as never, (() => {}) as never);

    expect(controller.decideGate).toHaveBeenCalledWith("g1", "rejected");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("returns 409 when decideGate throws", () => {
    const controller = {
      start: vi.fn(),
      stop: vi.fn(),
      resume: vi.fn(),
      decideGate: vi.fn(() => {
        throw new Error("No stopped run to decide");
      }),
    };
    const { approveGate } = createRunHandlers(controller);
    const res = makeFakeRes();

    approveGate({ params: { id: "g1" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});
```

Add the second immediately before the closing `});` of `describe("createWorkflowHandlers", ...)`:

```ts
  it("creates a workflow whose slots contain a gate entry, without requiring it to resolve to an agent", () => {
    const workflowStore = makeWorkflowStore();
    const { create } = createWorkflowHandlers(workflowStore, makeAgentStore());
    const res = makeFakeRes();

    create(
      { body: { name: "With a gate", slots: { analyst: ["gate:g1"] } } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(workflowStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "With a gate", slots: { analyst: ["gate:g1"] } }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: FAIL — `createRunHandlers` doesn't return `approveGate`/`rejectGate`; the gate-entry workflow-create test gets 400 because `validateWorkflowInput` currently requires every slot id to resolve to a known agent.

- [ ] **Step 3: Implement**

In `src/dashboard/server.ts`, add `isGateEntry` to the existing import from `../orchestrator/types.js`:

```ts
import { BACKBONE_STAGES, isGateEntry, WorkflowInputSchema, type BackboneStage, type WorkflowDefinition } from "../orchestrator/types.js";
```

Replace the `createRunHandlers` function signature and body:

```ts
export function createRunHandlers(controller: Pick<RunController, "start" | "stop" | "resume">): {
  start: express.RequestHandler;
  stop: express.RequestHandler;
  resume: express.RequestHandler;
} {
```

with:

```ts
export function createRunHandlers(controller: Pick<RunController, "start" | "stop" | "resume" | "decideGate">): {
  start: express.RequestHandler;
  stop: express.RequestHandler;
  resume: express.RequestHandler;
  approveGate: express.RequestHandler;
  rejectGate: express.RequestHandler;
} {
```

and replace the function's `return { start, stop, resume };` with:

```ts
  const decide = (decision: "approved" | "rejected"): express.RequestHandler => (req, res) => {
    try {
      controller.decideGate(req.params.id, decision);
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };
  const approveGate = decide("approved");
  const rejectGate = decide("rejected");

  return { start, stop, resume, approveGate, rejectGate };
```

In `validateWorkflowInput`, change:

```ts
    const allIds = Object.values(slots).flat();
    const unknownId = allIds.find((id) => !agentStore.get(id));
```

to:

```ts
    const allIds = Object.values(slots).flat();
    const unknownId = allIds.find((id) => !isGateEntry(id) && !agentStore.get(id));
```

In `createDashboardServer`, change:

```ts
  const { start, stop, resume } = createRunHandlers(controller);
  app.post("/api/run", start);
  app.post("/api/run/stop", stop);
  app.post("/api/run/resume", resume);
```

to:

```ts
  const { start, stop, resume, approveGate, rejectGate } = createRunHandlers(controller);
  app.post("/api/run", start);
  app.post("/api/run/stop", stop);
  app.post("/api/run/resume", resume);
  app.post("/api/run/gates/:id/approve", approveGate);
  app.post("/api/run/gates/:id/reject", rejectGate);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "$(cat <<'EOF'
feat: add gate approve/reject routes and accept gate entries in workflows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 6: Canvas graph — gate node type, insert/remove generalized

**Files:**
- Modify: `web/src/lib/pipelineCanvas.ts`
- Modify: `web/src/lib/pipelineCanvas.test.ts`

**Interfaces:**
- Consumes: `isGateEntry`, `parseGateId` (Task 2).
- Produces: `GateNodeData` type, `buildPipelineGraph` emitting `"gate"`-typed nodes, `insertEntry`/`removeEntry` (renamed from `insertAgent`/`removeAgent`) — consumed by Task 7.

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `web/src/lib/pipelineCanvas.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  buildPipelineGraph,
  insertEntry,
  removeEntry,
  type CustomAgentNodeData,
  type SlotsState,
} from "./pipelineCanvas";
import type { AgentDefinition } from "@/types";

const agentA: AgentDefinition = { id: "a", name: "Agent A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentB: AgentDefinition = { id: "b", name: "Agent B", instructions: "do b", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" };
const agentsById = { a: agentA, b: agentB };

describe("buildPipelineGraph", () => {
  it("produces 11 backbone nodes, 10 insertion points, and 1 end node for empty slots", () => {
    const { nodes, edges } = buildPipelineGraph({}, agentsById);

    expect(nodes.filter((n) => n.type === "backbone")).toHaveLength(11);
    expect(nodes.filter((n) => n.type === "insertion")).toHaveLength(10);
    expect(nodes.filter((n) => n.type === "custom")).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "end")).toHaveLength(1);
    expect(edges).toHaveLength(nodes.length - 1);
    expect(nodes[0].id).toBe("backbone:create_repo");
    expect(nodes[nodes.length - 1].id).toBe("end");
  });

  it("renders tracing_pack as a backbone box with no insertion point after it — nothing can run past the final step", () => {
    const { nodes } = buildPipelineGraph({}, agentsById);

    const ids = nodes.map((n) => n.id);
    const tracingPackIndex = ids.indexOf("backbone:tracing_pack");
    expect(tracingPackIndex).toBeGreaterThan(-1);
    expect(ids[tracingPackIndex + 1]).toBe("end");
  });

  it("brackets each stage's custom agents with insertion points, in array order", () => {
    const slots: SlotsState = { analyst: ["a", "b"] };

    const { nodes } = buildPipelineGraph(slots, agentsById);

    const ids = nodes.map((n) => n.id);
    const analystIndex = ids.indexOf("backbone:analyst");
    expect(ids.slice(analystIndex, analystIndex + 5)).toEqual([
      "backbone:analyst",
      "insertion:analyst:0",
      "custom:analyst:0:a",
      "insertion:analyst:1",
      "custom:analyst:1:b",
    ]);
    expect(ids[analystIndex + 5]).toBe("insertion:analyst:2");
    expect(ids[analystIndex + 6]).toBe("backbone:architect");
  });

  it("resolves a custom node's display name from agentsById, falling back to the raw id", () => {
    const { nodes } = buildPipelineGraph({ qa: ["a", "unknown-id"] }, agentsById);

    const customNodes = nodes.filter((n) => n.type === "custom");
    expect(customNodes.map((n) => n.data.name)).toEqual(["Agent A", "unknown-id"]);
  });
});

describe("buildPipelineGraph gate nodes", () => {
  it("renders a gate entry as a gate node instead of a custom node", () => {
    const slots: SlotsState = { analyst: ["gate:g1"] };
    const { nodes } = buildPipelineGraph(slots, agentsById);
    const gateNode = nodes.find((n) => n.id === "gate:analyst:0:g1");
    expect(gateNode?.type).toBe("gate");
    expect(gateNode?.data).toMatchObject({ afterStage: "analyst", index: 0, gateId: "g1" });
    expect(nodes.filter((n) => n.type === "custom")).toHaveLength(0);
  });

  it("never flags a gate entry as missing inputs, and doesn't block a later agent from seeing an earlier agent's output", () => {
    const producer: AgentDefinition = { ...agentA, outputs: ["pull_request"] };
    const slots: SlotsState = { create_repo: ["a", "gate:g1", "c"] };
    const { nodes } = buildPipelineGraph(slots, { a: producer, c: agentNeedsPr });
    const node = nodes.find((n) => n.id === "custom:create_repo:2:c")!;
    expect((node.data as CustomAgentNodeData).missingInputs).toEqual([]);
  });
});

describe("insertEntry", () => {
  it("appends to an empty stage", () => {
    expect(insertEntry({}, "analyst", 0, "a")).toEqual({ analyst: ["a"] });
  });

  it("inserts at a given index within an existing chain", () => {
    const slots: SlotsState = { analyst: ["a"] };
    expect(insertEntry(slots, "analyst", 0, "b")).toEqual({ analyst: ["b", "a"] });
    expect(insertEntry(slots, "analyst", 1, "b")).toEqual({ analyst: ["a", "b"] });
  });

  it("does not mutate other stages", () => {
    const slots: SlotsState = { analyst: ["a"], qa: ["b"] };
    const original = { analyst: ["a"], qa: ["b"] };
    expect(insertEntry(slots, "qa", 1, "a")).toEqual({ analyst: ["a"], qa: ["b", "a"] });
    expect(slots).toEqual(original);
  });

  it("inserts a gate marker the same way as an agent id", () => {
    expect(insertEntry({}, "analyst", 0, "gate:g1")).toEqual({ analyst: ["gate:g1"] });
  });
});

const agentNeedsPr: AgentDefinition = {
  id: "c",
  name: "PR Reviewer",
  instructions: "review the diff",
  repoAccess: false,
  inputs: ["pull_request"],
  outputs: ["qa_findings"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("buildPipelineGraph missing-input flags", () => {
  it("flags a custom agent placed before its declared input is available", () => {
    const slots: SlotsState = { create_repo: ["c"] };
    const { nodes } = buildPipelineGraph(slots, { c: agentNeedsPr });
    const node = nodes.find((n) => n.id === "custom:create_repo:0:c")!;
    expect((node.data as CustomAgentNodeData).missingInputs).toEqual(["pull_request"]);
  });

  it("does not flag a custom agent placed after its declared input is available", () => {
    const slots: SlotsState = { qa: ["c"] };
    const { nodes } = buildPipelineGraph(slots, { c: agentNeedsPr });
    const node = nodes.find((n) => n.id === "custom:qa:0:c")!;
    expect((node.data as CustomAgentNodeData).missingInputs).toEqual([]);
  });

  it("makes an earlier custom agent's declared output available to a later one in the same slot", () => {
    const producer: AgentDefinition = { ...agentA, outputs: ["pull_request"] };
    const slots: SlotsState = { create_repo: ["a", "c"] };
    const { nodes } = buildPipelineGraph(slots, { a: producer, c: agentNeedsPr });
    const node = nodes.find((n) => n.id === "custom:create_repo:1:c")!;
    expect((node.data as CustomAgentNodeData).missingInputs).toEqual([]);
  });

  it("never flags an agent with no declared inputs", () => {
    const slots: SlotsState = { create_repo: ["a"] };
    const { nodes } = buildPipelineGraph(slots, { a: agentA });
    const node = nodes.find((n) => n.id === "custom:create_repo:0:a")!;
    expect((node.data as CustomAgentNodeData).missingInputs).toEqual([]);
  });
});

describe("removeEntry", () => {
  it("removes an agent from its stage", () => {
    const slots: SlotsState = { analyst: ["a", "b"] };
    expect(removeEntry(slots, "analyst", "a")).toEqual({ analyst: ["b"] });
    expect(removeEntry({ analyst: ["a"] }, "analyst", "a")).toEqual({});
    expect(slots).toEqual({ analyst: ["a", "b"] });
  });

  it("is a no-op when the agent isn't in that stage", () => {
    const slots: SlotsState = { analyst: ["a"] };
    expect(removeEntry(slots, "analyst", "missing")).toEqual({ analyst: ["a"] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/lib/pipelineCanvas.test.ts`
Expected: FAIL — `insertEntry`/`removeEntry` don't exist yet; the gate-node tests find no `"gate"`-typed nodes.

- [ ] **Step 3: Implement**

Replace the entire contents of `web/src/lib/pipelineCanvas.ts` with:

```ts
import type { Edge, Node } from "@xyflow/react";
import {
  BACKBONE_STAGE_IO,
  BACKBONE_STAGES,
  isGateEntry,
  parseGateId,
  STAGE_LABELS,
  STAGE_ORDER,
  type AgentDefinition,
  type BackboneStage,
  type DataKind,
} from "@/types";

const SPLICEABLE_STAGES = new Set<string>(BACKBONE_STAGES);

export type SlotsState = Partial<Record<BackboneStage, string[]>>;

export const PIPELINE_NODE_X_SPACING = 180;

export interface BackboneNodeData extends Record<string, unknown> {
  stage: BackboneStage;
  label: string;
}

export interface CustomAgentNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
  agentId: string;
  name: string;
  missingInputs: DataKind[];
}

export interface GateNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
  gateId: string;
}

export interface InsertionPointNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
}

export type EndNodeData = Record<string, unknown>;

export type PipelineNodeData = BackboneNodeData | CustomAgentNodeData | GateNodeData | InsertionPointNodeData | EndNodeData;
export type PipelineFlowNode = Node<PipelineNodeData>;

export function computeMissingInputs(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): Map<string, DataKind[]> {
  const missing = new Map<string, DataKind[]>();
  const available = new Set<DataKind>(["idea_text"]);
  for (const stage of BACKBONE_STAGES) {
    BACKBONE_STAGE_IO[stage].outputs.forEach((kind) => available.add(kind));
    const entries = slots[stage] ?? [];
    entries.forEach((entry, index) => {
      if (isGateEntry(entry)) return;
      const agent = agentsById[entry];
      const needed = agent?.inputs ?? [];
      const unmet = needed.filter((kind) => !available.has(kind));
      if (unmet.length > 0) {
        missing.set(`custom:${stage}:${index}:${entry}`, unmet);
      }
      (agent?.outputs ?? []).forEach((kind) => available.add(kind));
    });
  }
  return missing;
}

export function buildPipelineGraph(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): { nodes: PipelineFlowNode[]; edges: Edge[] } {
  const nodes: PipelineFlowNode[] = [];
  const edges: Edge[] = [];
  const missingInputsByNodeId = computeMissingInputs(slots, agentsById);
  let previousId: string | undefined;
  let x = 0;

  function pushNode(id: string, type: string, data: PipelineNodeData) {
    nodes.push({ id, type, position: { x, y: 0 }, data });
    x += PIPELINE_NODE_X_SPACING;
    if (previousId) {
      edges.push({ id: `${previousId}->${id}`, source: previousId, target: id });
    }
    previousId = id;
  }

  for (const stage of STAGE_ORDER) {
    pushNode(`backbone:${stage}`, "backbone", { stage: stage as BackboneStage, label: STAGE_LABELS[stage as BackboneStage] });
    if (!SPLICEABLE_STAGES.has(stage)) continue; // e.g. tracing_pack: nothing can run after it, so no insertion point
    const backboneStage = stage as BackboneStage;
    const entries = slots[backboneStage] ?? [];
    pushNode(`insertion:${backboneStage}:0`, "insertion", { afterStage: backboneStage, index: 0 });
    entries.forEach((entry, index) => {
      if (isGateEntry(entry)) {
        const gateId = parseGateId(entry);
        pushNode(`gate:${backboneStage}:${index}:${gateId}`, "gate", { afterStage: backboneStage, index, gateId });
      } else {
        const nodeId = `custom:${backboneStage}:${index}:${entry}`;
        pushNode(nodeId, "custom", {
          afterStage: backboneStage,
          index,
          agentId: entry,
          name: agentsById[entry]?.name ?? entry,
          missingInputs: missingInputsByNodeId.get(nodeId) ?? [],
        });
      }
      pushNode(`insertion:${backboneStage}:${index + 1}`, "insertion", { afterStage: backboneStage, index: index + 1 });
    });
  }
  pushNode("end", "end", {});

  return { nodes, edges };
}

export function insertEntry(slots: SlotsState, afterStage: BackboneStage, index: number, entry: string): SlotsState {
  const current = slots[afterStage] ?? [];
  const next = [...current.slice(0, index), entry, ...current.slice(index)];
  return { ...slots, [afterStage]: next };
}

export function removeEntry(slots: SlotsState, afterStage: BackboneStage, entry: string): SlotsState {
  const current = slots[afterStage] ?? [];
  const next = current.filter((id) => id !== entry);
  const { [afterStage]: _removed, ...rest } = slots;
  return next.length > 0 ? { ...rest, [afterStage]: next } : rest;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pipelineCanvas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/pipelineCanvas.ts web/src/lib/pipelineCanvas.test.ts
git commit -m "$(cat <<'EOF'
feat: represent gates as their own node type in the pipeline graph

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 7: Canvas UI — `GateNode`, palette card, drop wiring

**Files:**
- Modify: `web/src/components/PipelineCanvas.tsx`
- Modify: `web/src/components/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: `GateNodeData`, `insertEntry`, `removeEntry` (Task 6), `GATE_ID_PREFIX` (Task 2).
- Produces: nothing consumed by later tasks (leaf UI task).

- [ ] **Step 1: Write the failing tests**

In `web/src/components/PipelineCanvas.test.tsx`, add this helper directly after the existing `dataTransferWith` function:

```ts
function gateDataTransfer() {
  return {
    getData: (type: string) => (type === "application/x-gate" ? "gate" : ""),
    setData: () => {},
  } as unknown as DataTransfer;
}
```

Then add these two tests inside the `describe("PipelineCanvas", ...)` block, immediately after the existing `"removes a placed agent back to the palette"` test:

```ts
  it("drops the Approval gate palette card onto an insertion point", async () => {
    stubFetch();

    render(<PipelineCanvas onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-create_repo-0")).toBeInTheDocument());

    fireEvent.drop(screen.getByTestId("insertion-create_repo-0"), { dataTransfer: gateDataTransfer() });

    expect(screen.getByRole("button", { name: /Remove gate/ })).toBeInTheDocument();
  });

  it("removes a placed gate", async () => {
    stubFetch();

    render(<PipelineCanvas onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("insertion-create_repo-0")).toBeInTheDocument());
    fireEvent.drop(screen.getByTestId("insertion-create_repo-0"), { dataTransfer: gateDataTransfer() });
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove gate/ })).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: /Remove gate/ }));

    expect(screen.queryByRole("button", { name: /Remove gate/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/components/PipelineCanvas.test.tsx`
Expected: FAIL — no "Approval gate" palette card exists yet, and dropping onto an insertion point does nothing for a gate payload.

- [ ] **Step 3: Implement**

In `web/src/components/PipelineCanvas.tsx`, change the imports:

```ts
import { useAgents } from "@/hooks/useAgents";
import {
  buildPipelineGraph,
  insertAgent,
  removeAgent,
  type BackboneNodeData,
  type CustomAgentNodeData,
  type InsertionPointNodeData,
  type PipelineFlowNode,
  type SlotsState,
} from "@/lib/pipelineCanvas";
import { cn } from "@/lib/utils";
import { BACKBONE_STAGES, DATA_KIND_LABELS, type AgentDefinition, type BackboneStage, type WorkflowDefinition } from "@/types";

const AGENT_DND_TYPE = "application/x-agent-id";
```

to:

```ts
import { useAgents } from "@/hooks/useAgents";
import {
  buildPipelineGraph,
  insertEntry,
  removeEntry,
  type BackboneNodeData,
  type CustomAgentNodeData,
  type GateNodeData,
  type InsertionPointNodeData,
  type PipelineFlowNode,
  type SlotsState,
} from "@/lib/pipelineCanvas";
import { cn } from "@/lib/utils";
import {
  BACKBONE_STAGES,
  DATA_KIND_LABELS,
  GATE_ID_PREFIX,
  type AgentDefinition,
  type BackboneStage,
  type WorkflowDefinition,
} from "@/types";

const AGENT_DND_TYPE = "application/x-agent-id";
const GATE_DND_TYPE = "application/x-gate";
```

Replace `InsertionPointNode`:

```tsx
function InsertionPointNode({ data }: NodeProps<PipelineFlowNode>) {
  const { afterStage, index, onDropAgent } = data as InsertionPointNodeData & { onDropAgent: (agentId: string) => void };
  const [isOver, setIsOver] = useState(false);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        data-testid={`insertion-${afterStage}-${index}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          const agentId = event.dataTransfer.getData(AGENT_DND_TYPE);
          if (agentId) onDropAgent(agentId);
        }}
        className={cn(
          "nodrag flex size-7 items-center justify-center rounded-full border-2 border-dashed text-sm text-muted-foreground",
          isOver ? "border-primary bg-primary/10 text-primary" : "border-border",
        )}
        style={{ pointerEvents: "auto" }}
      >
        +
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
```

with:

```tsx
function InsertionPointNode({ data }: NodeProps<PipelineFlowNode>) {
  const { afterStage, index, onDropAgent, onDropGate } = data as InsertionPointNodeData & {
    onDropAgent: (agentId: string) => void;
    onDropGate: () => void;
  };
  const [isOver, setIsOver] = useState(false);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        data-testid={`insertion-${afterStage}-${index}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          const agentId = event.dataTransfer.getData(AGENT_DND_TYPE);
          if (agentId) {
            onDropAgent(agentId);
            return;
          }
          const gateMarker = event.dataTransfer.getData(GATE_DND_TYPE);
          if (gateMarker) onDropGate();
        }}
        className={cn(
          "nodrag flex size-7 items-center justify-center rounded-full border-2 border-dashed text-sm text-muted-foreground",
          isOver ? "border-primary bg-primary/10 text-primary" : "border-border",
        )}
        style={{ pointerEvents: "auto" }}
      >
        +
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
```

Add a new `GateNode` component directly after `CustomAgentNode`:

```tsx
function GateNode({ data }: NodeProps<PipelineFlowNode>) {
  const { gateId, onRemove } = data as GateNodeData & { onRemove: () => void };
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        className="nodrag flex items-center gap-2 rounded-full border border-dashed border-warning bg-muted px-3 py-1.5 text-xs text-foreground"
        style={{ pointerEvents: "auto" }}
      >
        <span>Approval gate</span>
        <button type="button" onClick={onRemove} aria-label={`Remove gate ${gateId}`}>
          &times;
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
```

Add a `GatePaletteCard` component directly after `PaletteCard`:

```tsx
function GatePaletteCard() {
  return (
    <div
      draggable
      onDragStart={(event) => event.dataTransfer.setData(GATE_DND_TYPE, "gate")}
      className="cursor-grab rounded-lg border border-dashed border-border bg-card px-3 py-2 text-sm text-foreground active:cursor-grabbing"
    >
      Approval gate
    </div>
  );
}
```

Change `nodeTypes`:

```ts
const nodeTypes = { backbone: BackboneNode, custom: CustomAgentNode, insertion: InsertionPointNode, end: EndNode };
```

to:

```ts
const nodeTypes = { backbone: BackboneNode, custom: CustomAgentNode, gate: GateNode, insertion: InsertionPointNode, end: EndNode };
```

Change `NODE_DIMENSIONS`:

```ts
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  backbone: { width: 140, height: 36 },
  custom: { width: 140, height: 32 },
  insertion: { width: 28, height: 28 },
  end: { width: 70, height: 36 },
};
```

to:

```ts
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  backbone: { width: 140, height: 36 },
  custom: { width: 140, height: 32 },
  gate: { width: 140, height: 32 },
  insertion: { width: 28, height: 28 },
  end: { width: 70, height: 36 },
};
```

Inside `PipelineCanvas`, change:

```ts
  const handleInsert = useCallback((afterStage: BackboneStage, index: number, agentId: string) => {
    setSlots((prev) => insertAgent(prev, afterStage, index, agentId));
  }, []);
  const handleRemove = useCallback((afterStage: BackboneStage, agentId: string) => {
    setSlots((prev) => removeAgent(prev, afterStage, agentId));
  }, []);
```

to:

```ts
  const handleInsert = useCallback((afterStage: BackboneStage, index: number, agentId: string) => {
    setSlots((prev) => insertEntry(prev, afterStage, index, agentId));
  }, []);
  const handleInsertGate = useCallback((afterStage: BackboneStage, index: number) => {
    setSlots((prev) => insertEntry(prev, afterStage, index, `${GATE_ID_PREFIX}${crypto.randomUUID()}`));
  }, []);
  const handleRemove = useCallback((afterStage: BackboneStage, entry: string) => {
    setSlots((prev) => removeEntry(prev, afterStage, entry));
  }, []);
```

Change the `nodes` `useMemo`:

```ts
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        const dimensions = NODE_DIMENSIONS[node.type ?? ""];
        if (node.type === "insertion") {
          const data = node.data as InsertionPointNodeData;
          return {
            ...node,
            ...dimensions,
            data: { ...data, onDropAgent: (agentId: string) => handleInsert(data.afterStage, data.index, agentId) },
          };
        }
        if (node.type === "custom") {
          const data = node.data as CustomAgentNodeData;
          return {
            ...node,
            ...dimensions,
            data: { ...data, onRemove: () => handleRemove(data.afterStage, data.agentId) },
          };
        }
        return { ...node, ...dimensions };
      }),
    [graph.nodes, handleInsert, handleRemove],
  );
```

to:

```ts
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        const dimensions = NODE_DIMENSIONS[node.type ?? ""];
        if (node.type === "insertion") {
          const data = node.data as InsertionPointNodeData;
          return {
            ...node,
            ...dimensions,
            data: {
              ...data,
              onDropAgent: (agentId: string) => handleInsert(data.afterStage, data.index, agentId),
              onDropGate: () => handleInsertGate(data.afterStage, data.index),
            },
          };
        }
        if (node.type === "custom") {
          const data = node.data as CustomAgentNodeData;
          return {
            ...node,
            ...dimensions,
            data: { ...data, onRemove: () => handleRemove(data.afterStage, data.agentId) },
          };
        }
        if (node.type === "gate") {
          const data = node.data as GateNodeData;
          return {
            ...node,
            ...dimensions,
            data: { ...data, onRemove: () => handleRemove(data.afterStage, `${GATE_ID_PREFIX}${data.gateId}`) },
          };
        }
        return { ...node, ...dimensions };
      }),
    [graph.nodes, handleInsert, handleInsertGate, handleRemove],
  );
```

Change the palette JSX:

```tsx
        <div data-testid="agent-palette" className="flex w-56 shrink-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Available agents</h2>
          {agentsError && <p className="text-sm text-destructive">{agentsError}</p>}
          {paletteAgents.map((agent) => (
            <PaletteCard key={agent.id} agent={agent} />
          ))}
        </div>
```

to:

```tsx
        <div data-testid="agent-palette" className="flex w-56 shrink-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Available agents</h2>
          {agentsError && <p className="text-sm text-destructive">{agentsError}</p>}
          <GatePaletteCard />
          {paletteAgents.map((agent) => (
            <PaletteCard key={agent.id} agent={agent} />
          ))}
        </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/PipelineCanvas.test.tsx`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PipelineCanvas.tsx web/src/components/PipelineCanvas.test.tsx
git commit -m "$(cat <<'EOF'
feat: let the pipeline canvas place and remove approval gates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 8: Run view — gate label + overall "blocked" status generalization

**Files:**
- Modify: `web/src/lib/workflowGraph.ts`
- Modify: `web/src/lib/runEvents.ts`
- Modify: `web/src/lib/workflowGraph.test.ts`
- Modify: `web/src/lib/runEvents.test.ts`

**Interfaces:**
- Consumes: `isGateStage` (Task 2).
- Produces: nothing consumed by later tasks (both changes are leaf display logic Task 9 doesn't depend on).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/workflowGraph.test.ts`, inside `describe("getStageLabel", ...)`, immediately after the existing `"falls back to the raw stage id for a custom stage with an unknown agent"` test:

```ts
  it("returns 'Approval gate' for a gate stage", () => {
    expect(getStageLabel("gate:g1", agentsById)).toBe("Approval gate");
  });
```

Add to `web/src/lib/runEvents.test.ts`, inside `describe("deriveOverallStatus", ...)`, immediately after the existing `"is blocked when merge is blocked"` test:

```ts
  it("is blocked when a gate stage is blocked, not just merge", () => {
    expect(
      deriveOverallStatus({
        analyst: [event({ stage: "analyst", status: "done" })],
        "gate:g1": [event({ stage: "gate:g1", status: "blocked" })],
      }),
    ).toBe("blocked");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/lib/workflowGraph.test.ts src/lib/runEvents.test.ts`
Expected: FAIL — `getStageLabel("gate:g1", ...)` currently returns the raw id (since it's not recognized as a custom stage, it falls through to `STAGE_LABELS["gate:g1"]`, which is `undefined`); a `"blocked"` event on `gate:g1` doesn't currently flip overall status because only `merge` is checked.

- [ ] **Step 3: Implement**

In `web/src/lib/workflowGraph.ts`, change the import:

```ts
import { isCustomStage, STAGE_LABELS, type AgentDefinition, type RunEvent, type StageName } from "@/types";
```

to:

```ts
import { isCustomStage, isGateStage, STAGE_LABELS, type AgentDefinition, type RunEvent, type StageName } from "@/types";
```

Change `getStageLabel`:

```ts
export function getStageLabel(stage: StageName, agentsById: Record<string, AgentDefinition>): string {
  if (!isCustomStage(stage)) {
    return STAGE_LABELS[stage];
  }
  const agentId = stage.slice("custom:".length);
  return agentsById[agentId]?.name ?? stage;
}
```

to:

```ts
export function getStageLabel(stage: StageName, agentsById: Record<string, AgentDefinition>): string {
  if (isGateStage(stage)) {
    return "Approval gate";
  }
  if (!isCustomStage(stage)) {
    return STAGE_LABELS[stage];
  }
  const agentId = stage.slice("custom:".length);
  return agentsById[agentId]?.name ?? stage;
}
```

In `web/src/lib/runEvents.ts`, change `deriveOverallStatus`:

```ts
export function deriveOverallStatus(eventsByStage: EventsByStage): OverallStatus {
  const allEvents = Object.values(eventsByStage).filter((v) => v !== undefined).flat();
  if (allEvents.length === 0) return "idle";
  if (allEvents.some((e) => e.status === "failed" && e.stage !== "tracing_pack")) return "failed";
  if (deriveStageStatus(eventsByStage.merge) === "blocked") return "blocked";
  if (deriveStageStatus(eventsByStage.deploy) === "done") return "deployed";
  if (Object.values(eventsByStage).filter((v) => v !== undefined).some((events) => deriveStageStatus(events) === "stopped")) return "stopped";
  return "running";
}
```

to:

```ts
export function deriveOverallStatus(eventsByStage: EventsByStage): OverallStatus {
  const allEvents = Object.values(eventsByStage).filter((v) => v !== undefined).flat();
  if (allEvents.length === 0) return "idle";
  if (allEvents.some((e) => e.status === "failed" && e.stage !== "tracing_pack")) return "failed";
  if (Object.values(eventsByStage).filter((v) => v !== undefined).some((events) => deriveStageStatus(events) === "blocked")) return "blocked";
  if (deriveStageStatus(eventsByStage.deploy) === "done") return "deployed";
  if (Object.values(eventsByStage).filter((v) => v !== undefined).some((events) => deriveStageStatus(events) === "stopped")) return "stopped";
  return "running";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/workflowGraph.test.ts src/lib/runEvents.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/workflowGraph.ts web/src/lib/runEvents.ts web/src/lib/workflowGraph.test.ts web/src/lib/runEvents.test.ts
git commit -m "$(cat <<'EOF'
fix: label gate stages and treat any blocked stage as overall-blocked

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

### Task 9: `StageNode` — Approve/Reject buttons

**Files:**
- Modify: `web/src/components/StageNode.tsx`
- Modify: `web/src/components/StageNode.test.tsx`

**Interfaces:**
- Consumes: `isGateStage` (Task 2).
- Produces: nothing consumed elsewhere (leaf UI task; final task in the plan).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/components/StageNode.test.tsx`, inside `describe("StageNode", ...)`, immediately after the existing `"posts to /api/run/stop when Stop is clicked"` test:

```ts
  it("shows Approve/Reject buttons for a stopped gate stage, not Resume", () => {
    renderStageNode({
      id: "gate:g1",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "gate:g1", label: "Approval gate", status: "stopped", latestEvent: undefined },
    });

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
  });

  it("posts to the gate's approve route when Approve is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderStageNode({
      id: "gate:g1",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "gate:g1", label: "Approval gate", status: "stopped", latestEvent: undefined },
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/run/gates/g1/approve", { method: "POST" });
    vi.unstubAllGlobals();
  });

  it("posts to the gate's reject route when Reject is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderStageNode({
      id: "gate:g1",
      type: "stage",
      position: { x: 0, y: 0 },
      data: { stage: "gate:g1", label: "Approval gate", status: "stopped", latestEvent: undefined },
    });

    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/run/gates/g1/reject", { method: "POST" });
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/components/StageNode.test.tsx`
Expected: FAIL — no Approve/Reject buttons are rendered yet.

- [ ] **Step 3: Implement**

Replace the entire contents of `web/src/components/StageNode.tsx` with:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { STAGE_STATUS_CONFIG } from "@/components/status";
import { cn } from "@/lib/utils";
import { isAbortableStage, isGateStage } from "@/types";
import { STAGE_NODE_WIDTH, type StageFlowNode } from "@/lib/workflowGraph";

async function postRunAction(path: string): Promise<void> {
  await fetch(path, { method: "POST" });
}

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { stage, label, status, latestEvent } = data;
  const config = STAGE_STATUS_CONFIG[status];
  const Icon = config.icon;
  const abortable = isAbortableStage(stage);
  const isGate = isGateStage(stage);
  const gateId = isGate ? stage.slice("gate:".length) : undefined;

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
        {isGate && status === "stopped" && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                void postRunAction(`/api/run/gates/${gateId}/approve`);
              }}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                void postRunAction(`/api/run/gates/${gateId}/reject`);
              }}
            >
              Reject
            </Button>
          </div>
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/StageNode.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full test suites**

Run (from repo root): `npx vitest run`
Run (from `web/`): `npx vitest run`
Expected: PASS, both

- [ ] **Step 6: Commit**

```bash
git add web/src/components/StageNode.tsx web/src/components/StageNode.test.tsx
git commit -m "$(cat <<'EOF'
feat: show Approve/Reject buttons on a stopped gate stage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018jhvPdCLubacsRVTxMN8ci
EOF
)"
```

---

## Manual verification (after Task 9)

1. `npm run dev` (or the project's normal dev workflow) to run the dashboard.
2. In Pipelines, build (or edit) a pipeline: drag "Approval gate" onto the insertion point after `architect`.
3. Save, then start a run from Workflows with that pipeline.
4. Confirm the run pauses at the gate stage with status "Stopped" / message "Waiting for approval", showing Approve and Reject buttons instead of Resume.
5. Click Approve — confirm the run continues into `open_issue` and onward.
6. Start a second run with the same pipeline; when it pauses at the gate, click Reject — confirm the overall status shows "Blocked" and the repo's `TRACING_PACK.md` records the gate's rejected entry.
