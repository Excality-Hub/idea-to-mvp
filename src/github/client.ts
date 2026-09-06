import type { Octokit } from "@octokit/rest";
import type { StarterFile } from "./readStarterFiles.js";

export interface CreateRepoParams {
  owner: string;
  repoName: string;
  starterFiles: StarterFile[];
}

export interface CreatePullRequestParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  issueNumber: number;
}

export class GithubClient {
  constructor(private octokit: Octokit) {}

  async createRepoFromStarter(
    params: CreateRepoParams,
  ): Promise<{ owner: string; repo: string; htmlUrl: string; cloneUrl: string }> {
    const { owner, repoName, starterFiles } = params;
    const { data: repo } = await this.octokit.repos.createInOrg({
      org: owner,
      name: repoName,
      private: false,
    });

    for (const file of starterFiles) {
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: file.path,
        message: `add ${file.path}`,
        content: Buffer.from(file.content, "utf-8").toString("base64"),
      });
    }

    return { owner, repo: repoName, htmlUrl: repo.html_url, cloneUrl: repo.clone_url };
  }

  async createIssue(owner: string, repo: string, title: string, body: string): Promise<{ number: number }> {
    const { data } = await this.octokit.issues.create({ owner, repo, title, body });
    return { number: data.number };
  }

  async createPullRequest(
    params: CreatePullRequestParams,
  ): Promise<{ number: number; htmlUrl: string }> {
    const { data } = await this.octokit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: `${params.body}\n\nCloses #${params.issueNumber}`,
      head: params.head,
      base: params.base,
    });
    return { number: data.number, htmlUrl: data.html_url };
  }

  async postPrComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
  }

  async mergePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber, merge_method: "squash" });
  }
}
