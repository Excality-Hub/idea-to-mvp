const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
]);
const STATUS_IN_MESSAGE = /\bfailed:\s*(429|5\d\d)\b/;

export function isTransientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  if (typeof status === "number" && TRANSIENT_STATUS_CODES.has(status)) return true;

  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ??
    (error as { cause?: { code?: unknown } }).cause?.code;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && STATUS_IN_MESSAGE.test(message)) return true;

  return false;
}

export interface WithRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, maxAttempts: number, error: Error) => void;
  signal?: AbortSignal;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortableSleep(ms: number, sleep: (ms: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal || signal.aborted) return sleep(ms);
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
    sleep(ms).then(resolve);
  });
}

export async function withRetry<T>(fn: () => Promise<T>, options: WithRetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !isTransientError(error)) {
        throw error;
      }
      options.onRetry?.(attempt + 1, maxAttempts, error as Error);
      await abortableSleep(baseDelayMs * 2 ** (attempt - 1), sleep, options.signal);
    }
  }
  throw new Error("unreachable");
}
