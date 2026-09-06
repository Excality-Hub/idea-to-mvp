import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnv = {
  GITHUB_TOKEN: "gh-token",
  TARGET_GITHUB_OWNER: "excality-sandbox",
  RENDER_API_KEY: "render-key",
};

describe("loadConfig", () => {
  it("returns a config object from valid env vars, defaulting PORT to 3000", () => {
    expect(loadConfig(validEnv)).toEqual({
      githubToken: "gh-token",
      targetGithubOwner: "excality-sandbox",
      renderApiKey: "render-key",
      port: 3000,
    });
  });

  it("uses PORT from env when provided", () => {
    expect(loadConfig({ ...validEnv, PORT: "4000" }).port).toBe(4000);
  });

  it("throws if GITHUB_TOKEN is missing", () => {
    const { GITHUB_TOKEN, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow("GITHUB_TOKEN is required");
  });

  it("throws if TARGET_GITHUB_OWNER is missing", () => {
    const { TARGET_GITHUB_OWNER, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow("TARGET_GITHUB_OWNER is required");
  });

  it("throws if RENDER_API_KEY is missing", () => {
    const { RENDER_API_KEY, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow("RENDER_API_KEY is required");
  });

  it("throws if PORT is not a number", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "not-a-number" })).toThrow(
      "PORT must be a number",
    );
  });
});
