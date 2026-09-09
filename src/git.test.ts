// src/git.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch, resetWorkingTree } from "./git.js";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecFileOnce(stdout: string) {
  vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback;
    callback(null, stdout, "");
    return {} as never;
  }) as never);
}

function mockExecFileFailureOnce(error: Error) {
  vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback;
    callback(error, "", "");
    return {} as never;
  }) as never);
}

describe("git helper", () => {
  it("cloneRepo runs git clone with the url and target dir, authenticated with a Basic auth header", async () => {
    mockExecFileOnce("");
    await cloneRepo("git@github.com:org/repo.git", "/tmp/work", "test-token");
    const credentials = Buffer.from("x-access-token:test-token").toString("base64");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-c",
        `http.extraheader=AUTHORIZATION: basic ${credentials}`,
        "clone",
        "git@github.com:org/repo.git",
        "/tmp/work",
      ],
      expect.any(Function),
    );
  });

  it("createAndCheckoutBranch runs git checkout -B in the repo dir", async () => {
    mockExecFileOnce("");
    await createAndCheckoutBranch("/tmp/work", "feature/x");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["checkout", "-B", "feature/x"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });

  it("resetWorkingTree runs git reset --hard then git clean -fd in the repo dir", async () => {
    // This is the only test here that asserts on call *ordering*, and the shared
    // execFile mock accumulates calls across tests (vitest's clearMocks is off),
    // so drop the earlier tests' calls to make the nth-call indices below local.
    vi.mocked(execFile).mockClear();
    mockExecFileOnce("");
    mockExecFileOnce("");
    await resetWorkingTree("/tmp/work");
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["reset", "--hard"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["clean", "-fd"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });

  it("pushBranch runs git push -u origin <branch> in the repo dir, authenticated with a Basic auth header", async () => {
    mockExecFileOnce("");
    await pushBranch("/tmp/work", "feature/x", "test-token");
    const credentials = Buffer.from("x-access-token:test-token").toString("base64");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-c",
        `http.extraheader=AUTHORIZATION: basic ${credentials}`,
        "push",
        "-u",
        "origin",
        "feature/x",
      ],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });

  it("cloneRepo redacts the token and its Basic auth encoding from a rejected error's message so it never leaks in logs or committed docs", async () => {
    const token = "ghp_supersecrettoken123";
    const credentials = Buffer.from(`x-access-token:${token}`).toString("base64");
    mockExecFileFailureOnce(
      new Error(
        `Command failed: git -c http.extraheader=AUTHORIZATION: basic ${credentials} clone git@github.com:org/repo.git /tmp/work`,
      ),
    );

    try {
      await cloneRepo("git@github.com:org/repo.git", "/tmp/work", token);
      expect.unreachable("expected cloneRepo to reject");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(token);
      expect(message).not.toContain(credentials);
      expect(message).toContain("***");
    }
  });

  it("pushBranch redacts the token and its Basic auth encoding from a rejected error's message so it never leaks in logs or committed docs", async () => {
    const token = "ghp_supersecrettoken123";
    const credentials = Buffer.from(`x-access-token:${token}`).toString("base64");
    mockExecFileFailureOnce(
      new Error(
        `Command failed: git -c http.extraheader=AUTHORIZATION: basic ${credentials} push -u origin feature/x`,
      ),
    );

    try {
      await pushBranch("/tmp/work", "feature/x", token);
      expect.unreachable("expected pushBranch to reject");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(token);
      expect(message).not.toContain(credentials);
      expect(message).toContain("***");
    }
  });

  it("diffAgainstBase returns the diff output against origin/<base>", async () => {
    mockExecFileOnce("diff --git a/x b/x");
    const diff = await diffAgainstBase("/tmp/work", "main");
    expect(diff).toBe("diff --git a/x b/x");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["diff", "origin/main"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });
});
