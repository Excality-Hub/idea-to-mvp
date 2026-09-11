import { extractClaudeResultText, extractClaudeUsage, runClaudeAgent, type AgentResult } from "../claudeAgent.js";
import type { AgentDefinition } from "./types.js";

export interface CustomAgentOutput {
  text: string;
}

export function buildCustomAgentPrompt(agent: AgentDefinition, contextText: string): string {
  return [
    `You are a custom pipeline stage named "${agent.name}", part of an idea-to-MVP pipeline.`,
    "",
    contextText,
    "",
    "INSTRUCTIONS:",
    agent.instructions,
    "",
    "Respond in plain text with your findings or output. Do not include a fenced JSON code block.",
  ].join("\n");
}

export async function runCustomAgent(
  agent: AgentDefinition,
  contextText: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentResult<CustomAgentOutput>> {
  const prompt = buildCustomAgentPrompt(agent, contextText);
  const rawOutput = await runClaudeAgent({
    prompt,
    cwd,
    allowedTools: agent.repoAccess ? ["Read"] : [],
    signal,
  });
  const resultText = extractClaudeResultText(rawOutput);
  return { output: { text: resultText }, usage: extractClaudeUsage(rawOutput) };
}
