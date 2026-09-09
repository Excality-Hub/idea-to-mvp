import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const renderEnv = {
  GITHUB_TOKEN: "gh-token",
  TARGET_GITHUB_OWNER: "excality-sandbox",
  RENDER_API_KEY: "render-key",
  RENDER_OWNER_ID: "owner-id",
};

const cloudflareEnv = {
  GITHUB_TOKEN: "gh-token",
  TARGET_GITHUB_OWNER: "excality-sandbox",
  DEPLOY_TARGET: "cloudflare",
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_ACCOUNT_ID: "cf-account",
};

describe("loadConfig", () => {
  it("defaults DEPLOY_TARGET to render and returns a config object from valid render env vars", () => {
    expect(loadConfig(renderEnv)).toEqual({
      githubToken: "gh-token",
      targetGithubOwner: "excality-sandbox",
      deployTarget: "render",
      renderApiKey: "render-key",
      renderOwnerId: "owner-id",
      cloudflareApiToken: undefined,
      cloudflareAccountId: undefined,
      port: 3000,
    });
  });

  it("returns a config object from valid cloudflare env vars", () => {
    expect(loadConfig(cloudflareEnv)).toEqual({
      githubToken: "gh-token",
      targetGithubOwner: "excality-sandbox",
      deployTarget: "cloudflare",
      renderApiKey: undefined,
      renderOwnerId: undefined,
      cloudflareApiToken: "cf-token",
      cloudflareAccountId: "cf-account",
      port: 3000,
    });
  });

  it("uses PORT from env when provided", () => {
    expect(loadConfig({ ...renderEnv, PORT: "4000" }).port).toBe(4000);
  });

  it("throws if GITHUB_TOKEN is missing", () => {
    const { GITHUB_TOKEN, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("GITHUB_TOKEN is required");
  });

  it("throws if TARGET_GITHUB_OWNER is missing", () => {
    const { TARGET_GITHUB_OWNER, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("TARGET_GITHUB_OWNER is required");
  });

  it("throws if DEPLOY_TARGET is not render or cloudflare", () => {
    expect(() => loadConfig({ ...renderEnv, DEPLOY_TARGET: "heroku" })).toThrow(
      'DEPLOY_TARGET must be "render" or "cloudflare"',
    );
  });

  it("throws if RENDER_API_KEY is missing on the render target", () => {
    const { RENDER_API_KEY, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("RENDER_API_KEY is required");
  });

  it("throws if RENDER_OWNER_ID is missing on the render target", () => {
    const { RENDER_OWNER_ID, ...rest } = renderEnv;
    expect(() => loadConfig(rest)).toThrow("RENDER_OWNER_ID is required");
  });

  it("does not require RENDER_API_KEY/RENDER_OWNER_ID on the cloudflare target", () => {
    expect(() => loadConfig(cloudflareEnv)).not.toThrow();
  });

  it("throws if CLOUDFLARE_API_TOKEN is missing on the cloudflare target", () => {
    const { CLOUDFLARE_API_TOKEN, ...rest } = cloudflareEnv;
    expect(() => loadConfig(rest)).toThrow("CLOUDFLARE_API_TOKEN is required");
  });

  it("throws if CLOUDFLARE_ACCOUNT_ID is missing on the cloudflare target", () => {
    const { CLOUDFLARE_ACCOUNT_ID, ...rest } = cloudflareEnv;
    expect(() => loadConfig(rest)).toThrow("CLOUDFLARE_ACCOUNT_ID is required");
  });

  it("does not require CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID on the render target", () => {
    expect(() => loadConfig(renderEnv)).not.toThrow();
  });

  it("throws if PORT is not a number", () => {
    expect(() => loadConfig({ ...renderEnv, PORT: "not-a-number" })).toThrow("PORT must be a number");
  });
});
