import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeployClient, DeployParams, DeployResult } from "./types.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareClient implements DeployClient {
  readonly label = "Cloudflare Workers";

  constructor(
    private apiToken: string,
    private accountId: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async deploy(params: DeployParams): Promise<DeployResult> {
    const scriptContent = readFileSync(join(params.workDir, "src/index.js"), "utf-8");
    await this.uploadScript(params.name, scriptContent);
    await this.enableSubdomain(params.name);
    const subdomain = await this.getAccountSubdomain();
    return { url: `https://${params.name}.${subdomain}.workers.dev` };
  }

  private async uploadScript(name: string, scriptContent: string): Promise<void> {
    const metadata = { main_module: "index.js", compatibility_date: "2026-01-01" };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("index.js", new Blob([scriptContent], { type: "application/javascript+module" }), "index.js");

    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}/workers/scripts/${name}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.apiToken}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Cloudflare uploadScript failed: ${res.status} ${await res.text()}`);
    }
  }

  private async enableSubdomain(name: string): Promise<void> {
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}/workers/scripts/${name}/subdomain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare enableSubdomain failed: ${res.status} ${await res.text()}`);
    }
  }

  private async getAccountSubdomain(): Promise<string> {
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Cloudflare getAccountSubdomain failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { result: { subdomain: string } };
    return data.result.subdomain;
  }
}
