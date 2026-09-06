#!/usr/bin/env node
// src/cli.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";
import open from "open";
import { runAnalystAgent } from "./agents/analyst.js";
import { runArchitectAgent } from "./agents/architect.js";
import { runDeveloperAgent } from "./agents/developer.js";
import { runQaAgent } from "./agents/qa.js";
import { loadConfig } from "./config.js";
import { createDashboardServer } from "./dashboard/server.js";
import { RenderClient } from "./deploy/render.js";
import { GithubClient } from "./github/client.js";
import { readStarterFiles } from "./github/readStarterFiles.js";
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "./git.js";
import { RunEventBus } from "./orchestrator/events.js";
import { runOrchestrator } from "./orchestrator/runOrchestrator.js";

export function parseArgs(argv: string[]): { ideaFilePath: string } | null {
  const [, , command, ideaFilePath] = argv;
  if (command !== "run" || !ideaFilePath) {
    return null;
  }
  return { ideaFilePath };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error("Usage: idea-to-mvp run <idea-file>");
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const ideaText = readFileSync(parsed.ideaFilePath, "utf-8");
  const repoName = `idea-to-mvp-${Date.now()}`;
  const workDir = mkdtempSync(join(tmpdir(), "idea-to-mvp-"));

  const eventBus = new RunEventBus();
  eventBus.onEvent((event) => {
    console.log(`[${event.stage}] ${event.status}: ${event.message}`);
  });

  const app = createDashboardServer(eventBus);
  app.listen(config.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
  });
  await open(`http://localhost:${config.port}`);

  const octokit = new Octokit({ auth: config.githubToken });
  const outcome = await runOrchestrator(
    {
      ideaText,
      owner: config.targetGithubOwner,
      repoName,
      starterDir: fileURLToPath(new URL("../templates/starter", import.meta.url)),
      workDir,
    },
    {
      eventBus,
      github: new GithubClient(octokit),
      render: new RenderClient(config.renderApiKey),
      git: { cloneRepo, createAndCheckoutBranch, pushBranch, diffAgainstBase },
      agents: {
        analyst: runAnalystAgent,
        architect: runArchitectAgent,
        developer: runDeveloperAgent,
        qa: runQaAgent,
      },
      readStarterFiles,
    },
  );

  if (outcome.status === "deployed") {
    console.log(`Live at ${outcome.url}`);
  } else if (outcome.status === "blocked") {
    console.log(`Blocked by QA - see ${outcome.prUrl}`);
  } else {
    console.error(`Failed at stage ${outcome.stage}: ${outcome.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
