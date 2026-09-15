import { mkdtempSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RunEventBus } from "./events.js";
import {
  buildStageSteps,
  runOrchestrator,
  type OrchestratorDeps,
  type OrchestratorParams,
  type ResumeState,
  type RunOutcome,
} from "./runOrchestrator.js";
import type { AgentStore } from "../agents/agentStore.js";
import { defaultWorkflowIdFor, type WorkflowStore } from "./workflowStore.js";
import type { ProjectStore } from "./projectStore.js";
import type { RunStore } from "./runStore.js";
import {
  BACKBONE_STAGES,
  isGateEntry,
  parseGateId,
  type BackboneStage,
  type ResolvedWorkflow,
  type SlotEntry,
  type StageName,
} from "./types.js";

export type RunControllerStatus = "idle" | "running" | "stopped" | "done";

export interface RunControllerConfig {
  projectId: string;
  owner: string;
  starterDir: string;
  githubToken: string;
  agentStore: AgentStore;
  workflowStore: WorkflowStore;
  runStore: RunStore;
  projectStore: ProjectStore;
  deps: Omit<OrchestratorDeps, "eventBus">;
}

export class RunController {
  eventBus: RunEventBus = new RunEventBus();

  private status: RunControllerStatus = "idle";
  private activeController: AbortController | undefined;
  private snapshot: { params: OrchestratorParams; resumeState: ResumeState } | undefined;
  private runPromise: Promise<RunOutcome> | undefined;
  private busReplacedEmitter = new EventEmitter();
  private plan: StageName[] | undefined;
  private currentRunId: string | undefined;
  private unsubscribeRunAppend: (() => void) | undefined;

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

  getCurrentRunId(): string | undefined {
    return this.currentRunId;
  }

  onBusReplaced(listener: () => void): () => void {
    this.busReplacedEmitter.on("replaced", listener);
    return () => this.busReplacedEmitter.off("replaced", listener);
  }

  start(ideaText: string, workflowId: string = defaultWorkflowIdFor(this.config.projectId)): void {
    if (this.status === "running" || this.status === "stopped") {
      throw new Error("A run is already active");
    }
    const workflow = this.config.workflowStore.get(workflowId);
    if (!workflow || workflow.projectId !== this.config.projectId) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
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
    if (this.status === "done") {
      this.unsubscribeRunAppend?.();
      this.eventBus = new RunEventBus();
      this.busReplacedEmitter.emit("replaced");
    }
    this.plan = [...buildStageSteps(resolvedWorkflow).map((step) => step.name), "tracing_pack"];
    const project = this.config.projectStore.get(this.config.projectId)!;
    const params: OrchestratorParams = {
      ideaText,
      owner: this.config.owner,
      repoName: project.repoName,
      starterDir: this.config.starterDir,
      workDir: mkdtempSync(join(tmpdir(), "idea-to-mvp-")),
      githubToken: this.config.githubToken,
      resolvedWorkflow,
      existingRepo: project.repo,
    };
    this.currentRunId = randomUUID();
    this.config.runStore.create({
      id: this.currentRunId,
      projectId: this.config.projectId,
      ideaText,
      workflowId,
      createdAt: new Date().toISOString(),
      events: [],
    });
    const runId = this.currentRunId;
    this.unsubscribeRunAppend = this.eventBus.onEvent((event) => {
      this.config.runStore.appendEvent(runId, event);
    });
    if (!project.repo) {
      const unsubscribeRepoCapture = this.eventBus.onEvent((event) => {
        if (event.stage === "create_repo" && event.status === "done" && event.output) {
          const output = event.output as { htmlUrl: string; cloneUrl: string };
          this.config.projectStore.update(this.config.projectId, {
            ...project,
            repo: { owner: this.config.owner, htmlUrl: output.htmlUrl, cloneUrl: output.cloneUrl },
          });
          unsubscribeRepoCapture();
        }
      });
    }
    this.runFrom(params, undefined);
  }

  stop(): void {
    if (this.status !== "running" || !this.activeController) {
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

  private runFrom(params: OrchestratorParams, resumeState: ResumeState | undefined): void {
    this.status = "running";
    this.activeController = undefined;

    const deps: OrchestratorDeps = { ...this.config.deps, eventBus: this.eventBus };
    this.runPromise = runOrchestrator(params, deps, resumeState, (controller) => {
      this.activeController = controller;
    }).then(
      (outcome) => {
        this.activeController = undefined;
        if (outcome.status === "stopped") {
          this.status = "stopped";
          this.snapshot = { params, resumeState: outcome.resumeState };
        } else {
          this.status = "done";
          this.snapshot = undefined;
        }
        return outcome;
      },
      (error: unknown) => {
        this.activeController = undefined;
        this.status = "done";
        this.snapshot = undefined;
        throw error;
      },
    );
  }
}
