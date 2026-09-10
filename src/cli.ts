#!/usr/bin/env node
// src/cli.ts
import "dotenv/config";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Octokit } from "@octokit/rest";
import open from "open";
import { runAnalystAgent } from "./agents/analyst.js";
import { runArchitectAgent } from "./agents/architect.js";
import { runDeveloperAgent } from "./agents/developer.js";
import { runQaAgent } from "./agents/qa.js";
import { loadConfig } from "./config.js";
import { createDashboardServer } from "./dashboard/server.js";
import { CloudflareClient } from "./deploy/cloudflare.js";
import { RenderClient } from "./deploy/render.js";
import type { DeployClient } from "./deploy/types.js";
import { GithubClient } from "./github/client.js";
import { readStarterFiles } from "./github/readStarterFiles.js";
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch, resetWorkingTree } from "./git.js";
import { RunController } from "./orchestrator/runController.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const octokit = new Octokit({ auth: config.githubToken });
  const starterDir =
    config.deployTarget === "cloudflare"
      ? fileURLToPath(new URL("../templates/starter-cloudflare", import.meta.url))
      : fileURLToPath(new URL("../templates/starter-render", import.meta.url));
  const deployClient: DeployClient =
    config.deployTarget === "cloudflare"
      ? new CloudflareClient(config.cloudflareApiToken!, config.cloudflareAccountId!)
      : new RenderClient(config.renderApiKey!, config.renderOwnerId!);
  const controller = new RunController({
    owner: config.targetGithubOwner,
    starterDir,
    githubToken: config.githubToken,
    deps: {
      github: new GithubClient(octokit),
      deploy: deployClient,
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
