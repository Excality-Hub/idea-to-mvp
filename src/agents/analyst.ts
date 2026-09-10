import { extractClaudeResultText, extractClaudeUsage, parseJsonBlock, runClaudeAgent, type AgentResult } from "../claudeAgent.js";
import { AnalystOutputSchema, type AnalystOutput } from "./schemas.js";

export function buildAnalystPrompt(ideaText: string): string {
  return [
    "You are the Analyst stage of an idea-to-MVP pipeline.",
    "Read the following idea/brief and produce a structured understanding of it.",
    "Do not ask clarifying questions back - note any ambiguity in openQuestions instead.",
    "",
    "IDEA:",
    ideaText,
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"summary": string, "goals": string[], "keyFeatures": string[], "nonGoals": string[], "openQuestions": string[]}',
    "```",
  ].join("\n");
}

export async function runAnalystAgent(
  ideaText: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentResult<AnalystOutput>> {
  const prompt = buildAnalystPrompt(ideaText);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [], signal });
  const resultText = extractClaudeResultText(rawOutput);
  const output = parseJsonBlock(resultText, AnalystOutputSchema);
  return { output, usage: extractClaudeUsage(rawOutput) };
}
