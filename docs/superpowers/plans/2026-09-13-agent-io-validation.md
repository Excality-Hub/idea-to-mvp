# Agent Input/Output Declarations and Pipeline Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each pipeline agent (the 10 fixed backbone stages and every custom agent) declare what data it needs and produces from a fixed vocabulary, and have the pipeline canvas flag a custom agent placed where its declared inputs aren't yet available.

**Architecture:** A new fixed `DataKind` vocabulary and a hardcoded `BACKBONE_STAGE_IO` map live in `src/agents/dataKinds.ts` (backend) and are mirrored into `web/src/types.ts` (frontend), matching this repo's existing mirroring convention for `BackboneStage`. `AgentDefinition` gains optional `inputs`/`outputs: DataKind[]` fields, settable only at creation (agents have no edit flow). `web/src/lib/pipelineCanvas.ts` gains a pure function that walks a pipeline's backbone stages and slots in execution order, tracks which data kinds are available so far, and flags any custom agent whose declared inputs aren't yet available — purely an editor-time lint, never enforced at run time.

**Tech Stack:** TypeScript, Zod (backend schema validation), React + Vitest + Testing Library (frontend), `@xyflow/react` (pipeline canvas).

**Spec:** `docs/superpowers/specs/2026-09-13-agent-io-validation-design.md`

## Global Constraints

- No runtime enforcement — validation only affects what the editor displays; it never blocks a save or a run.
- No backbone-stage removal or reordering — the 10 `BACKBONE_STAGES` (`create_repo` … `deploy`) keep their fixed order and fixed, hardcoded `inputs`/`outputs`; `tracing_pack` is excluded (not a splice point, per the existing `BACKBONE_STAGES` convention).
- No agent editing — `inputs`/`outputs` are set only on the create form; there is no update-agent flow to extend.
- The `DataKind` vocabulary is fixed and closed — exactly the 10 kinds listed below; no free text, no custom/open-ended kinds.
- Only custom-agent placement is validated — backbone-to-backbone transitions are always valid by construction and are never flagged.

---

### Task 1: Data kinds vocabulary and backbone stage I/O map

**Files:**
- Create: `src/agents/dataKinds.ts`
- Test: `src/agents/dataKinds.test.ts`

**Interfaces:**
- Consumes: `BackboneStage` (type-only) and `BACKBONE_STAGES` (value, test-only) from `src/orchestrator/types.ts`.
- Produces: `DATA_KINDS: readonly string[]` (the tuple `["idea_text", "repo", "analysis_summary", "architecture_plan", "issue", "code_changes", "pull_request", "qa_findings", "merged_code", "deployment"]`), `type DataKind`, `DATA_KIND_LABELS: Record<DataKind, string>`, `BACKBONE_STAGE_IO: Record<BackboneStage, { inputs: DataKind[]; outputs: DataKind[] }>` — all consumed by Task 2 (backend) and mirrored by Task 3 (frontend).

- [ ] **Step 1: Write the failing test**

Create `src/agents/dataKinds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BACKBONE_STAGES } from "../orchestrator/types.js";
import { BACKBONE_STAGE_IO, DATA_KINDS } from "./dataKinds.js";

describe("BACKBONE_STAGE_IO", () => {
  it("has an entry for every backbone stage, in the same order as BACKBONE_STAGES", () => {
    expect(Object.keys(BACKBONE_STAGE_IO)).toEqual(BACKBONE_STAGES);
  });

  it("only references data kinds that exist in DATA_KINDS", () => {
    const known = new Set<string>(DATA_KINDS);
    for (const { inputs, outputs } of Object.values(BACKBONE_STAGE_IO)) {
      for (const kind of [...inputs, ...outputs]) {
        expect(known.has(kind)).toBe(true);
      }
    }
  });

  it("has analyst require idea_text and produce analysis_summary", () => {
    expect(BACKBONE_STAGE_IO.analyst).toEqual({ inputs: ["idea_text"], outputs: ["analysis_summary"] });
  });

  it("has deploy require merged_code, which is exactly what merge produces", () => {
    expect(BACKBONE_STAGE_IO.deploy.inputs).toEqual(["merged_code"]);
    expect(BACKBONE_STAGE_IO.merge.outputs).toEqual(["merged_code"]);
  });

  it("has create_repo require nothing and produce repo", () => {
    expect(BACKBONE_STAGE_IO.create_repo).toEqual({ inputs: [], outputs: ["repo"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/dataKinds.test.ts`
Expected: FAIL — `Cannot find module './dataKinds.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/agents/dataKinds.ts`:

```ts
import type { BackboneStage } from "../orchestrator/types.js";

export const DATA_KINDS = [
  "idea_text",
  "repo",
  "analysis_summary",
  "architecture_plan",
  "issue",
  "code_changes",
  "pull_request",
  "qa_findings",
  "merged_code",
  "deployment",
] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  idea_text: "Idea text",
  repo: "Repo",
  analysis_summary: "Analysis summary",
  architecture_plan: "Architecture plan",
  issue: "GitHub issue",
  code_changes: "Code changes",
  pull_request: "Pull request",
  qa_findings: "QA findings",
  merged_code: "Merged code",
  deployment: "Deployment",
};

// Derived from PipelineContext usage in runOrchestrator.ts's BACKBONE_STEPS
// (e.g. developer reads ctx.architectOutput! and ctx.repo!, so its inputs
// are architecture_plan + repo). Fixed and not user-editable.
export const BACKBONE_STAGE_IO: Record<BackboneStage, { inputs: DataKind[]; outputs: DataKind[] }> = {
  create_repo: { inputs: [], outputs: ["repo"] },
  analyst: { inputs: ["idea_text"], outputs: ["analysis_summary"] },
  architect: { inputs: ["analysis_summary"], outputs: ["architecture_plan"] },
  open_issue: { inputs: ["architecture_plan", "repo"], outputs: ["issue"] },
  developer: { inputs: ["architecture_plan", "repo"], outputs: ["code_changes"] },
  open_pr: { inputs: ["code_changes", "issue", "repo"], outputs: ["pull_request"] },
  qa: { inputs: ["pull_request"], outputs: ["qa_findings"] },
  post_review: { inputs: ["qa_findings", "pull_request"], outputs: [] },
  merge: { inputs: ["qa_findings", "pull_request"], outputs: ["merged_code"] },
  deploy: { inputs: ["merged_code"], outputs: ["deployment"] },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/dataKinds.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agents/dataKinds.ts src/agents/dataKinds.test.ts
git commit -m "feat: add data kinds vocabulary and backbone stage I/O map"
```

---

### Task 2: AgentDefinition gains declared inputs/outputs (backend)

**Files:**
- Modify: `src/agents/types.ts`
- Modify: `src/dashboard/server.test.ts:191-215`

**Interfaces:**
- Consumes: `DATA_KINDS`, `type DataKind` from `src/agents/dataKinds.ts` (Task 1).
- Produces: `AgentDefinition.inputs?: DataKind[]`, `AgentDefinition.outputs?: DataKind[]` (optional — pre-existing stored agents predate this field and have no migration, per the spec's non-goals); `AgentDefinitionInputSchema` accepts `inputs`/`outputs` arrays of valid `DataKind` strings, each defaulting to `[]` when omitted. Consumed by Task 3 (frontend mirror) and by `src/agents/custom.ts`/`runOrchestrator.ts` only insofar as they already accept `AgentDefinition` — no changes needed there since inputs/outputs aren't read by execution code.

- [ ] **Step 1: Write the failing test**

Modify `src/dashboard/server.test.ts`, replacing the existing test at line 191 (`"creates an agent from a valid body and returns 201"`) with an updated version, and add two new tests right after it:

```ts
  it("creates an agent from a valid body and returns 201, defaulting inputs/outputs to empty arrays", () => {
    const agentStore = makeAgentStore();
    const { create } = createAgentHandlers(agentStore, makeWorkflowStore());
    const res = makeFakeRes();

    create(
      { body: { name: "Security Reviewer", instructions: "check for bugs", repoAccess: true } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(agentStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Security Reviewer",
        instructions: "check for bugs",
        repoAccess: true,
        inputs: [],
        outputs: [],
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("creates an agent with declared inputs and outputs", () => {
    const agentStore = makeAgentStore();
    const { create } = createAgentHandlers(agentStore, makeWorkflowStore());
    const res = makeFakeRes();

    create(
      {
        body: {
          name: "PR Reviewer",
          instructions: "review the diff",
          repoAccess: false,
          inputs: ["pull_request"],
          outputs: ["qa_findings"],
        },
      } as never,
      res as never,
      (() => {}) as never,
    );

    expect(agentStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: ["pull_request"], outputs: ["qa_findings"] }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when inputs contains an unknown data kind", () => {
    const { create } = createAgentHandlers(makeAgentStore(), makeWorkflowStore());
    const res = makeFakeRes();

    create(
      { body: { name: "X", instructions: "y", repoAccess: false, inputs: ["not_a_real_kind"] } } as never,
      res as never,
      (() => {}) as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when the create body is invalid", () => {
    const { create } = createAgentHandlers(makeAgentStore(), makeWorkflowStore());
    const res = makeFakeRes();

    create({ body: { name: "" } } as never, res as never, (() => {}) as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });
```

This replaces lines 191-215 of the current file (the old `"creates an agent from a valid body and returns 201"` test through the old `"returns 400 when the create body is invalid"` test) with the four tests above.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dashboard/server.test.ts -t "creates an agent"`
Expected: FAIL — the first test fails because `inputs`/`outputs` are `undefined` in the actual call, not `[]`; the second and third fail because `AgentDefinitionInputSchema` doesn't recognize `inputs`/`outputs` yet (the schema currently ignores unknown keys and `z.enum` doesn't exist for them), so the "unknown data kind" test gets 201 instead of 400.

- [ ] **Step 3: Write minimal implementation**

Modify `src/agents/types.ts`:

```ts
import { z } from "zod";
import { DATA_KINDS, type DataKind } from "./dataKinds.js";

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  inputs?: DataKind[];
  outputs?: DataKind[];
  createdAt: string;
}

export const AgentDefinitionInputSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  repoAccess: z.boolean(),
  inputs: z.array(z.enum(DATA_KINDS)).default([]),
  outputs: z.array(z.enum(DATA_KINDS)).default([]),
});
export type AgentDefinitionInput = z.infer<typeof AgentDefinitionInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: PASS (all tests in the file, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add src/agents/types.ts src/dashboard/server.test.ts
git commit -m "feat: let agents declare input/output data kinds"
```

---

### Task 3: Frontend types mirror and pipeline validation logic

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/pipelineCanvas.ts`
- Modify: `web/src/lib/pipelineCanvas.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (frontend and backend are separate TypeScript projects); mirrors Task 1/2's shapes by hand into `web/src/types.ts`, matching the file's existing "mirrors the backend" convention.
- Produces: `DATA_KINDS`, `type DataKind`, `DATA_KIND_LABELS`, `BACKBONE_STAGE_IO` and `AgentDefinition.inputs?`/`.outputs?: DataKind[]` in `web/src/types.ts`; `computeMissingInputs(slots, agentsById): Map<string, DataKind[]>` (exported) and `CustomAgentNodeData.missingInputs: DataKind[]` in `web/src/lib/pipelineCanvas.ts`, both consumed by Task 4 (form) and Task 5 (badge rendering).

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/pipelineCanvas.test.ts` (the file already imports `buildPipelineGraph` and defines `agentA`/`agentB` — add these new agent fixtures and tests alongside the existing ones):

```ts
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
```

(`CustomAgentNodeData` is already imported/exported from `./pipelineCanvas`; add it to this test file's existing import from `"./pipelineCanvas"` if not already present. `AgentDefinition` is already imported from `"@/types"`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pipelineCanvas.test.ts` (from `web/`)
Expected: FAIL — `(node.data as CustomAgentNodeData).missingInputs` is `undefined`, not `["pull_request"]`/`[]`; also likely a TS error on `agentNeedsPr`'s `inputs`/`outputs` fields not existing yet on `AgentDefinition`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/types.ts`, add after the existing `BACKBONE_STAGES`/`BackboneStage` block (after line 68) and update `AgentDefinition`:

```ts
export const DATA_KINDS = [
  "idea_text",
  "repo",
  "analysis_summary",
  "architecture_plan",
  "issue",
  "code_changes",
  "pull_request",
  "qa_findings",
  "merged_code",
  "deployment",
] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  idea_text: "Idea text",
  repo: "Repo",
  analysis_summary: "Analysis summary",
  architecture_plan: "Architecture plan",
  issue: "GitHub issue",
  code_changes: "Code changes",
  pull_request: "Pull request",
  qa_findings: "QA findings",
  merged_code: "Merged code",
  deployment: "Deployment",
};

export const BACKBONE_STAGE_IO: Record<BackboneStage, { inputs: DataKind[]; outputs: DataKind[] }> = {
  create_repo: { inputs: [], outputs: ["repo"] },
  analyst: { inputs: ["idea_text"], outputs: ["analysis_summary"] },
  architect: { inputs: ["analysis_summary"], outputs: ["architecture_plan"] },
  open_issue: { inputs: ["architecture_plan", "repo"], outputs: ["issue"] },
  developer: { inputs: ["architecture_plan", "repo"], outputs: ["code_changes"] },
  open_pr: { inputs: ["code_changes", "issue", "repo"], outputs: ["pull_request"] },
  qa: { inputs: ["pull_request"], outputs: ["qa_findings"] },
  post_review: { inputs: ["qa_findings", "pull_request"], outputs: [] },
  merge: { inputs: ["qa_findings", "pull_request"], outputs: ["merged_code"] },
  deploy: { inputs: ["merged_code"], outputs: ["deployment"] },
};
```

And update the `AgentDefinition` interface (currently lines 96-102):

```ts
export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  inputs?: DataKind[];
  outputs?: DataKind[];
  createdAt: string;
}
```

In `web/src/lib/pipelineCanvas.ts`, add the import, extend `CustomAgentNodeData`, add `computeMissingInputs`, and wire it into `buildPipelineGraph`:

```ts
import { BACKBONE_STAGE_IO, BACKBONE_STAGES, STAGE_LABELS, STAGE_ORDER, type AgentDefinition, type BackboneStage, type DataKind } from "@/types";
```

```ts
export interface CustomAgentNodeData extends Record<string, unknown> {
  afterStage: BackboneStage;
  index: number;
  agentId: string;
  name: string;
  missingInputs: DataKind[];
}
```

```ts
function computeMissingInputs(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): Map<string, DataKind[]> {
  const missing = new Map<string, DataKind[]>();
  const available = new Set<DataKind>(["idea_text"]);
  for (const stage of BACKBONE_STAGES) {
    BACKBONE_STAGE_IO[stage].outputs.forEach((kind) => available.add(kind));
    const agentIds = slots[stage] ?? [];
    agentIds.forEach((agentId, index) => {
      const agent = agentsById[agentId];
      const needed = agent?.inputs ?? [];
      const unmet = needed.filter((kind) => !available.has(kind));
      if (unmet.length > 0) {
        missing.set(`custom:${stage}:${index}:${agentId}`, unmet);
      }
      (agent?.outputs ?? []).forEach((kind) => available.add(kind));
    });
  }
  return missing;
}
```

Inside `buildPipelineGraph`, compute the map once and pass each custom node's flags through:

```ts
export function buildPipelineGraph(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): { nodes: PipelineFlowNode[]; edges: Edge[] } {
  const nodes: PipelineFlowNode[] = [];
  const edges: Edge[] = [];
  const missingInputsByNodeId = computeMissingInputs(slots, agentsById);
  let previousId: string | undefined;
  let x = 0;
  // ... (pushNode helper unchanged)

  for (const stage of STAGE_ORDER) {
    pushNode(`backbone:${stage}`, "backbone", { stage: stage as BackboneStage, label: STAGE_LABELS[stage as BackboneStage] });
    if (!SPLICEABLE_STAGES.has(stage)) continue;
    const backboneStage = stage as BackboneStage;
    const agentIds = slots[backboneStage] ?? [];
    pushNode(`insertion:${backboneStage}:0`, "insertion", { afterStage: backboneStage, index: 0 });
    agentIds.forEach((agentId, index) => {
      const nodeId = `custom:${backboneStage}:${index}:${agentId}`;
      pushNode(nodeId, "custom", {
        afterStage: backboneStage,
        index,
        agentId,
        name: agentsById[agentId]?.name ?? agentId,
        missingInputs: missingInputsByNodeId.get(nodeId) ?? [],
      });
      pushNode(`insertion:${backboneStage}:${index + 1}`, "insertion", { afterStage: backboneStage, index: index + 1 });
    });
  }
  pushNode("end", "end", {});

  return { nodes, edges };
}
```

(Only the `custom` node's `pushNode` call and the new `missingInputsByNodeId` line change; the rest of the existing function body — the `pushNode` helper, the `backbone`/`insertion`/`end` pushes — stays as-is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pipelineCanvas.test.ts` (from `web/`)
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 5: Run the full web test suite and typecheck to catch any ripple**

Run (from `web/`): `npx vitest run && npx tsc -b --noEmit`
Expected: all tests pass, no type errors (the new `AgentDefinition` fields are optional, so existing untyped/partial fixtures in other test files are unaffected).

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/lib/pipelineCanvas.ts web/src/lib/pipelineCanvas.test.ts
git commit -m "feat: flag custom agents placed before their declared inputs are available"
```

---

### Task 4: AgentsView "Needs"/"Produces" declaration form

**Files:**
- Modify: `web/src/components/AgentsView.tsx`
- Modify: `web/src/components/AgentsView.test.tsx`

**Interfaces:**
- Consumes: `DATA_KINDS`, `DATA_KIND_LABELS`, `type DataKind` from `@/types` (Task 3).
- Produces: nothing new consumed by later tasks — this is a leaf UI change. `POST /api/agents` request bodies now include `inputs`/`outputs: DataKind[]`.

- [ ] **Step 1: Write the failing test**

Modify `web/src/components/AgentsView.test.tsx`. First, update the existing `"creates a new agent and shows it in the list"` test's expected POST body (it currently expects `JSON.stringify({ name, instructions, repoAccess })`; add `inputs: [], outputs: []` since no data-kind checkboxes are toggled in that test):

```ts
    expect(fetchMock).toHaveBeenCalledWith("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Security Reviewer",
        instructions: "Look for auth bypass issues.",
        repoAccess: true,
        inputs: [],
        outputs: [],
      }),
    });
```

Then add a new test right after it:

```ts
  it("includes selected Needs/Produces data kinds when creating an agent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial GET
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(agent) }) // POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([agent]) }); // refetch GET
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AgentsView />);
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    await user.type(screen.getByLabelText("Name"), "Security Reviewer");
    await user.type(screen.getByLabelText("Instructions"), "Look for auth bypass issues.");
    await user.click(within(screen.getByTestId("agent-inputs")).getByLabelText("Pull request"));
    await user.click(within(screen.getByTestId("agent-outputs")).getByLabelText("QA findings"));
    await user.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Security Reviewer",
        instructions: "Look for auth bypass issues.",
        repoAccess: false,
        inputs: ["pull_request"],
        outputs: ["qa_findings"],
      }),
    });
  });
```

`within` is already imported in this file's `import { render, screen, waitFor, within } from "@testing-library/react";` line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/AgentsView.test.tsx` (from `web/`)
Expected: FAIL — the modified test fails because the actual POST body has no `inputs`/`outputs` keys; the new test fails with "Unable to find a label with the text of: Pull request" since no such checkbox exists yet.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/components/AgentsView.tsx`. This file already has the instruction-analysis feature (`analyzeInstructions`, `analysis` state, the "Analyze instructions" button) from earlier work — the changes below are additive to that, not a replacement of it.

Update the import block (add `DATA_KINDS`, `DATA_KIND_LABELS`, `DataKind` to the existing `@/types` import):

```ts
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgents } from "@/hooks/useAgents";
import { analyzeInstructions, type InstructionAnalysis } from "@/lib/instructionAnalysis";
import { DATA_KINDS, DATA_KIND_LABELS, type AgentDefinition, type DataKind } from "@/types";
```

Add two new pieces of state, right after the existing `const [analysis, setAnalysis] = useState<InstructionAnalysis | undefined>(undefined);` line:

```ts
  const [inputs, setInputs] = useState<DataKind[]>([]);
  const [outputs, setOutputs] = useState<DataKind[]>([]);
```

Add a `toggle` helper right before `handleCreate`:

```ts
  function toggle(list: DataKind[], kind: DataKind): DataKind[] {
    return list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind];
  }
```

In `handleCreate`, add `inputs, outputs` to the POST body and reset them alongside the other fields on success:

```ts
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions, repoAccess, inputs, outputs }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFormError(body.error ?? "Could not create this agent");
        return;
      }
      setName("");
      setInstructions("");
      setRepoAccess(false);
      setInputs([]);
      setOutputs([]);
      setAnalysis(undefined);
      refetch();
```

(`handleDelete` and everything else in the component are unchanged.)

Add the two checkbox groups to the New Agent form, right after the repo-access checkbox and before the existing "Analyze instructions" `Button`:

```tsx
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={repoAccess}
              onChange={(event) => {
                setRepoAccess(event.target.checked);
                setAnalysis(undefined);
              }}
            />
            Give this agent repo read access
          </label>
          <div data-testid="agent-inputs" className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Needs</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {DATA_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={inputs.includes(kind)}
                    onChange={() => setInputs((prev) => toggle(prev, kind))}
                  />
                  {DATA_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>
          <div data-testid="agent-outputs" className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Produces</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {DATA_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={outputs.includes(kind)}
                    onChange={() => setOutputs((prev) => toggle(prev, kind))}
                  />
                  {DATA_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => setAnalysis(analyzeInstructions(instructions, repoAccess))}
            disabled={!instructions.trim()}
            className="w-fit"
          >
            Analyze instructions
          </Button>
```

The existing analysis-results block and `{formError && ...}` line that follow the "Analyze instructions" button in the current file are unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/AgentsView.test.tsx` (from `web/`)
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AgentsView.tsx web/src/components/AgentsView.test.tsx
git commit -m "feat: let the New Agent form declare needed/produced data kinds"
```

---

### Task 5: PipelineCanvas warning badge for unmet inputs

**Files:**
- Modify: `web/src/components/PipelineCanvas.tsx`
- Modify: `web/src/components/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: `CustomAgentNodeData.missingInputs: DataKind[]` (Task 3), `DATA_KIND_LABELS` from `@/types` (Task 3).
- Produces: nothing new consumed elsewhere — this is the final leaf UI change.

- [ ] **Step 1: Write the failing test**

Modify `web/src/components/PipelineCanvas.test.tsx`: add a third agent fixture with a declared input, right after the existing `agentA`/`agentB` declarations (leave those two unchanged), and two new tests.

```ts
const agentC = {
  id: "c",
  name: "PR Reviewer",
  instructions: "review the diff",
  repoAccess: false,
  inputs: ["pull_request"],
  outputs: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};
```

```ts
  it("shows a warning badge on a custom agent placed before its declared input is available", async () => {
    stubFetch({ agents: [agentA, agentB, agentC] });
    const initial = { id: "w1", name: "Existing", slots: { create_repo: ["c"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("PR Reviewer")).toBeInTheDocument());
    expect(screen.getByTitle(/missing: pull request/i)).toBeInTheDocument();
  });

  it("shows no warning badge once the custom agent is placed after its declared input is available", async () => {
    stubFetch({ agents: [agentA, agentB, agentC] });
    const initial = { id: "w1", name: "Existing", slots: { qa: ["c"] }, createdAt: "2026-01-01T00:00:00.000Z" };

    render(<PipelineCanvas initial={initial} onSaved={() => {}} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("PR Reviewer")).toBeInTheDocument());
    expect(screen.queryByTitle(/missing:/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PipelineCanvas.test.tsx` (from `web/`)
Expected: FAIL — the first new test fails with "Unable to find an element with the title: /missing: pull request/i" since `CustomAgentNode` doesn't render any badge yet.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/components/PipelineCanvas.tsx`. Add `DATA_KIND_LABELS` to the existing `@/types` import:

```ts
import { BACKBONE_STAGES, DATA_KIND_LABELS, type AgentDefinition, type BackboneStage, type WorkflowDefinition } from "@/types";
```

Update `CustomAgentNode`:

```tsx
function CustomAgentNode({ data }: NodeProps<PipelineFlowNode>) {
  const { name, missingInputs, onRemove } = data as CustomAgentNodeData & { onRemove: () => void };
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div
        className="nodrag flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-foreground"
        style={{ pointerEvents: "auto" }}
      >
        <span>{name}</span>
        {missingInputs.length > 0 && (
          <span title={`Missing: ${missingInputs.map((kind) => DATA_KIND_LABELS[kind]).join(", ")}`}>⚠</span>
        )}
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
          &times;
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PipelineCanvas.test.tsx` (from `web/`)
Expected: PASS (all tests)

- [ ] **Step 5: Run the full web and backend test suites, typecheck, and lint**

Run:
```bash
cd web && npx vitest run && npx tsc -b --noEmit && npx oxlint src
cd .. && npx vitest run && npx tsc --noEmit
```
Expected: everything passes, no type errors, no lint errors.

- [ ] **Step 6: Manual verification**

Boot the dashboard (`npm run dev`), open Agents, create an agent with "Needs: Pull request" checked, open Pipelines, drag that agent onto the insertion point right after Create repo, confirm the ⚠ badge appears with a tooltip naming "Pull request"; remove it and drop it after QA review instead, confirm the badge disappears.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/PipelineCanvas.tsx web/src/components/PipelineCanvas.test.tsx
git commit -m "feat: warn on the pipeline canvas when a custom agent's declared inputs aren't yet available"
```
