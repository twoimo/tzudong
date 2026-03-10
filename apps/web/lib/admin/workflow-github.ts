import 'server-only';

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  workflowFile: string;
  workflowRef: string;
}

export interface DispatchWorkflowInput {
  channelUrl: string;
  channelSlug: string;
  dispatchRequestId: string;
  triggerSource: 'manual_admin';
  maxVideos?: string;
}

export interface DispatchWorkflowResult {
  ok: boolean;
  status: number;
  retriedWithLegacyPayload: boolean;
  error: string | null;
}

export interface GitHubWorkflowRunStatus {
  runId: number;
  status: string | null;
  conclusion: string | null;
  runNumber: number | null;
  runAttempt: number | null;
  htmlUrl: string | null;
  updatedAt: string | null;
}

const DEFAULT_WORKFLOW_FILE = process.env.GITHUB_DAILY_WORKFLOW_FILE || 'daily-crawler.yml';
const DEFAULT_WORKFLOW_REF = process.env.GITHUB_WORKFLOW_REF || 'data';

export function getGitHubConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    throw new Error('GitHub integration env is not configured.');
  }

  return {
    token,
    owner,
    repo,
    workflowFile: DEFAULT_WORKFLOW_FILE,
    workflowRef: DEFAULT_WORKFLOW_REF,
  };
}

async function dispatchWorkflow(config: GitHubConfig, inputs: Record<string, string>) {
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: config.workflowRef,
        inputs,
      }),
    },
  );

  return response;
}

export async function dispatchDailyWorkflow(input: DispatchWorkflowInput): Promise<DispatchWorkflowResult> {
  const config = getGitHubConfig();

  const fullInputs: Record<string, string> = {
    max_videos: input.maxVideos ?? '-1',
    channel_url: input.channelUrl,
    channel_slug: input.channelSlug,
    dispatch_uuid: input.dispatchRequestId,
    trigger_source: input.triggerSource,
  };

  const fullResponse = await dispatchWorkflow(config, fullInputs);
  if (fullResponse.ok) {
    return {
      ok: true,
      status: fullResponse.status,
      retriedWithLegacyPayload: false,
      error: null,
    };
  }

  const fullErrorBody = await fullResponse.text();
  return {
    ok: false,
    status: fullResponse.status,
    retriedWithLegacyPayload: false,
    error: fullErrorBody || 'GitHub workflow dispatch failed.',
  };
}

export async function fetchWorkflowRunStatus(githubRunId: number): Promise<GitHubWorkflowRunStatus> {
  const config = getGitHubConfig();

  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs/${githubRunId}`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch GitHub run status (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as {
    id: number;
    status: string | null;
    conclusion: string | null;
    run_number?: number | null;
    run_attempt?: number | null;
    html_url?: string | null;
    updated_at?: string | null;
  };

  return {
    runId: payload.id,
    status: payload.status ?? null,
    conclusion: payload.conclusion ?? null,
    runNumber: payload.run_number ?? null,
    runAttempt: payload.run_attempt ?? null,
    htmlUrl: payload.html_url ?? null,
    updatedAt: payload.updated_at ?? null,
  };
}
