#!/usr/bin/env node
// src/cli.ts
import "dotenv/config";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Octokit } from "@octokit/rest";
import open from "open";
import { runAnalystAgent } from "./agents/analyst.js";
import { runArchitectAgent } from "./agents/architect.js";
import { createAgentStore } from "./agents/agentStore.js";
import { runCustomAgent } from "./agents/custom.js";
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
import { RunControllerRegistry } from "./orchestrator/runControllerRegistry.js";
import { createProjectStore } from "./orchestrator/projectStore.js";
import { createRunStore } from "./orchestrator/runStore.js";
import { createWorkflowStore } from "./orchestrator/workflowStore.js";
import { migrateLegacyData } from "./orchestrator/migrateLegacyProjects.js";

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
  const agentStore = createAgentStore(fileURLToPath(new URL("../data/agents.json", import.meta.url)));

  const projectsFile = fileURLToPath(new URL("../data/projects.json", import.meta.url));
  const workflowsFile = fileURLToPath(new URL("../data/workflows.json", import.meta.url));
  const runsFile = fileURLToPath(new URL("../data/runs.json", import.meta.url));
  migrateLegacyData({ projectsFile, workflowsFile, runsFile });

  const workflowStore = createWorkflowStore(workflowsFile);
  const projectStore = createProjectStore(projectsFile);
  const runStore = createRunStore(runsFile);

  const registry = new RunControllerRegistry((projectId) => {
    const controller = new RunController({
      projectId,
      owner: config.targetGithubOwner,
      starterDir,
      githubToken: config.githubToken,
      agentStore,
      workflowStore,
      runStore,
      projectStore,
      deps: {
        github: new GithubClient(octokit),
        deploy: deployClient,
        git: { cloneRepo, createAndCheckoutBranch, resetWorkingTree, pushBranch, diffAgainstBase },
        agents: {
          analyst: runAnalystAgent,
          architect: runArchitectAgent,
          developer: runDeveloperAgent,
          qa: runQaAgent,
          custom: runCustomAgent,
        },
        readStarterFiles,
      },
    });
    controller.eventBus.onEvent((event) => {
      console.log(`[${projectId}] [${event.stage}] ${event.status}: ${event.message}`);
    });
    return controller;
  });

  const app = createDashboardServer(registry, agentStore, workflowStore, projectStore, runStore);
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
