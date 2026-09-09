#!/usr/bin/env node
// src/cli.ts
import "dotenv/config";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch, resetWorkingTree } from "./git.js";
import { RunController } from "./orchestrator/runController.js";

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

  const octokit = new Octokit({ auth: config.githubToken });
  const controller = new RunController({
    owner: config.targetGithubOwner,
    starterDir: fileURLToPath(new URL("../templates/starter", import.meta.url)),
    githubToken: config.githubToken,
    deps: {
      github: new GithubClient(octokit),
      render: new RenderClient(config.renderApiKey, config.renderOwnerId),
      git: { cloneRepo, createAndCheckoutBranch, resetWorkingTree, pushBranch, diffAgainstBase },
      agents: {
        analyst: runAnalystAgent,
        architect: runArchitectAgent,
        developer: runDeveloperAgent,
        qa: runQaAgent,
      },
      readStarterFiles,
    },
  });

  controller.eventBus.onEvent((event) => {
    console.log(`[${event.stage}] ${event.status}: ${event.message}`);
  });

  const app = createDashboardServer(controller);
  app.listen(config.port, "127.0.0.1", () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
  });
  await open(`http://localhost:${config.port}`);

  controller.start(ideaText);
  const outcome = await controller.getRunPromise();

  if (outcome?.status === "deployed") {
    console.log(`Live at ${outcome.url}`);
  } else if (outcome?.status === "blocked") {
    console.log(`Blocked by QA - see ${outcome.prUrl}`);
  } else if (outcome?.status === "failed") {
    console.error(`Failed at stage ${outcome.stage}: ${outcome.error}`);
    process.exitCode = 1;
  } else {
    console.error(`Run stopped at stage ${outcome?.stage}`);
    process.exitCode = 1;
  }
}

function resolveEntryPointUrl(): string {
  if (!process.argv[1]) return "";
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return pathToFileURL(process.argv[1]).href;
  }
}

if (import.meta.url === resolveEntryPointUrl()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
