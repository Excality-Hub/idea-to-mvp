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
