import { extractClaudeResultText, parseJsonBlock, runClaudeAgent } from "../claudeAgent.js";
import { QAOutputSchema, type QAOutput } from "./schemas.js";

export function buildQaPrompt(diff: string): string {
  return [
    "You are the QA stage of an idea-to-MVP pipeline.",
    "Review the following pull request diff for correctness and security issues.",
    'Only use severity "critical" for issues that would break the app or introduce a serious vulnerability - be conservative, this decides whether the app ships.',
    "",
    "DIFF:",
    diff,
    "",
    "Respond with a short explanation, then end your response with exactly one fenced JSON code block matching this shape:",
    "```json",
    '{"verdict": "pass"|"block", "findings": [{"severity": "info"|"minor"|"major"|"critical", "category": string, "summary": string, "file": string, "line": number}]}',
    "```",
  ].join("\n");
}

export async function runQaAgent(diff: string, cwd: string, signal?: AbortSignal): Promise<QAOutput> {
  const prompt = buildQaPrompt(diff);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: ["Read"], signal });
  const resultText = extractClaudeResultText(rawOutput);
  return parseJsonBlock(resultText, QAOutputSchema);
}
