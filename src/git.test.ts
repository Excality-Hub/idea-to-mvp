// src/git.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { cloneRepo, createAndCheckoutBranch, diffAgainstBase, pushBranch } from "./git.js";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecFileOnce(stdout: string) {
  vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback;
    callback(null, stdout, "");
    return {} as never;
  }) as never);
}

describe("git helper", () => {
  it("cloneRepo runs git clone with the url and target dir, authenticated with a bearer token header", async () => {
    mockExecFileOnce("");
    await cloneRepo("git@github.com:org/repo.git", "/tmp/work", "test-token");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-c",
        "http.extraheader=AUTHORIZATION: bearer test-token",
        "clone",
        "git@github.com:org/repo.git",
        "/tmp/work",
      ],
      expect.any(Function),
    );
  });

  it("createAndCheckoutBranch runs git checkout -b in the repo dir", async () => {
    mockExecFileOnce("");
    await createAndCheckoutBranch("/tmp/work", "feature/x");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["checkout", "-b", "feature/x"],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
  });

  it("pushBranch runs git push -u origin <branch> in the repo dir, authenticated with a bearer token header", async () => {
    mockExecFileOnce("");
    await pushBranch("/tmp/work", "feature/x", "test-token");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-c",
        "http.extraheader=AUTHORIZATION: bearer test-token",
        "push",
        "-u",
        "origin",
        "feature/x",
      ],
      { cwd: "/tmp/work" },
      expect.any(Function),
    );
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
