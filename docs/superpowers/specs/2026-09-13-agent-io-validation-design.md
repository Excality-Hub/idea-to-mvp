# Agent input/output declarations and pipeline validation: design

Status: approved, not yet implemented.

## One-liner

Let each agent — the 10 fixed backbone stages and every custom agent —
declare what pipeline data it needs (`inputs`) and what it adds
(`outputs`), picked from a small fixed vocabulary of data kinds. The
pipeline canvas then walks a saved pipeline in execution order and flags
any custom agent whose declared inputs aren't yet available at the point
it's placed.

## Why

Custom agents can currently be dropped into any insertion point in the
pipeline canvas (`docs/superpowers/specs/2026-09-12-pipeline-canvas-editor-design.md`)
with no way to know whether that placement makes sense — e.g. an agent
meant to review a pull request, dropped in before `open_pr` exists. There's
also no shared vocabulary for what an agent needs or produces, which came
up while discussing whether backbone stages could ever be made optional:
that question turned out to hinge on exactly this kind of dependency
information. This spec builds the declaration + validation layer on its
own, scoped to today's fixed-backbone pipeline; it doesn't attempt
backbone-stage removal.

## Non-goals

- **No runtime enforcement.** Custom agents already only receive a
  rendered narrative of everything so far
  (`renderContextSoFar`/`buildCustomStep` in `runOrchestrator.ts`), not
  typed data pulled from specific prior outputs. Declared inputs/outputs
  are validated in the editor only — nothing here changes what data an
  agent actually receives at run time, or blocks a save/run when
  validation fails. It's a linting aid, not a gate.
- **No backbone-stage removal or reordering.** The 10 backbone stages
  (`create_repo` … `deploy`) keep their fixed order and fixed, hardcoded
  `inputs`/`outputs` — not user-editable. `tracing_pack` is excluded, same
  as `BACKBONE_STAGES` today (it's not a splice point).
- **No agent editing.** Agents have no update flow today (create + delete
  only); `inputs`/`outputs` are set at creation time, matching that
  existing scope. Adding agent editing generally is a separate feature.
- **No open-ended/custom data kinds.** The vocabulary is a fixed, closed
  enum tied to the concrete data that flows through the 10 backbone
  stages. Two custom agents that want to pass some other kind of data
  between each other can't declare a new kind — YAGNI until asked for.
- **No validation of backbone stages themselves.** Backbone-to-backbone
  is always valid by construction (fixed order, fixed requirements
  satisfied by the fixed stage before it); only custom-agent placement is
  checked.

## Architecture

```
src/agents/dataKinds.ts          new: DATA_KINDS vocabulary + labels,
                                   BACKBONE_STAGE_IO map
src/agents/types.ts               modified: AgentDefinition/-InputSchema
                                   gain inputs/outputs: DataKind[]
web/src/types.ts                  modified: mirrors dataKinds.ts + the
                                   AgentDefinition fields
web/src/lib/pipelineCanvas.ts      modified: buildPipelineGraph annotates
                                   each custom node with unmet inputs
web/src/components/AgentsView.tsx  modified: New Agent form gains
                                   Needs/Produces checkbox groups
web/src/components/PipelineCanvas.tsx  modified: CustomAgentNode renders
                                   a warning badge when flagged
```

### Data model (`src/agents/dataKinds.ts`, mirrored to `web/src/types.ts`)

```ts
export const DATA_KINDS = [
  "idea_text", "repo", "analysis_summary", "architecture_plan", "issue",
  "code_changes", "pull_request", "qa_findings", "merged_code", "deployment",
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
  create_repo:  { inputs: [],                              outputs: ["repo"] },
  analyst:      { inputs: ["idea_text"],                    outputs: ["analysis_summary"] },
  architect:    { inputs: ["analysis_summary"],             outputs: ["architecture_plan"] },
  open_issue:   { inputs: ["architecture_plan", "repo"],    outputs: ["issue"] },
  developer:    { inputs: ["architecture_plan", "repo"],    outputs: ["code_changes"] },
  open_pr:      { inputs: ["code_changes", "issue", "repo"],outputs: ["pull_request"] },
  qa:           { inputs: ["pull_request"],                 outputs: ["qa_findings"] },
  post_review:  { inputs: ["qa_findings", "pull_request"],  outputs: [] },
  merge:        { inputs: ["qa_findings", "pull_request"],  outputs: ["merged_code"] },
  deploy:       { inputs: ["merged_code"],                  outputs: ["deployment"] },
};
```

This mapping is derived directly from `PipelineContext` usage in
`runOrchestrator.ts`'s `BACKBONE_STEPS` (e.g. `developer` reads
`ctx.architectOutput!` and `ctx.repo!`, so its inputs are
`architecture_plan` + `repo`).

`AgentDefinition` gains two fields:

```ts
export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  repoAccess: boolean;
  inputs: DataKind[];
  outputs: DataKind[];
  createdAt: string;
}

export const AgentDefinitionInputSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  repoAccess: z.boolean(),
  inputs: z.array(z.enum(DATA_KINDS)),
  outputs: z.array(z.enum(DATA_KINDS)),
});
```

No store migration: `agentStore` is a schemaless `JsonStore`; existing
agents created before this change simply have `undefined` for these
fields until edited, which the validator (below) treats as `[]`.

### Validation (`web/src/lib/pipelineCanvas.ts`)

`buildPipelineGraph` already walks stages and slots in execution order to
lay out nodes. Add a pass over that same order that tracks a running
`available: Set<DataKind>`, seeded with `idea_text` (always available —
it's the run's input, not a stage output):

```ts
function computeMissingInputs(
  slots: SlotsState,
  agentsById: Record<string, AgentDefinition>,
): Map<string, DataKind[]> {  // keyed by the custom node id
  const missing = new Map<string, DataKind[]>();
  const available = new Set<DataKind>(["idea_text"]);
  for (const stage of BACKBONE_STAGES) {
    BACKBONE_STAGE_IO[stage].outputs.forEach((k) => available.add(k));
    for (const [index, agentId] of (slots[stage] ?? []).entries()) {
      const agent = agentsById[agentId];
      const need = agent?.inputs ?? [];
      const unmet = need.filter((k) => !available.has(k));
      if (unmet.length > 0) missing.set(`custom:${stage}:${index}:${agentId}`, unmet);
      (agent?.outputs ?? []).forEach((k) => available.add(k));
    }
  }
  return missing;
}
```

An agent's own declared outputs are still added to `available` even when
its inputs are unmet — the warning surfaces at the node that has the
problem, without cascading a second warning onto every later node that
happens to consume that output. `buildPipelineGraph` calls this once and
attaches `missingInputs: DataKind[]` (possibly empty) to each `custom`
node's data.

### UI

**`AgentsView.tsx`** — two checkbox groups in the New Agent form, "Needs"
and "Produces", one checkbox per `DATA_KINDS` entry (label from
`DATA_KIND_LABELS`), state `inputs`/`outputs: DataKind[]` included in the
`POST /api/agents` body alongside `name`/`instructions`/`repoAccess`.

**`PipelineCanvas.tsx`** — `CustomAgentNode` reads `missingInputs` off its
node data; when non-empty, renders a small warning badge (⚠) with a
`title` attribute listing the missing kinds by label (e.g. "Missing:
Architecture plan"), in addition to its existing name + remove button.

## Testing

- **`dataKinds` / `pipelineCanvas.test.ts`**: `computeMissingInputs` (or
  the equivalent exposed surface) — an agent whose declared inputs are all
  already available is not flagged; an agent placed too early (e.g.
  needing `pull_request` before `open_pr`) is flagged with exactly the
  missing kinds; a second agent in the same slot correctly sees the first
  agent's declared outputs as available; an agent with no declared inputs
  is never flagged; `idea_text` is available even before `analyst` runs.
- **`AgentsView.test.tsx`**: creating an agent with some Needs/Produces
  checkboxes selected sends `inputs`/`outputs` in the POST body; an agent
  with none selected sends empty arrays.
- **`PipelineCanvas.test.tsx`**: a custom node with unmet inputs renders
  the warning badge with the right missing-kind text; one with met (or no)
  inputs does not.
- **Backend**: `AgentDefinitionInputSchema` accepts valid `DATA_KINDS`
  values and rejects an unknown string; agent create round-trips
  `inputs`/`outputs` through the store.
- **Manual**: create an agent that needs `pull_request`, drop it right
  after `create_repo`, confirm the warning badge appears with the correct
  missing kind; drop the same agent after `open_pr` instead, confirm the
  badge disappears.
