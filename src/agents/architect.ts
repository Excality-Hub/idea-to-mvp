import { extractClaudeResultText, extractClaudeUsage, parseJsonBlock, runClaudeAgent, type AgentResult } from "../claudeAgent.js";
import { ArchitectOutputSchema, type AnalystOutput, type ArchitectOutput } from "./schemas.js";

export type StarterLayout = "render" | "cloudflare";

const LAYOUT_BLURBS: Record<StarterLayout, string[]> = {
  render: [
    "The app will be built inside a fixed Node/Express starter template with this layout:",
    "- package.json (Express dependency, `npm start` runs server.js)",
    "- server.js (a single Express app listening on process.env.PORT)",
    "- README.md",
  ],
  cloudflare: [
    "The app will be built inside a fixed Cloudflare Workers starter template with this layout:",
    "- package.json (no Express; `npm run dev` runs `wrangler dev` for local iteration)",
    "- wrangler.toml (Workers configuration)",
    "- src/index.js (a Workers `fetch(request)` handler - this exact file is what gets deployed)",
    "- README.md",
    "IMPORTANT: only src/index.js is uploaded when deploying - keep the entire app in this one file. Do not rename, move, or split it into multiple files/modules.",
    "IMPORTANT: always keep a GET / route that returns a simple 200 status response, even if the idea does not ask for one. This is used to verify the deploy is live and reachable from a browser - the idea's own routes should be added alongside it, not in place of it.",
  ],
};

export function buildArchitectPrompt(analystOutput: AnalystOutput, starterLayout: StarterLayout = "render"): string {
  return [
    "You are the Architect stage of an idea-to-MVP pipeline.",
    ...LAYOUT_BLURBS[starterLayout],
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

export async function runArchitectAgent(
  analystOutput: AnalystOutput,
  cwd: string,
  starterLayout: StarterLayout,
  signal?: AbortSignal,
): Promise<AgentResult<ArchitectOutput>> {
  const prompt = buildArchitectPrompt(analystOutput, starterLayout);
  const rawOutput = await runClaudeAgent({ prompt, cwd, allowedTools: [], signal });
  const resultText = extractClaudeResultText(rawOutput);
  const output = parseJsonBlock(resultText, ArchitectOutputSchema);
  return { output, usage: extractClaudeUsage(rawOutput) };
}
