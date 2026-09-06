import { describe, expect, it, vi } from "vitest";
import { GithubClient } from "./client.js";
import type { StarterFile } from "./readStarterFiles.js";

function makeFakeOctokit() {
  return {
    repos: {
      createInOrg: vi.fn().mockResolvedValue({
        data: { html_url: "https://github.com/org/repo", clone_url: "https://github.com/org/repo.git" },
      }),
      createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
    },
    issues: {
      create: vi.fn().mockResolvedValue({ data: { number: 7 } }),
      createComment: vi.fn().mockResolvedValue({}),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({ data: { number: 12, html_url: "https://github.com/org/repo/pull/12" } }),
      merge: vi.fn().mockResolvedValue({}),
    },
  };
}

const starterFiles: StarterFile[] = [{ path: "package.json", content: '{"name":"app"}' }];

describe("GithubClient", () => {
  it("createRepoFromStarter creates the repo and commits each starter file", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    const result = await client.createRepoFromStarter({ owner: "org", repoName: "repo", starterFiles });

    expect(octokit.repos.createInOrg).toHaveBeenCalledWith({ org: "org", name: "repo", private: false });
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      path: "package.json",
      message: "add package.json",
      content: Buffer.from('{"name":"app"}', "utf-8").toString("base64"),
    });
    expect(result).toEqual({
      owner: "org",
      repo: "repo",
      htmlUrl: "https://github.com/org/repo",
      cloneUrl: "https://github.com/org/repo.git",
    });
  });

  it("createIssue creates an issue and returns its number", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    const result = await client.createIssue("org", "repo", "Add feature", "Do the thing");

    expect(octokit.issues.create).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      title: "Add feature",
      body: "Do the thing",
    });
    expect(result).toEqual({ number: 7 });
  });

  it("createPullRequest opens a PR that closes the linked issue", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    const result = await client.createPullRequest({
      owner: "org",
      repo: "repo",
      title: "Add feature",
      body: "Did the thing",
      head: "feature/x",
      base: "main",
      issueNumber: 7,
    });

    expect(octokit.pulls.create).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      title: "Add feature",
      body: "Did the thing\n\nCloses #7",
      head: "feature/x",
      base: "main",
    });
    expect(result).toEqual({ number: 12, htmlUrl: "https://github.com/org/repo/pull/12" });
  });

  it("postPrComment posts a comment on the PR's issue thread", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    await client.postPrComment("org", "repo", 12, "QA review: pass");

    expect(octokit.issues.createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 12,
      body: "QA review: pass",
    });
  });

  it("mergePullRequest squash-merges the PR", async () => {
    const octokit = makeFakeOctokit();
    const client = new GithubClient(octokit as never);

    await client.mergePullRequest("org", "repo", 12);

    expect(octokit.pulls.merge).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 12,
      merge_method: "squash",
    });
  });
});
