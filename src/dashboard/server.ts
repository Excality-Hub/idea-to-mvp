import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import type { RunController } from "../orchestrator/runController.js";
import type { RunControllerRegistry } from "../orchestrator/runControllerRegistry.js";
import type { AgentStore } from "../agents/agentStore.js";
import { AgentDefinitionInputSchema, type AgentDefinition } from "../agents/types.js";
import { createDefaultWorkflow, defaultWorkflowIdFor, type WorkflowStore } from "../orchestrator/workflowStore.js";
import { BACKBONE_STAGES, isGateEntry, WorkflowInputSchema, type BackboneStage, type WorkflowDefinition } from "../orchestrator/types.js";
import { generateRepoName, type Project, type ProjectStore } from "../orchestrator/projectStore.js";
import type { RunStore, RunSummary } from "../orchestrator/runStore.js";

export function createEventsHandler(registry: Pick<RunControllerRegistry, "get">): express.RequestHandler {
  return (req, res) => {
    const controller = registry.get(req.params.projectId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const unsubscribeEvent = controller.eventBus.onEvent((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const unsubscribeReplaced = controller.onBusReplaced(() => {
      res.end();
    });

    req.on("close", () => {
      unsubscribeEvent();
      unsubscribeReplaced();
    });
  };
}

export function createRunHandlers(registry: Pick<RunControllerRegistry, "get">): {
  start: express.RequestHandler;
  stop: express.RequestHandler;
  resume: express.RequestHandler;
  approveGate: express.RequestHandler;
  rejectGate: express.RequestHandler;
  plan: express.RequestHandler;
} {
  const start: express.RequestHandler = (req, res) => {
    const body = req.body as { ideaText?: string; workflowId?: string } | undefined;
    const ideaText = body?.ideaText;
    if (!ideaText) {
      res.status(400).json({ error: "ideaText is required" });
      return;
    }
    try {
      const controller = registry.get(req.params.projectId);
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

  const stop: express.RequestHandler = (req, res) => {
    try {
      registry.get(req.params.projectId).stop();
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };

  const resume: express.RequestHandler = (req, res) => {
    try {
      registry.get(req.params.projectId).resume();
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };

  const decide = (decision: "approved" | "rejected"): express.RequestHandler => (req, res) => {
    try {
      registry.get(req.params.projectId).decideGate(req.params.gateId, decision);
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  };
  const approveGate = decide("approved");
  const rejectGate = decide("rejected");

  const plan: express.RequestHandler = (req, res) => {
    res.json(registry.get(req.params.projectId).getPlan() ?? []);
  };

  return { start, stop, resume, approveGate, rejectGate, plan };
}

export function createAgentHandlers(
  agentStore: AgentStore,
  workflowStore: Pick<WorkflowStore, "list">,
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
    const unknownId = allIds.find((id) => !isGateEntry(id) && !agentStore.get(id));
    if (unknownId) {
      return { ok: false, error: `Unknown agent id: ${unknownId}` };
    }
    if (new Set(allIds).size !== allIds.length) {
      return { ok: false, error: "An agent may appear at most once across a workflow's slots" };
    }
    return { ok: true, data: { name: parsed.data.name, slots } };
  }

  const list: express.RequestHandler = (req, res) => {
    res.json(workflowStore.listByProject(req.params.projectId));
  };

  const create: express.RequestHandler = (req, res) => {
    const validation = validateWorkflowInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const workflow: WorkflowDefinition = {
      id: randomUUID(),
      projectId: req.params.projectId,
      ...validation.data,
      createdAt: new Date().toISOString(),
    };
    workflowStore.create(workflow);
    res.status(201).json(workflow);
  };

  const update: express.RequestHandler = (req, res) => {
    const existing = workflowStore.get(req.params.workflowId);
    if (!existing || existing.projectId !== req.params.projectId) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    if (existing.id === defaultWorkflowIdFor(req.params.projectId)) {
      res.status(400).json({ error: "Cannot edit the default workflow" });
      return;
    }
    const validation = validateWorkflowInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const workflow: WorkflowDefinition = { ...existing, ...validation.data };
    workflowStore.update(req.params.workflowId, workflow);
    res.status(200).json(workflow);
  };

  const remove: express.RequestHandler = (req, res) => {
    const existing = workflowStore.get(req.params.workflowId);
    if (!existing || existing.projectId !== req.params.projectId) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    if (existing.id === defaultWorkflowIdFor(req.params.projectId)) {
      res.status(400).json({ error: "Cannot delete the default workflow" });
      return;
    }
    workflowStore.delete(req.params.workflowId);
    res.status(204).end();
  };

  return { list, create, update, remove };
}

export function createRequireProjectMiddleware(projectStore: Pick<ProjectStore, "get">): express.RequestHandler {
  return (req, res, next) => {
    if (!projectStore.get(req.params.projectId)) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    next();
  };
}

const ProjectInputSchema = z.object({ name: z.string().min(1) });

export function createProjectHandlers(
  projectStore: ProjectStore,
  workflowStore: Pick<WorkflowStore, "create">,
): { list: express.RequestHandler; get: express.RequestHandler; create: express.RequestHandler } {
  const list: express.RequestHandler = (_req, res) => {
    const projects = [...projectStore.list()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(projects);
  };

  const get: express.RequestHandler = (req, res) => {
    const project = projectStore.get(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  };

  const create: express.RequestHandler = (req, res) => {
    const parsed = ProjectInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const project: Project = {
      id: randomUUID(),
      name: parsed.data.name,
      repoName: generateRepoName(parsed.data.name),
      createdAt: new Date().toISOString(),
    };
    projectStore.create(project);
    workflowStore.create(createDefaultWorkflow(project.id));
    res.status(201).json(project);
  };

  return { list, get, create };
}

export function createRunsHandlers(
  runStore: Pick<RunStore, "listByProject" | "get">,
): { list: express.RequestHandler; get: express.RequestHandler } {
  const list: express.RequestHandler = (req, res) => {
    const runs: RunSummary[] = runStore
      .listByProject(req.params.projectId)
      .map(({ events: _events, ...summary }) => summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(runs);
  };

  const get: express.RequestHandler = (req, res) => {
    const run = runStore.get(req.params.runId);
    if (!run || run.projectId !== req.params.projectId) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  };

  return { list, get };
}

export function createDashboardServer(
  registry: RunControllerRegistry,
  agentStore: AgentStore,
  workflowStore: WorkflowStore,
  projectStore: ProjectStore,
  runStore: RunStore,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));

  const agentHandlers = createAgentHandlers(agentStore, workflowStore);
  app.get("/api/agents", agentHandlers.list);
  app.post("/api/agents", agentHandlers.create);
  app.delete("/api/agents/:id", agentHandlers.remove);

  const projectHandlers = createProjectHandlers(projectStore, workflowStore);
  app.get("/api/projects", projectHandlers.list);
  app.post("/api/projects", projectHandlers.create);

  app.use("/api/projects/:projectId", createRequireProjectMiddleware(projectStore));

  app.get("/api/projects/:projectId", projectHandlers.get);
  app.get("/api/projects/:projectId/events", createEventsHandler(registry));

  const { start, stop, resume, approveGate, rejectGate, plan } = createRunHandlers(registry);
  app.post("/api/projects/:projectId/run", start);
  app.post("/api/projects/:projectId/run/stop", stop);
  app.post("/api/projects/:projectId/run/resume", resume);
  app.post("/api/projects/:projectId/run/gates/:gateId/approve", approveGate);
  app.post("/api/projects/:projectId/run/gates/:gateId/reject", rejectGate);
  app.get("/api/projects/:projectId/run/plan", plan);

  const workflowHandlers = createWorkflowHandlers(workflowStore, agentStore);
  app.get("/api/projects/:projectId/workflows", workflowHandlers.list);
  app.post("/api/projects/:projectId/workflows", workflowHandlers.create);
  app.put("/api/projects/:projectId/workflows/:workflowId", workflowHandlers.update);
  app.delete("/api/projects/:projectId/workflows/:workflowId", workflowHandlers.remove);

  const runsHandlers = createRunsHandlers(runStore);
  app.get("/api/projects/:projectId/runs", runsHandlers.list);
  app.get("/api/projects/:projectId/runs/:runId", runsHandlers.get);

  return app;
}
