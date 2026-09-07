import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { ArchitectOutputSchema, type AnalystOutput, type ArchitectOutput } from "./schemas.js";

export function buildArchitectPrompt(analystOutput: AnalystOutput): string {
  return [
    "You are the Architect stage of an idea-to-MVP pipeline.",
    "The app will be built inside a fixed Node/Express starter template with this layout:",
    "- package.json (Express dependency, `npm start` runs server.js)",
    "- server.js (a single Express app listening on process.env.PORT)",
    "- README.md",
    "",
    "Given the following structured understanding of the idea, produce a concrete implementation plan for the Developer agent.",
    "",
    JSON.stringify(analystOutput, null, 2),
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"issueTitle": string, "issueBody": string, "branchName": string}',
    "```",
  ].join("\n");
}

export async function runArchitectAgent(analystOutput: AnalystOutput, cwd: string): Promise<ArchitectOutput> {
  const prompt = buildArchitectPrompt(analystOutput);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [] });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, ArchitectOutputSchema);
}
