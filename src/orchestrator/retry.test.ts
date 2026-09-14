import { describe, expect, test, vi } from "vitest";
import { isTransientError, withRetry } from "./retry.js";

describe("isTransientError", () => {
  test("treats a GitHub 502 RequestError as transient", () => {
    const error = Object.assign(new Error("Bad Gateway"), { status: 502 });
    expect(isTransientError(error)).toBe(true);
  });

  test("treats a GitHub 429 rate-limit RequestError as transient", () => {
    const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(isTransientError(error)).toBe(true);
  });

  test("treats a Render client error with the status embedded in the message as transient", () => {
    const error = new Error("Render createService failed: 503 Service Unavailable");
    expect(isTransientError(error)).toBe(true);
  });

  test("treats a known network error code as transient", () => {
    const error = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });
    expect(isTransientError(error)).toBe(true);
  });

  test("does not treat a 404 as transient", () => {
    const error = Object.assign(new Error("Not Found"), { status: 404 });
    expect(isTransientError(error)).toBe(false);
  });

  test("does not treat a schema validation error as transient", () => {
    const error = new Error("Agent output JSON did not match expected schema: invalid_type");
    expect(isTransientError(error)).toBe(false);
  });

  test("does not treat an unrelated 3-digit number in a non-HTTP error message as transient", () => {
    const error = new Error("claude -p exited with code 1: validation error at items[503]: missing field");
    expect(isTransientError(error)).toBe(false);
  });
});

describe("withRetry", () => {
  test("retries a transient failure and returns the eventual success", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        throw Object.assign(new Error("Bad Gateway"), { status: 502 });
      }
      return "ok";
    });

    const result = await withRetry(fn, { sleep: async () => {} });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("does not retry a non-transient error", async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    });

    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toThrow("Not Found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("gives up and throws after exhausting maxAttempts on persistent transient errors", async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("Bad Gateway"), { status: 502 });
    });

    await expect(withRetry(fn, { maxAttempts: 3, sleep: async () => {} })).rejects.toThrow("Bad Gateway");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("sleeps with exponential backoff between attempts", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error("Bad Gateway"), { status: 502 });
      return "ok";
    });
    const delays: number[] = [];

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(delays).toEqual([1000, 2000]);
  });

  test("does not wait out the full backoff delay once the signal aborts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const start = Date.now();
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error("Bad Gateway"), { status: 502 });
      }
      return "ok";
    });

    setTimeout(() => controller.abort(), 10);

    await withRetry(fn, { baseDelayMs: 2000, signal: controller.signal });

    expect(Date.now() - start).toBeLessThan(500);
    expect(attempts).toBe(2);
  });

  test("calls onRetry with the upcoming attempt number and the error before each retry", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw Object.assign(new Error("Bad Gateway"), { status: 502 });
      return "ok";
    });
    const onRetry = vi.fn();

    await withRetry(fn, { maxAttempts: 3, sleep: async () => {}, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(2, 3, expect.objectContaining({ message: "Bad Gateway" }));
  });
});
