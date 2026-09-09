import { describe, expect, it, vi } from "vitest";
import { RenderClient } from "./render.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("RenderClient", () => {
  it("createService posts to the Render API and returns the service id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ service: { id: "srv-1" } }));
    const client = new RenderClient("key-1", "owner-1", fetchImpl);

    const result = await client.createService({ name: "app", repoUrl: "https://github.com/org/app", branch: "main" });

    expect(result).toEqual({ serviceId: "srv-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.render.com/v1/services");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer key-1");
    expect(JSON.parse(init.body)).toMatchObject({ ownerId: "owner-1" });
  });

  it("createService throws when the Render API responds with an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "bad request" }, false, 400));
    const client = new RenderClient("key-1", "owner-1", fetchImpl);

    await expect(
      client.createService({ name: "app", repoUrl: "https://github.com/org/app", branch: "main" }),
    ).rejects.toThrow("Render createService failed: 400");
  });

  it("waitForLive resolves once the service reports a url", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ service: { serviceDetails: {} } }))
      .mockResolvedValueOnce(jsonResponse({ service: { serviceDetails: { url: "https://app.onrender.com" } } }));
    const client = new RenderClient("key-1", "owner-1", fetchImpl);

    const result = await client.waitForLive("srv-1", { maxAttempts: 2, pollIntervalMs: 0 });

    expect(result).toEqual({ url: "https://app.onrender.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waitForLive throws after exhausting maxAttempts without a url", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ service: { serviceDetails: {} } }));
    const client = new RenderClient("key-1", "owner-1", fetchImpl);

    await expect(client.waitForLive("srv-1", { maxAttempts: 2, pollIntervalMs: 0 })).rejects.toThrow(
      "Render service srv-1 did not become live after 2 attempts",
    );
  });
});
