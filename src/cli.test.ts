import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";

describe("parseArgs", () => {
  it("returns the idea file path for `run <file>`", () => {
    expect(parseArgs(["node", "cli.js", "run", "idea.md"])).toEqual({ ideaFilePath: "idea.md" });
  });

  it("returns null when the command is missing", () => {
    expect(parseArgs(["node", "cli.js"])).toBeNull();
  });

  it("returns null when the command is not 'run'", () => {
    expect(parseArgs(["node", "cli.js", "bogus", "idea.md"])).toBeNull();
  });

  it("returns null when the idea file path is missing", () => {
    expect(parseArgs(["node", "cli.js", "run"])).toBeNull();
  });
});
