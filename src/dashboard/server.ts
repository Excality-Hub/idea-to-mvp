import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import type { RunEventBus } from "../orchestrator/events.js";
import type { RunController } from "../orchestrator/runController.js";
import type { AgentStore } from "../agents/agentStore.js";
import { AgentDefinitionInputSchema, type AgentDefinition } from "../agents/types.js";
import { DEFAULT_WORKFLOW_ID, type WorkflowStore } from "../orchestrator/workflowStore.js";
import { BACKBONE_STAGES, WorkflowInputSchema, type BackboneStage, type WorkflowDefinition } from "../orchestrator/types.js";

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
    const inUse = workflowStore.list().some((w) => Object.values(w.slots).some((ids) => ids?.includes(id)));
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
): {
  list: express.RequestHandler;
  create: express.RequestHandler;
  update: express.RequestHandler;
  remove: express.RequestHandler;
} {
  function validateWorkflowInput(
    body: unknown,
  ): { ok: true; data: { name: string; slots: WorkflowDefinition["slots"] } } | { ok: false; error: string } {
    const parsed = WorkflowInputSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const unknownStage = Object.keys(parsed.data.slots).find(
      (stage) => !(BACKBONE_STAGES as readonly string[]).includes(stage),
    );
    if (unknownStage) {
      return { ok: false, error: `Unknown backbone stage: ${unknownStage}` };
    }
    const slots = parsed.data.slots as Partial<Record<BackboneStage, string[]>>;
    const allIds = Object.values(slots).flat();
    const unknownId = allIds.find((id) => !agentStore.get(id));
    if (unknownId) {
      return { ok: false, error: `Unknown agent id: ${unknownId}` };
    }
    if (new Set(allIds).size !== allIds.length) {
      return { ok: false, error: "An agent may appear at most once across a workflow's slots" };
    }
    return { ok: true, data: { name: parsed.data.name, slots } };
  }

  const list: express.RequestHandler = (_req, res) => {
    res.json(workflowStore.list());
  };

  const create: express.RequestHandler = (req, res) => {
    const validation = validateWorkflowInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const workflow: WorkflowDefinition = { id: randomUUID(), ...validation.data, createdAt: new Date().toISOString() };
    workflowStore.create(workflow);
    res.status(201).json(workflow);
  };

  const update: express.RequestHandler = (req, res) => {
    if (req.params.id === DEFAULT_WORKFLOW_ID) {
      res.status(400).json({ error: "Cannot edit the default workflow" });
      return;
    }
    const existing = workflowStore.get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const validation = validateWorkflowInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const workflow: WorkflowDefinition = { ...existing, ...validation.data };
    workflowStore.update(req.params.id, workflow);
    res.status(200).json(workflow);
  };

  const remove: express.RequestHandler = (req, res) => {
    if (req.params.id === DEFAULT_WORKFLOW_ID) {
      res.status(400).json({ error: "Cannot delete the default workflow" });
      return;
    }
    workflowStore.delete(req.params.id);
    res.status(204).end();
  };

  return { list, create, update, remove };
}

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
  app.put("/api/workflows/:id", workflowHandlers.update);
  app.delete("/api/workflows/:id", workflowHandlers.remove);
  return app;
}
