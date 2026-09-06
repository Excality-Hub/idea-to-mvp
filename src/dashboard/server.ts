import { fileURLToPath } from "node:url";
import express from "express";
import type { RunEventBus } from "../orchestrator/events.js";

export function createEventsHandler(eventBus: RunEventBus): express.RequestHandler {
  return (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const unsubscribe = eventBus.onEvent((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => unsubscribe());
  };
}

export function createDashboardServer(eventBus: RunEventBus): express.Express {
  const app = express();
  app.use(express.static(fileURLToPath(new URL("../../public", import.meta.url))));
  app.get("/events", createEventsHandler(eventBus));
  return app;
}
