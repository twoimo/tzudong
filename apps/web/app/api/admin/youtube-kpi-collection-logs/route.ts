import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REPOSITORY = "twoimo/tzudong";
const DEFAULT_WORKFLOW_ID = "youtube-kpi-snapshot.yml";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_FETCH_TIMEOUT_MS = 5_000;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9_.-]+\.ya?ml$/;

type GitHubWorkflowRun = {
  id?: number;
  run_number?: number;
  display_title?: string;
  name?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string | null;
  html_url?: string;
  jobs_url?: string;
};

type GitHubWorkflowRunsResponse = {
  workflow_runs?: GitHubWorkflowRun[];
};

type GitHubWorkflowJob = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string;
};

type GitHubWorkflowJobsResponse = {
  jobs?: GitHubWorkflowJob[];
};

type ChannelSnapshotRow = {
  channel_id: string | null;
  channel_title: string | null;
  subscriber_count: number | string | null;
  view_count: number | string | null;
  video_count: number | string | null;
  hidden_subscriber_count: boolean | null;
  previous_bucket_started_at?: string | null;
  subscriber_delta?: number | string | null;
  view_delta?: number | string | null;
  video_delta?: number | string | null;
  bucket_started_at: string;
  fetched_at: string | null;
};

const collectionLogCache = {
  expiresAt: 0,
  payload: null as Awaited<ReturnType<typeof buildCollectionLogPayload>> | null,
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getGitHubRepository() {
  const repository = (
    process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY
  ).trim();
  return REPOSITORY_PATTERN.test(repository) ? repository : DEFAULT_REPOSITORY;
}

function getGitHubWorkflowId() {
  const workflowId = (
    process.env.YOUTUBE_KPI_SNAPSHOT_WORKFLOW_ID || DEFAULT_WORKFLOW_ID
  ).trim();
  return WORKFLOW_ID_PATTERN.test(workflowId)
    ? workflowId
    : DEFAULT_WORKFLOW_ID;
}

function getGitHubToken() {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_ACTIONS_TOKEN ||
    null
  );
}

function buildGitHubHeaders(): HeadersInit {
  const token = getGitHubToken();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function normalizeRun(run: GitHubWorkflowRun) {
  return {
    id: run.id ?? null,
    runNumber: run.run_number ?? null,
    title: run.display_title || run.name || "KPI snapshot collector",
    event: run.event ?? null,
    status: run.status ?? "unknown",
    conclusion: run.conclusion ?? null,
    createdAt: run.created_at ?? null,
    updatedAt: run.updated_at ?? null,
    startedAt: run.run_started_at ?? null,
    htmlUrl: run.html_url ?? null,
  };
}

function normalizeJob(job: GitHubWorkflowJob) {
  return {
    id: job.id ?? null,
    name: job.name || "collector job",
    status: job.status ?? "unknown",
    conclusion: job.conclusion ?? null,
    startedAt: job.started_at ?? null,
    completedAt: job.completed_at ?? null,
    htmlUrl: job.html_url ?? null,
  };
}

async function fetchGitHubJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await fetch(url, {
    headers: buildGitHubHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, data: (await response.json()) as T };
}

function buildGitHubWorkflowRunJobsUrl(repository: string, runId: number) {
  return `${GITHUB_API_BASE_URL}/repos/${repository}/actions/runs/${runId}/jobs?per_page=20`;
}

async function fetchGitHubWorkflowLogs() {
  const repository = getGitHubRepository();
  const workflowId = encodeURIComponent(getGitHubWorkflowId());
  const runsUrl = `${GITHUB_API_BASE_URL}/repos/${repository}/actions/workflows/${workflowId}/runs?per_page=8`;

  try {
    const runsResponse =
      await fetchGitHubJson<GitHubWorkflowRunsResponse>(runsUrl);

    if (!runsResponse.ok) {
      return {
        available: false,
        repository,
        workflowId: getGitHubWorkflowId(),
        runs: [],
        latestJobs: [],
        error: `github-runs-${runsResponse.status}`,
      };
    }

    const payload = runsResponse.data;
    const runs = (payload.workflow_runs ?? []).map(normalizeRun);
    const latestRun = payload.workflow_runs?.[0];
    let latestJobs: ReturnType<typeof normalizeJob>[] = [];

    if (
      typeof latestRun?.id === "number" &&
      Number.isSafeInteger(latestRun.id)
    ) {
      const jobsResponse = await fetchGitHubJson<GitHubWorkflowJobsResponse>(
        buildGitHubWorkflowRunJobsUrl(repository, latestRun.id),
      );

      if (jobsResponse.ok) {
        latestJobs = (jobsResponse.data.jobs ?? []).map(normalizeJob);
      }
    }

    return {
      available: true,
      repository,
      workflowId: getGitHubWorkflowId(),
      runs,
      latestJobs,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      repository,
      workflowId: getGitHubWorkflowId(),
      runs: [],
      latestJobs: [],
      error: error instanceof Error ? error.message : "github-runs-unavailable",
    };
  }
}

async function fetchLatestSnapshotStatus() {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("youtube_channel_kpi_snapshots")
      .select(
        "channel_id,channel_title,subscriber_count,view_count,video_count,hidden_subscriber_count,previous_bucket_started_at,subscriber_delta,view_delta,video_delta,bucket_started_at,fetched_at",
      )
      .order("bucket_started_at", { ascending: false })
      .limit(1)
      .maybeSingle<ChannelSnapshotRow>();

    if (error) {
      return { available: false, error: error.message };
    }

    if (!data) {
      return { available: false, error: "snapshot-empty" };
    }

    const { count, error: countError } = await supabase
      .from("youtube_video_kpi_snapshots")
      .select("video_id", { count: "exact", head: true })
      .eq("bucket_started_at", data.bucket_started_at);

    return {
      available: true,
      bucketStartedAt: data.bucket_started_at,
      fetchedAt: data.fetched_at ?? data.bucket_started_at,
      channelId: data.channel_id,
      channelTitle: data.channel_title,
      subscriberCount: data.hidden_subscriber_count
        ? null
        : toFiniteNumber(data.subscriber_count),
      viewCount: toFiniteNumber(data.view_count),
      videoCount: toFiniteNumber(data.video_count),
      previousBucketStartedAt: data.previous_bucket_started_at ?? null,
      subscriberDelta: data.hidden_subscriber_count
        ? null
        : toFiniteNumber(data.subscriber_delta),
      viewDelta: toFiniteNumber(data.view_delta),
      videoDelta: toFiniteNumber(data.video_delta),
      videoSnapshotCount: countError ? null : (count ?? 0),
      error: countError?.message ?? null,
    };
  } catch (error) {
    return {
      available: false,
      error:
        error instanceof Error ? error.message : "snapshot-status-unavailable",
    };
  }
}

async function buildCollectionLogPayload() {
  const [workflow, snapshot] = await Promise.all([
    fetchGitHubWorkflowLogs(),
    fetchLatestSnapshotStatus(),
  ]);

  return {
    asOf: new Date().toISOString(),
    workflow,
    snapshot,
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const now = Date.now();
  if (collectionLogCache.payload && collectionLogCache.expiresAt > now) {
    return NextResponse.json(collectionLogCache.payload, {
      headers: {
        "Cache-Control": "private, max-age=20, stale-while-revalidate=40",
      },
    });
  }

  const payload = await buildCollectionLogPayload();
  collectionLogCache.payload = payload;
  collectionLogCache.expiresAt = now + 20_000;

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, max-age=20, stale-while-revalidate=40",
    },
  });
}
