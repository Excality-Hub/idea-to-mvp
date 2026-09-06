import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

// Use promisify which has built-in support for execFile's multi-value callback
const execFileAsync = promisify(execFileCallback);

export async function cloneRepo(cloneUrl: string, targetDir: string): Promise<void> {
  await execFileAsync("git", ["clone", cloneUrl, targetDir]);
}

export async function createAndCheckoutBranch(repoDir: string, branchName: string): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", branchName], { cwd: repoDir });
}

export async function pushBranch(repoDir: string, branchName: string): Promise<void> {
  await execFileAsync("git", ["push", "-u", "origin", branchName], { cwd: repoDir });
}

export async function diffAgainstBase(repoDir: string, baseBranch: string): Promise<string> {
  const result = await execFileAsync("git", ["diff", `origin/${baseBranch}`], { cwd: repoDir });
  // Node.js promisify of execFile with custom symbol returns { stdout, stderr }
  // But with mocks, fallback to direct string value
  const stdout = typeof result === 'object' && result !== null && 'stdout' in result
    ? result.stdout
    : result;
  return stdout;
}
