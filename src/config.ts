export interface Config {
  githubToken: string;
  targetGithubOwner: string;
  deployTarget: "render" | "cloudflare";
  renderApiKey?: string;
  renderOwnerId?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const githubToken = env.GITHUB_TOKEN;
  const targetGithubOwner = env.TARGET_GITHUB_OWNER;

  if (!githubToken) throw new Error("GITHUB_TOKEN is required");
  if (!targetGithubOwner) throw new Error("TARGET_GITHUB_OWNER is required");

  const deployTargetRaw = env.DEPLOY_TARGET ?? "render";
  if (deployTargetRaw !== "render" && deployTargetRaw !== "cloudflare") {
    throw new Error('DEPLOY_TARGET must be "render" or "cloudflare"');
  }
  const deployTarget = deployTargetRaw;

  let renderApiKey: string | undefined;
  let renderOwnerId: string | undefined;
  let cloudflareApiToken: string | undefined;
  let cloudflareAccountId: string | undefined;

  if (deployTarget === "render") {
    renderApiKey = env.RENDER_API_KEY;
    renderOwnerId = env.RENDER_OWNER_ID;
    if (!renderApiKey) throw new Error("RENDER_API_KEY is required");
    if (!renderOwnerId) throw new Error("RENDER_OWNER_ID is required");
  } else {
    cloudflareApiToken = env.CLOUDFLARE_API_TOKEN;
    cloudflareAccountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!cloudflareApiToken) throw new Error("CLOUDFLARE_API_TOKEN is required");
    if (!cloudflareAccountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  }

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (Number.isNaN(port)) throw new Error("PORT must be a number");

  return {
    githubToken,
    targetGithubOwner,
    deployTarget,
    renderApiKey,
    renderOwnerId,
    cloudflareApiToken,
    cloudflareAccountId,
    port,
  };
}
