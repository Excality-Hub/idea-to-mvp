import type { RunController } from "./runController.js";

export class RunControllerRegistry {
  private controllers = new Map<string, RunController>();

  constructor(private factory: (projectId: string) => RunController) {}

  get(projectId: string): RunController {
    let controller = this.controllers.get(projectId);
    if (!controller) {
      controller = this.factory(projectId);
      this.controllers.set(projectId, controller);
    }
    return controller;
  }
}
