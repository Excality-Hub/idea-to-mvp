export interface DeployParams {
  name: string;
  repoUrl: string;
  branch: string;
  workDir: string;
}

export interface DeployResult {
  url: string;
}

export interface DeployClient {
  readonly label: string;
  deploy(params: DeployParams): Promise<DeployResult>;
}
