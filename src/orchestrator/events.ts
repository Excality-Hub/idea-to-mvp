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
