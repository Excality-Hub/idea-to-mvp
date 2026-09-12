import { describe, expect, it } from "vitest";
import { analyzeInstructions } from "./instructionAnalysis";

describe("analyzeInstructions", () => {
  it("estimates the token count of the instructions text", () => {
    const result = analyzeInstructions("Review every pull request for security issues.", false);
    expect(result.tokenEstimate).toBe(8);
  });

  it("counts words in the instructions text", () => {
    const result = analyzeInstructions("Review every pull request for security issues.", false);
    expect(result.wordCount).toBe(7);
  });

  it("labels a short, single, scoped instruction as low complexity", () => {
    const result = analyzeInstructions("Summarize the contents of the linked pull request.", false);
    expect(result.complexityLabel).toBe("Low");
  });

  it("labels an instruction with many directives and branching as high complexity", () => {
    const result = analyzeInstructions(
      [
        "Read every file in the repo.",
        "If a file has no tests, write tests for it.",
        "If a file has a lint error, fix it.",
        "Otherwise, refactor it for clarity.",
        "Then update the README.",
        "Then open a pull request.",
        "Then notify the team in Slack.",
      ].join("\n"),
      false,
    );
    expect(result.complexityLabel).toBe("High");
  });

  it("gives a concrete, unambiguous instruction full clarity", () => {
    const result = analyzeInstructions("Add a unit test for the parseDate function.", false);
    expect(result.clarityScore).toBe(100);
  });

  it("lowers clarity for vague, ambiguous language", () => {
    const result = analyzeInstructions("Do some appropriate cleanup and fix various issues, etc.", false);
    expect(result.clarityScore).toBeLessThan(100);
  });

  it("gives a low cost tier to a short, simple instruction with no repo access", () => {
    const result = analyzeInstructions("Summarize the contents of the linked pull request.", false);
    expect(result.costTier).toBe("Low");
  });

  it("bumps the cost tier up when the same instruction is given repo access", () => {
    const withoutRepoAccess = analyzeInstructions("Summarize the contents of the linked pull request.", false);
    const withRepoAccess = analyzeInstructions("Summarize the contents of the linked pull request.", true);
    expect(withRepoAccess.costTier).not.toBe(withoutRepoAccess.costTier);
  });

  it("has no risk flags for a short, scoped, unambiguous instruction with no repo access", () => {
    const result = analyzeInstructions("Add a unit test for the parseDate function.", false);
    expect(result.riskFlags).toEqual([]);
  });

  it("flags unbounded scope language", () => {
    const result = analyzeInstructions("Read every file in the repo and summarize each one.", false);
    expect(result.riskFlags).toContain(
      'Unbounded scope language detected (e.g. "all", "every", "entire") — may cause runaway token usage.',
    );
  });

  it("flags vague, ambiguous language", () => {
    const result = analyzeInstructions("Do some appropriate cleanup.", false);
    expect(result.riskFlags).toContain(
      "Vague or ambiguous language detected — may cause inconsistent agent behavior.",
    );
  });

  it("flags repo access combined with non-trivial complexity", () => {
    const result = analyzeInstructions(
      "If a file has no tests, write tests for it. Otherwise, refactor it for clarity.",
      true,
    );
    expect(result.riskFlags).toContain(
      "Repo access combined with complex instructions can multiply real token usage well beyond this estimate.",
    );
  });
});
