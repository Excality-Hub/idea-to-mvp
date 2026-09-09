export class RenderClient {
  constructor(
    private apiKey: string,
    private ownerId: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async createService(params: { name: string; repoUrl: string; branch: string }): Promise<{ serviceId: string }> {
    const res = await this.fetchImpl("https://api.render.com/v1/services", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "web_service",
        name: params.name,
        ownerId: this.ownerId,
        repo: params.repoUrl,
        branch: params.branch,
        serviceDetails: {
          env: "node",
          envSpecificDetails: { buildCommand: "npm install", startCommand: "npm start" },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Render createService failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { service: { id: string } };
    return { serviceId: data.service.id };
  }

  async waitForLive(
    serviceId: string,
    options: { maxAttempts: number; pollIntervalMs: number },
  ): Promise<{ url: string }> {
    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      const res = await this.fetchImpl(`https://api.render.com/v1/services/${serviceId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        throw new Error(`Render getService failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { service: { serviceDetails?: { url?: string } } };
      const url = data.service.serviceDetails?.url;
      if (url) {
        return { url };
      }

      if (attempt < options.maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
      }
    }

    throw new Error(`Render service ${serviceId} did not become live after ${options.maxAttempts} attempts`);
  }
}
