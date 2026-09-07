export interface Config {
  githubToken: string;
  targetGithubOwner: string;
  renderApiKey: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const githubToken = env.GITHUB_TOKEN;
  const targetGithubOwner = env.TARGET_GITHUB_OWNER;
  const renderApiKey = env.RENDER_API_KEY;

  if (!githubToken) throw new Error("GITHUB_TOKEN is required");
  if (!targetGithubOwner) throw new Error("TARGET_GITHUB_OWNER is required");
  if (!renderApiKey) throw new Error("RENDER_API_KEY is required");

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (Number.isNaN(port)) throw new Error("PORT must be a number");

  return { githubToken, targetGithubOwner, renderApiKey, port };
}
