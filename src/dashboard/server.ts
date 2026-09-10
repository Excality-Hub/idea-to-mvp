import { fileURLToPath } from "node:url";
import express from "express";
import type { RunEventBus } from "../orchestrator/events.js";
import type { RunController } from "../orchestrator/runController.js";

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
    const ideaText = (req.body as { ideaText?: string } | undefined)?.ideaText;
    if (!ideaText) {
      res.status(400).json({ error: "ideaText is required" });
      return;
    }
    try {
      controller.start(ideaText);
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

export function createDashboardServer(controller: RunController): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));
  app.get("/events", createEventsHandler(controller));
  const { start, stop, resume } = createRunHandlers(controller);
  app.post("/api/run", start);
  app.post("/api/run/stop", stop);
  app.post("/api/run/resume", resume);
  return app;
}
