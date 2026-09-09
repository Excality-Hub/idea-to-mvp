import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "./cloudflare.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeWorkDir(scriptContent = "export default { fetch() {} };"): string {
  const workDir = mkdtempSync(join(tmpdir(), "cloudflare-client-test-"));
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/index.js"), scriptContent);
  return workDir;
}

describe("CloudflareClient", () => {
  let workDir: string;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("deploy uploads the script, enables the subdomain, and returns the workers.dev URL", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { id: "app" } }))
      .mockResolvedValueOnce(jsonResponse({ result: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ result: { subdomain: "my-subdomain" } }));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    const result = await client.deploy({
      name: "app",
      repoUrl: "https://github.com/org/app",
      branch: "main",
      workDir,
    });

    expect(result).toEqual({ url: "https://app.my-subdomain.workers.dev" });
    expect(client.label).toBe("Cloudflare Workers");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [uploadUrl, uploadInit] = fetchImpl.mock.calls[0];
    expect(uploadUrl).toBe("https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts/app");
    expect(uploadInit.method).toBe("PUT");
    expect(uploadInit.headers.Authorization).toBe("Bearer token-1");
  });

  it("deploy throws when the script upload fails", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "bad request" }, false, 400));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    await expect(
      client.deploy({ name: "app", repoUrl: "https://github.com/org/app", branch: "main", workDir }),
    ).rejects.toThrow("Cloudflare uploadScript failed: 400");
  });

  it("deploy throws when enabling the subdomain fails", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { id: "app" } }))
      .mockResolvedValueOnce(jsonResponse({ message: "bad request" }, false, 400));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    await expect(
      client.deploy({ name: "app", repoUrl: "https://github.com/org/app", branch: "main", workDir }),
    ).rejects.toThrow("Cloudflare enableSubdomain failed: 400");
  });

  it("deploy throws when fetching the account subdomain fails", async () => {
    workDir = makeWorkDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { id: "app" } }))
      .mockResolvedValueOnce(jsonResponse({ result: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ message: "bad request" }, false, 400));
    const client = new CloudflareClient("token-1", "account-1", fetchImpl);

    await expect(
      client.deploy({ name: "app", repoUrl: "https://github.com/org/app", branch: "main", workDir }),
    ).rejects.toThrow("Cloudflare getAccountSubdomain failed: 400");
  });
});
