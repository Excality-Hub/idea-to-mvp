// src/claudeAgent.test.ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import {
  CLAUDE_AGENT_TIMEOUT_MS,
  extractClaudeResultText,
  MAX_OUTPUT_BYTES,
  parseJsonBlock,
  runClaudeAgent,
} from "./claudeAgent.js";

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("runClaudeAgent", () => {
  it("resolves with stdout when the process exits 0", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runClaudeAgent({ prompt: "do it", cwd: "/tmp/repo", allowedTools: [] });
    child.stdout.emit("data", Buffer.from('{"result":"hi"}'));
    child.emit("close", 0);

    await expect(promise).resolves.toBe('{"result":"hi"}');
    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({ cwd: "/tmp/repo", timeout: CLAUDE_AGENT_TIMEOUT_MS }),
    );
  });

  it("kills the process and rejects when stdout exceeds the output byte limit", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runClaudeAgent({ prompt: "do it", cwd: "/tmp/repo", allowedTools: [] });
    child.stdout.emit("data", Buffer.alloc(MAX_OUTPUT_BYTES + 1));

    await expect(promise).rejects.toThrow(`claude -p output exceeded ${MAX_OUTPUT_BYTES} byte limit`);
    expect(child.kill).toHaveBeenCalled();
  });

  it("rejects with stderr when the process exits non-zero", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runClaudeAgent({ prompt: "do it", cwd: "/tmp/repo", allowedTools: [] });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 1);

    await expect(promise).rejects.toThrow("claude -p exited with code 1: boom");
  });
});

describe("extractClaudeResultText", () => {
  it("returns the result field from the claude -p JSON envelope", () => {
    expect(extractClaudeResultText('{"result":"hello world"}')).toBe("hello world");
  });

  it("throws if the envelope has no result field", () => {
    expect(() => extractClaudeResultText("{}")).toThrow(
      "claude -p output did not include a 'result' string field",
    );
  });
});

describe("parseJsonBlock", () => {
  const schema = z.object({ ok: z.boolean() });

  it("parses a fenced json block matching the schema", () => {
    const text = 'Some explanation.\n```json\n{"ok": true}\n```';
    expect(parseJsonBlock(text, schema)).toEqual({ ok: true });
  });

  it("throws if there is no fenced json block", () => {
    expect(() => parseJsonBlock("no block here", schema)).toThrow(
      "No fenced ```json block found in agent output",
    );
  });

  it("throws if the fenced block is not valid JSON", () => {
    expect(() => parseJsonBlock("```json\nnot json\n```", schema)).toThrow(
      "Fenced JSON block was not valid JSON",
    );
  });

  it("throws if the parsed JSON does not match the schema", () => {
    expect(() => parseJsonBlock('```json\n{"ok": "not a boolean"}\n```', schema)).toThrow(
      "Agent output JSON did not match expected schema",
    );
  });

  it("uses the last fenced json block when there are multiple", () => {
    const text = 'First attempt:\n```json\n{"ok": false}\n```\nActually, final answer:\n```json\n{"ok": true}\n```';
    expect(parseJsonBlock(text, schema)).toEqual({ ok: true });
  });
});
