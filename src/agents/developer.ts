import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { DeveloperOutputSchema, type DeveloperOutput } from "./schemas.js";

export function buildDeveloperPrompt(issueBody: string): string {
  return [
    "You are the Developer stage of an idea-to-MVP pipeline.",
    "You are working in a git checkout of the app repository, on a fresh branch.",
    "Implement the following plan by editing files, then commit and push your branch to origin.",
    "Do not open a pull request yourself - that is handled outside this agent.",
    "",
    "PLAN:",
    issueBody,
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"prTitle": string, "prBody": string}',
    "```",
  ].join("\n");
}

export async function runDeveloperAgent(
  issueBody: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<DeveloperOutput> {
  const prompt = buildDeveloperPrompt(issueBody);
  const rawOutput = await runClaudeAgent({
    prompt,
    cwd,
    allowedTools: ["Bash", "Read", "Write", "Edit"],
    signal,
  });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, DeveloperOutputSchema);
}
