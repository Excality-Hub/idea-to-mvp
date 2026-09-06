import { spawn } from "node:child_process";
import type { z } from "zod";

export interface RunClaudeAgentParams {
  prompt: string;
  cwd: string;
  allowedTools: string[];
}

export function runClaudeAgent(params: RunClaudeAgentParams): Promise<string> {
  const { prompt, cwd, allowedTools } = params;
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json"];
    if (allowedTools.length > 0) {
      args.push("--allowedTools", allowedTools.join(" "));
    }
    const child = spawn("claude", args, { cwd });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p exited with code ${code}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function extractClaudeResultText(rawOutput: string): string {
  const envelope = JSON.parse(rawOutput) as { result?: unknown };
  if (typeof envelope.result !== "string") {
    throw new Error("claude -p output did not include a 'result' string field");
  }
  return envelope.result;
}

export function parseJsonBlock<T>(text: string, schema: z.ZodType<T>): T {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    throw new Error("No fenced ```json block found in agent output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Fenced JSON block was not valid JSON: ${(error as Error).message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Agent output JSON did not match expected schema: ${result.error.message}`);
  }
  return result.data;
}
