import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStarterFiles } from "./readStarterFiles.js";

describe("readStarterFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "starter-test-"));
    writeFileSync(join(dir, "package.json"), '{"name":"app"}');
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "file.txt"), "hello");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns every file with a path relative to the starter dir and its content", () => {
    const files = readStarterFiles(dir).sort((a, b) => a.path.localeCompare(b.path));

    expect(files).toEqual([
      { path: "nested/file.txt", content: "hello" },
      { path: "package.json", content: '{"name":"app"}' },
    ]);
  });
});
