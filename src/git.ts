import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

// Use promisify which has built-in support for execFile's multi-value callback
const execFileAsync = promisify(execFileCallback);

// Replaces every literal occurrence of `token` in `message` with "***". Used to
// scrub the GitHub token out of error messages before they can be logged,
// surfaced over SSE, or committed into the tracing pack - execFile's promisified
// rejection includes the full argv (which embeds the token via the
// http.extraheader auth arg) in its error message.
export function redactToken(message: string, token: string): string {
  if (!token) return message;
  return message.split(token).join("***");
}

export async function cloneRepo(cloneUrl: string, targetDir: string, token: string): Promise<void> {
  try {
    await execFileAsync("git", [
      "-c",
      `http.extraheader=AUTHORIZATION: bearer ${token}`,
      "clone",
      cloneUrl,
      targetDir,
    ]);
  } catch (error) {
    const err = error as Error;
    err.message = redactToken(err.message, token);
    throw err;
  }
}

export async function createAndCheckoutBranch(repoDir: string, branchName: string): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", branchName], { cwd: repoDir });
}

export async function pushBranch(repoDir: string, branchName: string, token: string): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["-c", `http.extraheader=AUTHORIZATION: bearer ${token}`, "push", "-u", "origin", branchName],
      { cwd: repoDir },
    );
  } catch (error) {
    const err = error as Error;
    err.message = redactToken(err.message, token);
    throw err;
  }
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
