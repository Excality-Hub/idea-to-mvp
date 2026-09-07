import { EventEmitter } from "node:events";
import type { RunEvent } from "./types.js";

export class RunEventBus {
  private emitter = new EventEmitter();
  private history: RunEvent[] = [];

  emit(event: RunEvent): void {
    this.history.push(event);
    this.emitter.emit("event", event);
  }

  onEvent(listener: (event: RunEvent) => void): () => void {
    for (const event of this.history) {
      listener(event);
    }
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
