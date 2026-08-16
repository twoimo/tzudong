import {
  buildNaverDirectionsReadiness,
  buildProviderReadiness,
  THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
} from '@/lib/admin/provider-readiness';
import type {
  AdminGithubActionsStatus,
  AdminNightlyRegressionStatus,
  AdminNightlyWorkflowRole,
  AdminNightlyWorkflowStatus,
  AdminProviderReadiness,
  AdminSystemIntegrationStatus,
  AdminSystemFrameCaptionStatus,
  AdminSystemRunDailyStatus,
  AdminSupabaseCounterStatus,
  AdminSystemStatusChecklistItem,
  AdminSystemStatusKeyFlags,
  AdminSystemStatusResponse,
} from '@/types/admin-system-status';

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_GITHUB_WORKFLOW = 'daily-crawler.yml';
const LOCAL_NIGHTLY_WORKFLOW = 'nightly-local-regression.yml';
const HOSTED_NIGHTLY_WORKFLOW = 'nightly-regression.yml';
const NIGHTLY_HISTORY_LIMIT = 25;
const MAX_GITHUB_STATUS_RESPONSE_BYTES = 256 * 1024;

type CachedStatusEntry = {
  expiresAt: number;
  value: AdminSystemStatusResponse;
} | null;

let cachedStatus: CachedStatusEntry = null;

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (!hasNonEmptyValue(value)) return defaultValue;
  const normalized = value!.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return defaultValue;
}

function sanitizeTextForDisplay(raw: string | undefined, maxLength = 160): string | undefined {
  if (!hasNonEmptyValue(raw)) return undefined;
  return raw!.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

function pickFirstEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (hasNonEmptyValue(value)) {
      return value!.trim();
    }
  }
  return undefined;
}

function isStrictLocalRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === '1';
}

export function sanitizeEndpointForDisplay(raw: string | undefined): string | undefined {
  if (!hasNonEmptyValue(raw)) return undefined;

  try {
    const url = new URL(raw!.trim());
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, timeoutMs));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function probeReachability(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  acceptHttp4xxAsReachable = false,
): Promise<{ reachable: boolean; detail?: string }> {
  const timeout = withTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(endpoint, {
      ...init,
      signal: timeout.signal,
      cache: 'no-store',
    });

    if (response.ok) {
      return { reachable: true, detail: `HTTP ${response.status}` };
    }

    if (acceptHttp4xxAsReachable && response.status >= 400 && response.status < 500) {
      return { reachable: true, detail: `HTTP ${response.status}` };
    }

    return { reachable: false, detail: `HTTP ${response.status}` };
  } catch {
    return {
      reachable: false,
      detail: timeout.signal.aborted ? 'TIMEOUT' : 'REQUEST_FAILED',
    };
  } finally {
    timeout.clear();
  }
}

function resolveHealthEndpoint(baseUrl: string | undefined, path: string): string | undefined {
  if (!hasNonEmptyValue(baseUrl)) return undefined;
  try {
    const root = new URL(baseUrl!.trim());
    return new URL(path, root).toString();
  } catch {
    return undefined;
  }
}

function buildRunDailyStaleWarningSnippet(): string {
  return [
    '# run_daily 최신 로그 점검',
    'RUN_DAILY_LOG_DIR="${RUN_DAILY_LOG_DIR:-/path/to/backend/log/cron}"',
    'latest_log=$(ls -t "$RUN_DAILY_LOG_DIR"/daily_*.log 2>/dev/null | head -n 1)',
    '[ -n "$latest_log" ] || { echo "로그 파일을 찾을 수 없습니다."; exit 1; }',
    'stat -c "%y" "$latest_log" 2>/dev/null || stat -f "%Sm" "$latest_log"',
  ].join('\n');
}

function buildRunDailyManifestChecklistSnippet(): string {
  return [
    '# run_daily current-summary manifest 점검',
    'RUN_DAILY_MANIFEST_PATH="${RUN_DAILY_MANIFEST_PATH:-/path/to/backend/log/cron/current-summary.json}"',
    'test -s "$RUN_DAILY_MANIFEST_PATH" || { echo "current-summary manifest missing"; exit 1; }',
    'python3 -m json.tool "$RUN_DAILY_MANIFEST_PATH" >/dev/null',
  ].join('\n');
}

function buildRunDailyGdriveUploadSnippet(): string {
  return [
    '# run_daily GDrive upload 상태 확인',
    'RUN_DAILY_MANIFEST_PATH="${RUN_DAILY_MANIFEST_PATH:-/path/to/backend/log/cron/current-summary.json}"',
    'python3 - <<\'PY\'',
    'import json, os',
    'path = os.environ["RUN_DAILY_MANIFEST_PATH"]',
    'data = json.load(open(path, encoding="utf-8"))',
    'upload = data.get("gdriveUpload") or {}',
    'for key in ("status", "exitCode", "expectedCount", "residualCount", "pendingBacklogCount", "terminalIncomplete", "completionProof"):',
    '    print(f"{key}={upload.get(key)}")',
    'PY',
  ].join('\n');
}

function sanitizeRunDailyPath(rawPath: string | undefined): string | undefined {
  if (!hasNonEmptyValue(rawPath)) return undefined;
  const trimmed = rawPath!.trim();
  const withoutQuery = trimmed.split('?')[0]?.trim();
  const withoutHash = withoutQuery?.split('#')[0]?.trim();
  return withoutHash || undefined;
}

function buildFrameCaptionPathChecklistSnippet(): string {
  return [
    '# 피크 프레임 데이터 경로 확인',
    'INSIGHT_FRAME_CAPTION_BASE_PATH="/path/to/backend/restaurant-crawling/data/tzuyang/frame-caption"',
    'ls -ld "$INSIGHT_FRAME_CAPTION_BASE_PATH"',
    'ls -l "$INSIGHT_FRAME_CAPTION_BASE_PATH"',
  ].join('\n');
}

function buildFrameCaptionGdriveChecklistSnippet(): string {
  return [
    '# 피크 프레임 GDrive 증거 경로 확인',
    'INSIGHT_GDRIVE_FRAME_CAPTION_PATH="gs://your-bucket/peak-frame"',
    'gsutil ls "$INSIGHT_GDRIVE_FRAME_CAPTION_PATH"',
    'gsutil cors get "gs://your-bucket"',
  ].join('\n');
}

function buildRunDailyChecklistSnippet(): string {
  return [
    '# run_daily 스크립트 체크',
    'RUN_DAILY_SCRIPT_PATH="${RUN_DAILY_SCRIPT_PATH:-/path/to/backend/run_daily.sh}"',
    '[ -x "$RUN_DAILY_SCRIPT_PATH" ] || chmod +x "$RUN_DAILY_SCRIPT_PATH"',
    'ls -l "$RUN_DAILY_SCRIPT_PATH"',
    'crontab -l 2>/dev/null | grep -F "$RUN_DAILY_SCRIPT_PATH" || \\',
    '  (crontab -l 2>/dev/null; echo "0 4 * * * $RUN_DAILY_SCRIPT_PATH >> /path/to/backend/logs/run_daily.log 2>&1") | crontab -',
  ].join('\n');
}

const SUPABASE_ENV_CHECK_SNIPPET = [
  '# Supabase 운영 키 점검',
  'NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://<project>.supabase.co}"',
  'SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-<SERVICE_ROLE_KEY>}"',
  '[ -n "$NEXT_PUBLIC_SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || echo "Supabase key missing"',
].join('\n');

const RUN_DAILY_STEP08_CHECK_SNIPPET = [
  '# run_daily Step 08 원인 점검',
  'RUN_DAILY_MANIFEST_PATH="${RUN_DAILY_MANIFEST_PATH:-/path/to/backend/log/cron/current-summary.json}"',
  'python3 - <<\'PY\'',
  'import json, os',
  'data = json.load(open(os.environ["RUN_DAILY_MANIFEST_PATH"], encoding="utf-8"))',
  'for event in data.get("stepEvents") or []:',
  '    if event.get("name") == "Step 08 (Chunk Multimodal)":',
  '        print(event)',
  'print("failedRequiredSteps=", data.get("failedRequiredSteps"))',
  'print("downstreamSkips=", data.get("downstreamSkips"))',
  'PY',
  '(cd backend && npm ci)',
  'python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login  # login 만료일 때만',
].join('\n');

const RUN_DAILY_STEP11_CHECK_SNIPPET = [
  '# run_daily Step 11 timeout/skip 점검',
  'RUN_DAILY_MANIFEST_PATH="${RUN_DAILY_MANIFEST_PATH:-/path/to/backend/log/cron/current-summary.json}"',
  'python3 - <<\'PY\'',
  'import json, os',
  'data = json.load(open(os.environ["RUN_DAILY_MANIFEST_PATH"], encoding="utf-8"))',
  'for event in data.get("stepEvents") or []:',
  '    if "Step 11" in event.get("name", "") or event.get("upstreamStep") == "Step 11 (LAAJ Evaluation)":',
  '        print(event)',
  'PY',
].join('\n');

const ACTIONS_BUDGET_POSTURE_SNIPPET = [
  '# GitHub Actions 예산/재실행 posture 점검',
  'python3 backend/bin/check_actions_budget.py \\',
  '  --repository "${GITHUB_REPOSITORY:-twoimo/tzudong}" \\',
  '  --workflow daily-crawler.yml \\',
  '  --workflow gdrive-frame-backfill.yml \\',
  '  --output backend/log/cron/actions-budget-posture.json',
  'cat backend/log/cron/actions-budget-posture.json',
].join('\n');

const NIGHTLY_REGRESSION_STATUS_SNIPPET = [
  '# 나이틀리 회귀 실행 이력 점검 (read-only)',
  'REPOSITORY="${GITHUB_REPOSITORY:-twoimo/tzudong}"',
  'gh run list --repo "$REPOSITORY" --workflow nightly-local-regression.yml --limit 25 \\',
  '  --json databaseId,status,conclusion,event,createdAt,updatedAt,url',
  'gh run list --repo "$REPOSITORY" --workflow nightly-regression.yml --limit 25 \\',
  '  --json databaseId,status,conclusion,event,createdAt,updatedAt,url',
].join('\n');

const GEMINI_KEY_CHECK_SNIPPET = [
  '# Gemini 서버 키 점검 (택1)',
  'GEMINI_API_KEY="${GEMINI_API_KEY:-<GEMINI_KEY>}"',
  '# 또는 STORYBOARD_AGENT_GEMINI_API_KEY / GOOGLE_API_KEY',
  '[ -n "$GEMINI_API_KEY" ] || echo "Gemini key missing"',
].join('\n');

const OPENAI_KEY_CHECK_SNIPPET = [
  '# OpenAI 서버 키 점검 (택1)',
  'OPENAI_API_KEY="${OPENAI_API_KEY:-<OPENAI_KEY>}"',
  '# 또는 STORYBOARD_AGENT_OPENAI_API_KEY',
  '[ -n "$OPENAI_API_KEY" ] || echo "OpenAI key missing"',
].join('\n');

const ANTHROPIC_KEY_CHECK_SNIPPET = [
  '# Anthropic 서버 키 점검 (택1)',
  'ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-<ANTHROPIC_KEY>}"',
  '# 또는 STORYBOARD_AGENT_ANTHROPIC_API_KEY',
  '[ -n "$ANTHROPIC_API_KEY" ] || echo "Anthropic key missing"',
].join('\n');

const NANO_BANANA_KEY_CHECK_SNIPPET = [
  '# Nano Banana 2 키 점검 (택1)',
  'NANO_BANANA_2_API_KEY="${NANO_BANANA_2_API_KEY:-<NANO_BANANA_2_KEY>}"',
  '# 또는 NANO_BANANA_API_KEY / STORYBOARD_AGENT_NANO_BANANA_API_KEY / STORYBOARD_AGENT_IMAGE_API_KEY',
  '[ -n "$NANO_BANANA_2_API_KEY" ] || echo "Nano Banana key missing"',
].join('\n');

const STORYBOARD_HEALTH_CHECK_SNIPPET = [
  '# 스토리보드 에이전트 헬스체크',
  'STORYBOARD_AGENT_API_URL="${STORYBOARD_AGENT_API_URL:-https://your-storyboard-host/api}"',
  'curl -fsS "${STORYBOARD_AGENT_API_URL%/}/health"',
].join('\n');

const BGE_EMBEDDING_HEALTH_CHECK_SNIPPET = [
  '# BGE 임베딩 서버 헬스체크',
  'STORYBOARD_BGE_EMBEDDING_URL="${STORYBOARD_BGE_EMBEDDING_URL:-https://your-bge-host/v1/embeddings}"',
  'STORYBOARD_BGE_EMBEDDING_TOKEN="${STORYBOARD_BGE_EMBEDDING_TOKEN:-<BGE_TOKEN>}"',
  'curl -fsS -X POST "${STORYBOARD_BGE_EMBEDDING_URL%/}" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Authorization: Bearer ${STORYBOARD_BGE_EMBEDDING_TOKEN}" \\',
  "  -d '{\"inputs\":[\"health check\"]}'",
].join('\n');

export function resolveAdminSystemKeyFlags(
  env: NodeJS.ProcessEnv = process.env,
): AdminSystemStatusKeyFlags {
  return {
    supabaseUrl: hasNonEmptyValue(env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRoleKey: hasNonEmptyValue(env.SUPABASE_SERVICE_ROLE_KEY),
    geminiServerKey: Boolean(
      pickFirstEnvValue(env, [
        'GEMINI_API_KEY',
        'GEMINI_OCR_YEON',
        'STORYBOARD_AGENT_GEMINI_API_KEY',
        'GOOGLE_API_KEY',
        'NEXT_PUBLIC_GOOGLE_API_KEY',
      ]),
    ),
    openaiServerKey: Boolean(
      pickFirstEnvValue(env, [
        'OPENAI_API_KEY',
        'STORYBOARD_AGENT_OPENAI_API_KEY',
      ]),
    ),
    anthropicServerKey: Boolean(
      pickFirstEnvValue(env, [
        'ANTHROPIC_API_KEY',
        'STORYBOARD_AGENT_ANTHROPIC_API_KEY',
      ]),
    ),
    nanoBanana2Key: Boolean(
      pickFirstEnvValue(env, [
        'NANO_BANANA_2_API_KEY',
        'NANO_BANANA_API_KEY',
        'STORYBOARD_AGENT_NANO_BANANA_API_KEY',
        'STORYBOARD_AGENT_IMAGE_API_KEY',
      ]),
    ),
  };
}

function makeIntegrationStatus(
  asOf: string,
  enabled: boolean,
  configured: boolean,
  endpoint: string | undefined,
): AdminSystemIntegrationStatus {
  return {
    enabled,
    configured,
    reachable: false,
    ...(endpoint ? { endpoint } : {}),
    checkedAt: asOf,
  };
}

function makeDisabledGithubActionsStatus(asOf: string, enabled: boolean, detail?: string): AdminGithubActionsStatus {
  return {
    enabled,
    configured: false,
    reachable: false,
    ...(detail ? { detail } : {}),
    checkedAt: asOf,
  };
}

async function resolveGithubActionsStatus(
  env: NodeJS.ProcessEnv,
  asOf: string,
  timeoutMs: number,
): Promise<AdminGithubActionsStatus> {
  const enabled = toBooleanFlag(env.INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED, false);
  if (!enabled) return makeDisabledGithubActionsStatus(asOf, false, 'disabled');

  const repository = pickFirstEnvValue(env, ['INSIGHT_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY']);
  const token = pickFirstEnvValue(env, ['INSIGHT_GITHUB_TOKEN', 'GITHUB_TOKEN']);
  const allowPublicRead = isStrictLocalRuntime(env);
  const workflow = pickFirstEnvValue(env, ['INSIGHT_GITHUB_WORKFLOW']) || DEFAULT_GITHUB_WORKFLOW;
  const branch = pickFirstEnvValue(env, ['INSIGHT_GITHUB_BRANCH']);

  if (!repository || (!token && !allowPublicRead)) {
    return {
      enabled: true,
      configured: false,
      reachable: false,
      workflow,
      ...(branch ? { branch } : {}),
      detail: !repository ? 'repository_missing' : 'token_missing',
      checkedAt: asOf,
    };
  }

  const timeout = withTimeoutSignal(timeoutMs);
  const params = new URLSearchParams({ per_page: '1' });
  if (branch) params.set('branch', branch);
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository).replaceAll('%2F', '/')}/actions/workflows/${encodeURIComponent(workflow)}/runs?${params.toString()}`;

  try {
    const response = await fetchGithubReadOnly(endpoint, token, timeout.signal, allowPublicRead);

    if (!response.ok) {
      return {
        enabled: true,
        configured: true,
        reachable: false,
        workflow,
        ...(branch ? { branch } : {}),
        detail: `HTTP_${response.status}`,
        checkedAt: asOf,
      };
    }

    const payload = await readBoundedGithubJson(response) as { workflow_runs?: unknown };
    if (
      !payload
      || typeof payload !== 'object'
      || !Array.isArray(payload.workflow_runs)
      || payload.workflow_runs.length > 1
    ) {
      return {
        enabled: true,
        configured: true,
        reachable: false,
        workflow,
        ...(branch ? { branch } : {}),
        detail: 'response_shape_invalid',
        checkedAt: asOf,
      };
    }
    const latest = payload.workflow_runs.length === 1
      ? normalizeNightlyRun(payload.workflow_runs[0])
      : null;
    const rawLatest = payload.workflow_runs[0] as Record<string, unknown> | undefined;
    const latestRunAttempt = rawLatest?.run_attempt;
    if (
      (payload.workflow_runs.length === 1 && latest === null)
      || (
        latestRunAttempt !== undefined
        && (!Number.isSafeInteger(latestRunAttempt) || Number(latestRunAttempt) < 1)
      )
    ) {
      return {
        enabled: true,
        configured: true,
        reachable: false,
        workflow,
        ...(branch ? { branch } : {}),
        detail: 'response_shape_invalid',
        checkedAt: asOf,
      };
    }
    return {
      enabled: true,
      configured: true,
      reachable: true,
      workflow,
      ...(branch ? { branch } : {}),
      ...(latest ? { latestRunId: latest.id } : {}),
      ...(latest ? { latestRunStatus: latest.status } : {}),
      ...(latest ? { latestRunConclusion: latest.conclusion } : {}),
      ...(latest ? { latestRunEvent: latest.event } : {}),
      ...(typeof latestRunAttempt === 'number' ? { latestRunAttempt } : {}),
      ...(latest ? { latestRunUrl: latest.htmlUrl } : {}),
      ...(latest ? { latestRunCreatedAt: latest.createdAt } : {}),
      ...(latest?.updatedAt ? { latestRunUpdatedAt: latest.updatedAt } : {}),
      checkedAt: asOf,
    };
  } catch {
    return {
      enabled: true,
      configured: true,
      reachable: false,
      workflow,
      ...(branch ? { branch } : {}),
      detail: 'REQUEST_FAILED',
      checkedAt: asOf,
    };
  } finally {
    timeout.clear();
  }
}

const GITHUB_RUN_STATUSES = new Set([
  'completed',
  'in_progress',
  'pending',
  'queued',
  'requested',
  'waiting',
]);
const GITHUB_RUN_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'success',
  'timed_out',
]);
const GITHUB_RUN_EVENTS = new Set([
  'pull_request',
  'push',
  'repository_dispatch',
  'schedule',
  'workflow_dispatch',
  'workflow_run',
]);

async function fetchGithubReadOnly(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
  allowPublicRead: boolean,
): Promise<Response> {
  const request = (authorizationToken?: string) => fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      ...(authorizationToken ? { Authorization: `Bearer ${authorizationToken}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal,
    cache: 'no-store',
  });
  const response = await request(token);
  if (
    !allowPublicRead
    || !token
    || (response.status !== 401 && response.status !== 403)
  ) {
    return response;
  }
  await response.body?.cancel().catch(() => undefined);
  return request();
}

function normalizeGithubRunText(
  raw: unknown,
  allowed: ReadonlySet<string>,
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : undefined;
}

function normalizeGithubTimestamp(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 64) return undefined;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeGithubRunId(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : undefined;
}

function normalizeGithubRunUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 512) return undefined;
  const sanitized = sanitizeEndpointForDisplay(raw);
  if (!sanitized) return undefined;
  try {
    const url = new URL(sanitized);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined;
    if (!url.pathname.includes('/actions/runs/')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function readBoundedGithubJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_GITHUB_STATUS_RESPONSE_BYTES)
  ) {
    throw new Error('github_response_size');
  }
  if (!response.body) throw new Error('github_response_missing');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_GITHUB_STATUS_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('github_response_size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

type NormalizedNightlyRun = {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt?: string;
};

function normalizeNightlyRun(raw: unknown): NormalizedNightlyRun | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const run = raw as Record<string, unknown>;
  const id = normalizeGithubRunId(run.id);
  const status = normalizeGithubRunText(run.status, GITHUB_RUN_STATUSES);
  const conclusion = run.conclusion === null
    ? null
    : normalizeGithubRunText(run.conclusion, GITHUB_RUN_CONCLUSIONS);
  const event = normalizeGithubRunText(run.event, GITHUB_RUN_EVENTS);
  const htmlUrl = normalizeGithubRunUrl(run.html_url);
  const createdAt = normalizeGithubTimestamp(run.created_at);
  const updatedAt = run.updated_at === undefined
    ? undefined
    : normalizeGithubTimestamp(run.updated_at);
  if (
    !id
    || !status
    || conclusion === undefined
    || (status === 'completed' && conclusion === null)
    || !event
    || !htmlUrl
    || !createdAt
    || (run.updated_at !== undefined && !updatedAt)
  ) {
    return null;
  }
  return {
    id,
    status,
    conclusion,
    event,
    htmlUrl,
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function makeUnavailableNightlyWorkflowStatus(
  asOf: string,
  role: AdminNightlyWorkflowRole,
  workflow: string,
  branch: string | undefined,
  detail: string,
): AdminNightlyWorkflowStatus {
  return {
    role,
    workflow,
    ...(branch ? { branch } : {}),
    reachable: false,
    consecutiveFailures: 0,
    examinedRuns: 0,
    historyWindowTruncated: false,
    detail,
    checkedAt: asOf,
  };
}

async function resolveNightlyWorkflowStatus(
  repository: string,
  token: string | undefined,
  allowPublicRead: boolean,
  branch: string | undefined,
  role: AdminNightlyWorkflowRole,
  workflow: string,
  asOf: string,
  timeoutMs: number,
): Promise<AdminNightlyWorkflowStatus> {
  const timeout = withTimeoutSignal(timeoutMs);
  const params = new URLSearchParams({ per_page: String(NIGHTLY_HISTORY_LIMIT) });
  if (branch) params.set('branch', branch);
  const encodedRepository = encodeURIComponent(repository).replaceAll('%2F', '/');
  const endpoint = `https://api.github.com/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(workflow)}/runs?${params.toString()}`;

  try {
    const response = await fetchGithubReadOnly(
      endpoint,
      token,
      timeout.signal,
      allowPublicRead,
    );

    if (!response.ok) {
      return makeUnavailableNightlyWorkflowStatus(
        asOf,
        role,
        workflow,
        branch,
        `HTTP_${response.status}`,
      );
    }

    const payload = await readBoundedGithubJson(response) as {
      total_count?: unknown;
      workflow_runs?: unknown;
    };
    if (
      !payload
      || typeof payload !== 'object'
      || !Array.isArray(payload.workflow_runs)
      || payload.workflow_runs.length > NIGHTLY_HISTORY_LIMIT
      || typeof payload.total_count !== 'number'
      || !Number.isSafeInteger(payload.total_count)
      || payload.total_count < payload.workflow_runs.length
    ) {
      return makeUnavailableNightlyWorkflowStatus(
        asOf,
        role,
        workflow,
        branch,
        'response_shape_invalid',
      );
    }

    const runs = payload.workflow_runs.map(normalizeNightlyRun);
    if (runs.some((run) => run === null)) {
      return makeUnavailableNightlyWorkflowStatus(
        asOf,
        role,
        workflow,
        branch,
        'response_shape_invalid',
      );
    }
    const normalizedRuns = runs as NormalizedNightlyRun[];
    const latest = normalizedRuns[0];
    const lastSuccess = normalizedRuns.find((run) => run.conclusion === 'success');
    let consecutiveFailures = 0;
    for (const run of normalizedRuns) {
      if (run.status !== 'completed') continue;
      if (run.conclusion === 'success') break;
      consecutiveFailures += 1;
    }

    const totalCount = payload.total_count;

    return {
      role,
      workflow,
      ...(branch ? { branch } : {}),
      reachable: true,
      ...(latest ? { latestRunId: latest.id } : {}),
      ...(latest ? { latestRunStatus: latest.status } : {}),
      ...(latest ? { latestRunConclusion: latest.conclusion } : {}),
      ...(latest ? { latestRunEvent: latest.event } : {}),
      ...(latest ? { latestRunUrl: latest.htmlUrl } : {}),
      ...(latest ? { latestRunCreatedAt: latest.createdAt } : {}),
      ...(latest?.updatedAt ? { latestRunUpdatedAt: latest.updatedAt } : {}),
      ...(lastSuccess ? { lastSuccessfulRunId: lastSuccess.id } : {}),
      ...(lastSuccess ? { lastSuccessfulRunUrl: lastSuccess.htmlUrl } : {}),
      ...(lastSuccess ? { lastSuccessfulRunCreatedAt: lastSuccess.createdAt } : {}),
      consecutiveFailures,
      examinedRuns: normalizedRuns.length,
      historyWindowTruncated: totalCount > normalizedRuns.length,
      ...(normalizedRuns.length === 0 ? { detail: 'no_runs' } : {}),
      checkedAt: asOf,
    };
  } catch {
    return makeUnavailableNightlyWorkflowStatus(
      asOf,
      role,
      workflow,
      branch,
      timeout.signal.aborted ? 'TIMEOUT' : 'REQUEST_FAILED',
    );
  } finally {
    timeout.clear();
  }
}

async function resolveNightlyRegressionStatus(
  env: NodeJS.ProcessEnv,
  asOf: string,
  timeoutMs: number,
): Promise<AdminNightlyRegressionStatus> {
  const enabled = toBooleanFlag(
    env.INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED,
    toBooleanFlag(env.INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED, false),
  );
  const repository = pickFirstEnvValue(env, ['INSIGHT_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY']);
  const token = pickFirstEnvValue(env, ['INSIGHT_GITHUB_TOKEN', 'GITHUB_TOKEN']);
  const allowPublicRead = isStrictLocalRuntime(env);
  const branch = sanitizeTextForDisplay(
    pickFirstEnvValue(env, ['INSIGHT_GITHUB_BRANCH']),
    80,
  ) || 'main';
  const missingDetail = !enabled
    ? 'disabled'
    : !repository
      ? 'repository_missing'
      : 'token_missing';

  if (!enabled || !repository || (!token && !allowPublicRead)) {
    return {
      enabled,
      configured: false,
      reachable: false,
      repositoryConfigured: Boolean(repository),
      tokenConfigured: Boolean(token),
      localCanonical: makeUnavailableNightlyWorkflowStatus(
        asOf,
        'canonical-local',
        LOCAL_NIGHTLY_WORKFLOW,
        branch,
        missingDetail,
      ),
      hostedManualFallback: makeUnavailableNightlyWorkflowStatus(
        asOf,
        'hosted-manual-fallback',
        HOSTED_NIGHTLY_WORKFLOW,
        branch,
        missingDetail,
      ),
      detail: missingDetail,
      checkedAt: asOf,
    };
  }

  const [localCanonical, hostedManualFallback] = await Promise.all([
    resolveNightlyWorkflowStatus(
      repository,
      token,
      allowPublicRead,
      branch,
      'canonical-local',
      LOCAL_NIGHTLY_WORKFLOW,
      asOf,
      timeoutMs,
    ),
    resolveNightlyWorkflowStatus(
      repository,
      token,
      allowPublicRead,
      branch,
      'hosted-manual-fallback',
      HOSTED_NIGHTLY_WORKFLOW,
      asOf,
      timeoutMs,
    ),
  ]);
  const reachable = localCanonical.reachable && hostedManualFallback.reachable;

  return {
    enabled: true,
    configured: true,
    reachable,
    repositoryConfigured: true,
    tokenConfigured: Boolean(token),
    localCanonical,
    hostedManualFallback,
    ...(!reachable ? { detail: 'workflow_status_unreachable' } : {}),
    checkedAt: asOf,
  };
}

function makeDisabledSupabaseCounterStatus(asOf: string, enabled: boolean, detail?: string): AdminSupabaseCounterStatus {
  return {
    enabled,
    configured: false,
    reachable: false,
    ...(detail ? { detail } : {}),
    checkedAt: asOf,
  };
}

function parseContentRangeCount(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\/(\d+)$/);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

async function fetchSupabaseCount(
  endpoint: string,
  serviceRoleKey: string,
  timeoutMs: number,
): Promise<number | undefined> {
  const timeout = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
      signal: timeout.signal,
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    return parseContentRangeCount(response.headers.get('content-range'));
  } finally {
    timeout.clear();
  }
}

async function resolveSupabaseCounterStatus(
  env: NodeJS.ProcessEnv,
  asOf: string,
  timeoutMs: number,
): Promise<AdminSupabaseCounterStatus> {
  const enabled = toBooleanFlag(env.INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED, false);
  if (!enabled) return makeDisabledSupabaseCounterStatus(asOf, false, 'disabled');

  const supabaseUrl = pickFirstEnvValue(env, ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']);
  const serviceRoleKey = pickFirstEnvValue(env, ['SUPABASE_SERVICE_ROLE_KEY']);
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      enabled: true,
      configured: false,
      reachable: false,
      detail: !supabaseUrl ? 'url_missing' : 'service_role_key_missing',
      checkedAt: asOf,
    };
  }

  try {
    const base = supabaseUrl.replace(/\/+$/, '');
    const restaurantsEndpoint = `${base}/rest/v1/restaurants?select=id&limit=1`;
    const evaluatedEndpoint = `${base}/rest/v1/restaurants?select=id&evaluation_results=not.is.null&limit=1`;
    const [restaurantsTotal, evaluatedRestaurants] = await Promise.all([
      fetchSupabaseCount(restaurantsEndpoint, serviceRoleKey, timeoutMs),
      fetchSupabaseCount(evaluatedEndpoint, serviceRoleKey, timeoutMs),
    ]);

    return {
      enabled: true,
      configured: true,
      reachable: restaurantsTotal !== undefined && evaluatedRestaurants !== undefined,
      ...(restaurantsTotal !== undefined ? { restaurantsTotal } : {}),
      ...(evaluatedRestaurants !== undefined ? { evaluatedRestaurants } : {}),
      ...(restaurantsTotal === undefined || evaluatedRestaurants === undefined ? { detail: 'count_incomplete' } : {}),
      checkedAt: asOf,
    };
  } catch {
    return {
      enabled: true,
      configured: true,
      reachable: false,
      detail: 'count_request_failed',
      checkedAt: asOf,
    };
  }
}

type ThumbnailDurableReleaseReadinessPayload = {
  status: 'ready' | 'empty' | 'unavailable';
  release: unknown;
  diagnostics: {
    durableRegistryAvailable: boolean;
    releaseKey: string;
    reason?: string;
    warnings: string[];
  };
};

export function mapThumbnailDurableReleasePayloadToReadiness(
  payload: ThumbnailDurableReleaseReadinessPayload,
  checkedAt: string,
): AdminProviderReadiness {
  const reason = typeof payload.diagnostics.reason === 'string' ? payload.diagnostics.reason : undefined;

  if (payload.status === 'ready' && reason === 'local_release_candidate_fallback') {
    return buildProviderReadiness({
      provider: THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
      status: 'degraded',
      reasonCode: 'thumbnail-durable-release-local-fallback',
      checkedAt,
      remediation: 'Publish a Supabase-backed durable thumbnail release before relying on the local fallback.',
      diagnostics: {
        durableRegistryAvailable: payload.diagnostics.durableRegistryAvailable,
        releaseKey: payload.diagnostics.releaseKey,
        warningCount: payload.diagnostics.warnings.length,
      },
    });
  }

  if (payload.status === 'ready') {
    return buildProviderReadiness({
      provider: THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
      status: 'ready',
      reasonCode: 'thumbnail-durable-release-ready',
      checkedAt,
      remediation: 'Durable thumbnail release readback is available.',
      diagnostics: {
        durableRegistryAvailable: payload.diagnostics.durableRegistryAvailable,
        releaseKey: payload.diagnostics.releaseKey,
        hasRelease: Boolean(payload.release),
      },
    });
  }

  if (payload.status === 'empty') {
    return buildProviderReadiness({
      provider: THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
      status: 'unavailable',
      reasonCode: 'thumbnail-durable-release-empty',
      checkedAt,
      remediation: 'Publish the current thumbnail release to the durable registry.',
      diagnostics: {
        durableRegistryAvailable: payload.diagnostics.durableRegistryAvailable,
        releaseKey: payload.diagnostics.releaseKey,
        hasRelease: false,
      },
    });
  }

  return buildProviderReadiness({
    provider: THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
    status: 'unavailable',
    reasonCode: reason === 'missing_release_table'
      ? 'thumbnail-durable-release-table-missing'
      : reason === 'missing_supabase_env'
        ? 'thumbnail-durable-release-env-missing'
        : 'thumbnail-durable-release-unavailable',
    checkedAt,
    remediation: reason === 'missing_supabase_env'
      ? 'Configure Supabase URL and service-role key for durable release readback.'
      : reason === 'missing_release_table'
        ? 'Apply the thumbnail durable release table migration.'
        : 'Restore durable thumbnail release readback.',
    diagnostics: {
      durableRegistryAvailable: payload.diagnostics.durableRegistryAvailable,
      releaseKey: payload.diagnostics.releaseKey,
      warningCount: payload.diagnostics.warnings.length,
    },
  });
}

async function resolveThumbnailDurableReleaseReadiness(
  env: NodeJS.ProcessEnv,
  checkedAt: string,
): Promise<AdminProviderReadiness> {
  try {
    const { readCurrentThumbnailDurableRelease } = await import('@/lib/admin/youtube-thumbnail-generator/release-registry');
    const payload = await readCurrentThumbnailDurableRelease(env);
    return mapThumbnailDurableReleasePayloadToReadiness(payload, checkedAt);
  } catch {
    return buildProviderReadiness({
      provider: THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID,
      status: 'unavailable',
      reasonCode: 'thumbnail-durable-release-error',
      checkedAt,
      remediation: 'Inspect server logs and restore durable thumbnail release readback.',
      diagnostics: {
        durableRegistryAvailable: false,
      },
    });
  }
}

export function buildAdminOpsChecklist(
  status: Pick<
    AdminSystemStatusResponse,
    | 'keys'
    | 'storyboardAgent'
    | 'bgeEmbedding'
    | 'frameCaption'
    | 'providerReadiness'
    | 'githubActions'
    | 'nightlyRegression'
  >,
  runDaily?: AdminSystemRunDailyStatus,
): AdminSystemStatusChecklistItem[] {
  const checklist: AdminSystemStatusChecklistItem[] = [];
  const hasRunDailyScript = Boolean(runDaily?.scriptPath);
  const hasRunDailyScriptIssue = !hasRunDailyScript;
  const hasRunDailyExecutableIssue = Boolean(runDaily?.scriptPath) && !(runDaily?.executable ?? false);
  const hasRunDailyStaleIssue = Boolean(runDaily && runDaily.stale);
  const hasRunDailyFailureIssue = Boolean(runDaily?.failedRequiredSteps && runDaily.failedRequiredSteps.length > 0);
  const hasRunDailyManifestIssue = Boolean(
    runDaily?.manifestStatus === 'missing'
    || runDaily?.manifestStatus === 'unreadable',
  );
  const gdriveUploadStatus = runDaily?.gdriveUpload?.status;
  const hasRunDailyGdriveUploadIssue = Boolean(
    runDaily?.gdriveUpload?.terminalIncomplete
    || gdriveUploadStatus === 'partial'
    || gdriveUploadStatus === 'backfill_required'
    || gdriveUploadStatus === 'failed',
  );

  if (!status.keys.supabaseUrl || !status.keys.supabaseServiceRoleKey) {
    checklist.push({
      id: 'supabase-keys',
      title: 'Supabase 키 미설정',
      severity: 'critical',
      category: 'environment',
      action: 'Supabase 연결 키(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)를 설정하세요.',
      command: SUPABASE_ENV_CHECK_SNIPPET,
      commandSnippet: SUPABASE_ENV_CHECK_SNIPPET,
      source: 'run_daily',
    });
  }

  if (hasRunDailyScriptIssue) {
    checklist.push({
      id: 'run-daily-script-missing',
      title: '수집 스크립트 미감지',
      severity: 'high',
      category: 'environment',
      action:
        'run_daily 자동 수집 파이프라인이 감지되지 않았습니다. 운영 서버에서 `backend/run_daily.sh`(또는 RUN_DAILY_SCRIPT_PATH)를 배치하고, `chmod +x` 후 crontab(`0 4 * * * /path/to/backend/run_daily.sh >> ...`)에 등록해 실행되게 설정하세요.',
      command: buildRunDailyChecklistSnippet(),
      commandSnippet: buildRunDailyChecklistSnippet(),
      source: 'run_daily',
    });
  }

  if (hasRunDailyExecutableIssue) {
    checklist.push({
      id: 'run-daily-script-not-executable',
      title: 'run_daily 실행 권한 미설정',
      severity: 'high',
      category: 'environment',
      action:
        'run_daily 스크립트가 실행 권한을 갖고 있지 않습니다. 운영 서버에서 `chmod +x`로 실행 권한을 부여해 주세요.',
      command: buildRunDailyChecklistSnippet(),
      commandSnippet: buildRunDailyChecklistSnippet(),
      source: 'run_daily',
    });
  }
  if (hasRunDailyManifestIssue) {
    const unreadable = runDaily?.manifestStatus === 'unreadable';
    checklist.push({
      id: unreadable ? 'run-daily-manifest-unreadable' : 'run-daily-manifest-missing',
      title: unreadable ? 'run_daily current-summary 읽기 실패' : 'run_daily current-summary 미감지',
      severity: unreadable ? 'high' : 'medium',
      category: 'environment',
      action: unreadable
        ? 'run_daily current-summary manifest가 있지만 파싱하지 못했습니다. JSON 형식과 마지막 실행 쓰기 완료 여부를 확인하세요.'
        : 'run_daily current-summary manifest가 없어 운영 상태를 UNKNOWN으로 표시합니다. 다음 run_daily 실행이 manifest를 쓰는지와 RUN_DAILY_MANIFEST_PATH를 확인하세요.',
      command: buildRunDailyManifestChecklistSnippet(),
      commandSnippet: buildRunDailyManifestChecklistSnippet(),
      source: 'run_daily',
    });
  }

  if (hasRunDailyStaleIssue) {
    checklist.push({
      id: 'run-daily-log-stale',
      title: 'run_daily 최신 로그 점검 실패',
      severity: 'medium',
      category: 'environment',
      action:
        'run_daily 최신 로그가 감지되지 않았거나 오래되어 보조 확인이 필요합니다. crontab 등록, 실행 로그 경로, 실행시간 스케줄을 점검해 주세요.',
      command: buildRunDailyStaleWarningSnippet(),
      commandSnippet: buildRunDailyStaleWarningSnippet(),
      source: 'run_daily',
    });
  }

  if (hasRunDailyFailureIssue) {
    checklist.push({
      id: 'run-daily-required-failed',
      title: 'run_daily 필수 단계 실패',
      severity: 'critical',
      category: 'environment',
      action:
        `최근 run_daily 실행에서 필수 단계 실패가 감지되었습니다: ${runDaily?.failedRequiredSteps?.slice(0, 3).join(' / ')}`,
      command: buildRunDailyStaleWarningSnippet(),
      commandSnippet: buildRunDailyStaleWarningSnippet(),
      source: 'run_daily',
    });
  }

  if (hasRunDailyGdriveUploadIssue) {
    const upload = runDaily?.gdriveUpload;
    const uploadFacts = [
      upload?.status ? `status=${upload.status}` : undefined,
      upload?.residualCount !== undefined ? `residual=${upload.residualCount}` : undefined,
      upload?.pendingBacklogCount !== undefined ? `pending=${upload.pendingBacklogCount}` : undefined,
      upload?.completionProof ? `proof=${upload.completionProof}` : undefined,
    ].filter(Boolean).join(', ');
    checklist.push({
      id: 'run-daily-gdrive-upload-incomplete',
      title: 'run_daily GDrive 업로드 후속 조치 필요',
      severity: upload?.status === 'failed' ? 'critical' : 'high',
      category: 'environment',
      action: upload?.operatorMessage?.action
        ?? `최근 run_daily GDrive upload 상태가 terminal success가 아닙니다${uploadFacts ? ` (${uploadFacts})` : ''}. backfill 또는 remote proof를 확인하세요.`,
      command: buildRunDailyGdriveUploadSnippet(),
      commandSnippet: buildRunDailyGdriveUploadSnippet(),
      source: 'run_daily',
    });
  }


  const step08Event = runDaily?.stepEvents?.find((event) => event.name === 'Step 08 (Chunk Multimodal)');
  const step08Evidence = [
    step08Event?.reason,
    ...(runDaily?.failedRequiredSteps ?? []),
    ...(runDaily?.downstreamSkips ?? []),
  ].join(' ');
  if (step08Event?.status === 'failed' || /Step 08|quota|로그인|Gemini runtime|Node prerequisite/.test(step08Evidence)) {
    const reason = step08Evidence.includes('quota') || step08Evidence.includes('quota 초과')
      ? 'Gemini quota 초과가 의심됩니다. pending Step08 work 여부와 API quota 상태를 먼저 확인하세요.'
      : step08Evidence.includes('로그인') || step08Evidence.includes('login')
        ? 'Gemini Web fallback 로그인 세션 만료가 의심됩니다. 수동 로그인 후 재시도하세요.'
        : step08Evidence.includes('Node prerequisite') || step08Evidence.includes('Node 패키지')
          ? 'Step 08 Node 패키지 prerequisite을 복구하세요.'
          : 'Step 08 실패 원인을 manifest stepEvents와 로그에서 확인하세요.';
    checklist.push({
      id: 'run-daily-step08-attention',
      title: 'run_daily Step 08 후속 점검 필요',
      severity: step08Event?.status === 'failed' ? 'critical' : 'high',
      category: 'environment',
      action: reason,
      command: RUN_DAILY_STEP08_CHECK_SNIPPET,
      commandSnippet: RUN_DAILY_STEP08_CHECK_SNIPPET,
      source: 'run_daily',
    });
  }

  const step11Evidence = [
    ...(runDaily?.failedRequiredSteps ?? []),
    ...(runDaily?.optionalSkips ?? []),
    ...(runDaily?.downstreamSkips ?? []),
    ...(runDaily?.stepEvents?.map((event) => `${event.name} ${event.status} ${event.reason ?? ''}`) ?? []),
  ].join(' ');
  if (/Step 11|LAAJ/.test(step11Evidence) && /timeout|타임아웃|timeout_incomplete/.test(step11Evidence)) {
    checklist.push({
      id: 'run-daily-step11-timeout',
      title: 'run_daily Step 11 timeout 후속 점검 필요',
      severity: 'high',
      category: 'environment',
      action: 'Step 11 LAAJ 진입 전 timeout/skip이 감지되었습니다. 다음 실행에서 이어지는지와 Step 12~13 downstream skip 여부를 확인하세요.',
      command: RUN_DAILY_STEP11_CHECK_SNIPPET,
      commandSnippet: RUN_DAILY_STEP11_CHECK_SNIPPET,
      source: 'run_daily',
    });
  }

  if (status.storyboardAgent.enabled && !status.storyboardAgent.configured) {
    checklist.push({
      id: 'storyboard-url-missing',
      title: '스토리보드 에이전트 미설정',
      severity: 'high',
      category: 'integration',
      action: '스토리보드 에이전트 URL(STORYBOARD_AGENT_API_URL)을 설정하세요.',
      command: STORYBOARD_HEALTH_CHECK_SNIPPET,
      commandSnippet: STORYBOARD_HEALTH_CHECK_SNIPPET,
      source: 'storyboard-agent',
    });
  } else if (status.storyboardAgent.enabled && status.storyboardAgent.configured && !status.storyboardAgent.reachable) {
    checklist.push({
      id: 'storyboard-health-failed',
      title: '스토리보드 에이전트 미연결',
      severity: 'high',
      category: 'integration',
      action: '스토리보드 에이전트 /health 응답을 확인하세요.',
      command: STORYBOARD_HEALTH_CHECK_SNIPPET,
      commandSnippet: STORYBOARD_HEALTH_CHECK_SNIPPET,
      source: 'storyboard-agent',
    });
  }

  if (status.bgeEmbedding.enabled && !status.bgeEmbedding.configured) {
    checklist.push({
      id: 'bge-url-missing',
      title: 'BGE 임베딩 미설정',
      severity: 'high',
      category: 'integration',
      action: 'BGE 임베딩 URL(STORYBOARD_BGE_EMBEDDING_URL)을 설정하세요.',
      command: BGE_EMBEDDING_HEALTH_CHECK_SNIPPET,
      commandSnippet: BGE_EMBEDDING_HEALTH_CHECK_SNIPPET,
      source: 'bge-embedding',
    });
  } else if (status.bgeEmbedding.enabled && status.bgeEmbedding.configured && !status.bgeEmbedding.reachable) {
    checklist.push({
      id: 'bge-health-failed',
      title: 'BGE 임베딩 미연결',
      severity: 'high',
      category: 'integration',
      action: 'BGE 임베딩 서버를 실행하고 네트워크 접근을 확인하세요.',
      command: BGE_EMBEDDING_HEALTH_CHECK_SNIPPET,
      commandSnippet: BGE_EMBEDDING_HEALTH_CHECK_SNIPPET,
      source: 'bge-embedding',
    });
  }

  const githubActions = status.githubActions;
  if (
    githubActions?.enabled
    && githubActions.configured
    && (
      githubActions.latestRunEvent === 'workflow_dispatch'
      || (githubActions.latestRunAttempt ?? 1) > 1
    )
  ) {
    const runContext = [
      githubActions.latestRunEvent ? `event=${githubActions.latestRunEvent}` : undefined,
      githubActions.latestRunAttempt !== undefined ? `attempt=${githubActions.latestRunAttempt}` : undefined,
    ].filter(Boolean).join(', ');
    checklist.push({
      id: 'github-actions-budget-posture',
      title: 'GitHub Actions 수동 실행/재실행 예산 확인',
      severity: 'medium',
      category: 'environment',
      action: `최근 Actions 실행이 수동 실행 또는 재실행입니다${runContext ? ` (${runContext})` : ''}. 월간 private-equivalent minutes와 backfill burst를 확인하세요.`,
      command: ACTIONS_BUDGET_POSTURE_SNIPPET,
      commandSnippet: ACTIONS_BUDGET_POSTURE_SNIPPET,
      source: 'run_daily',
    });
  }

  const nightlyRegression = status.nightlyRegression;
  const localNightly = nightlyRegression?.localCanonical;
  const hostedFallback = nightlyRegression?.hostedManualFallback;
  if (nightlyRegression && !nightlyRegression.enabled) {
    checklist.push({
      id: 'nightly-regression-status-disabled',
      title: '나이틀리 회귀 운영 상태 조회 비활성화',
      severity: 'high',
      category: 'integration',
      action: 'INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED를 활성화하고 read-only GitHub 토큰과 저장소를 설정하세요.',
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  } else if (nightlyRegression && !nightlyRegression.configured) {
    checklist.push({
      id: 'nightly-regression-status-unconfigured',
      title: '나이틀리 회귀 운영 상태 조회 미설정',
      severity: 'high',
      category: 'integration',
      action: '나이틀리 상태 조회용 저장소와 read-only GitHub 토큰 설정을 확인하세요.',
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  } else if (localNightly && !localNightly.reachable) {
    checklist.push({
      id: 'nightly-local-status-unreachable',
      title: '로컬 나이틀리 실행 이력 조회 실패',
      severity: 'critical',
      category: 'integration',
      action: 'canonical local nightly workflow의 최근 실행 이력을 읽지 못했습니다. 워크플로 존재 여부와 read-only 토큰 권한을 확인하세요.',
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  } else if (localNightly && !localNightly.latestRunId) {
    checklist.push({
      id: 'nightly-local-run-missing',
      title: '로컬 나이틀리 실행 증거 없음',
      severity: 'critical',
      category: 'integration',
      action: 'canonical local nightly workflow의 실행 증거가 없습니다. 스케줄 트리거와 최초 실행 완료 여부를 확인하세요.',
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  } else if (
    localNightly
    && (
      localNightly.consecutiveFailures > 0
      || (
        localNightly.latestRunStatus === 'completed'
        && localNightly.latestRunConclusion !== 'success'
      )
    )
  ) {
    checklist.push({
      id: 'nightly-local-regression-failing',
      title: '로컬 나이틀리 회귀 실패',
      severity: 'critical',
      category: 'integration',
      action: `canonical local nightly가 연속 ${localNightly.consecutiveFailures}회 실패 상태입니다. 최신 실행 결론과 실패 아티팩트를 확인하세요.`,
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  }

  if (
    nightlyRegression?.enabled
    && nightlyRegression.configured
    && hostedFallback
    && !hostedFallback.reachable
  ) {
    checklist.push({
      id: 'nightly-hosted-fallback-unreachable',
      title: '호스티드 수동 나이틀리 조회 실패',
      severity: 'medium',
      category: 'integration',
      action: 'hosted manual fallback workflow의 실행 이력을 읽지 못했습니다. 수동 fallback 경로와 토큰 권한을 확인하세요.',
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  } else if (
    nightlyRegression?.enabled
    && nightlyRegression.configured
    && hostedFallback?.latestRunStatus === 'completed'
    && hostedFallback.latestRunConclusion !== 'success'
  ) {
    checklist.push({
      id: 'nightly-hosted-fallback-failing',
      title: '호스티드 수동 나이틀리 최신 실행 실패',
      severity: 'medium',
      category: 'integration',
      action: 'hosted manual fallback의 최신 실행이 성공하지 않았습니다. fallback이 필요해지기 전에 복구 여부를 확인하세요.',
      command: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      commandSnippet: NIGHTLY_REGRESSION_STATUS_SNIPPET,
      source: 'nightly-regression',
    });
  }

  if (!status.keys.nanoBanana2Key) {
    checklist.push({
      id: 'provider-key-nano-banana-2',
      title: 'Nano Banana 2 키 미설정',
      severity: 'medium',
      category: 'provider-key',
      action: 'Nano Banana 2 이미지 생성 키를 준비하세요 (NANO_BANANA_2_API_KEY).',
      command: NANO_BANANA_KEY_CHECK_SNIPPET,
      commandSnippet: NANO_BANANA_KEY_CHECK_SNIPPET,
      source: 'provider-key',
    });
  }

  if (!status.keys.geminiServerKey) {
    checklist.push({
      id: 'provider-key-gemini',
      title: 'Gemini 서버 키 미설정',
      severity: 'medium',
      category: 'provider-key',
      action:
        'Gemini 서버 키가 없습니다. `GEMINI_API_KEY` 또는 `STORYBOARD_AGENT_GEMINI_API_KEY`(또는 `GOOGLE_API_KEY`)를 설정하거나, 설정 패널에서 브라우저 키로 추가하세요.',
      command: GEMINI_KEY_CHECK_SNIPPET,
      commandSnippet: GEMINI_KEY_CHECK_SNIPPET,
      source: 'provider-key',
    });
  }

  if (!status.keys.openaiServerKey) {
    checklist.push({
      id: 'provider-key-openai',
      title: 'OpenAI 서버 키 미설정',
      severity: 'medium',
      category: 'provider-key',
      action:
        'OpenAI 서버 키가 없습니다. `OPENAI_API_KEY` 또는 `STORYBOARD_AGENT_OPENAI_API_KEY`를 설정하거나, 설정 패널에서 브라우저 키를 추가하세요.',
      command: OPENAI_KEY_CHECK_SNIPPET,
      commandSnippet: OPENAI_KEY_CHECK_SNIPPET,
      source: 'provider-key',
    });
  }

  if (!status.keys.anthropicServerKey) {
    checklist.push({
      id: 'provider-key-anthropic',
      title: 'Anthropic 서버 키 미설정',
      severity: 'medium',
      category: 'provider-key',
      action:
        'Anthropic 서버 키가 없습니다. `ANTHROPIC_API_KEY` 또는 `STORYBOARD_AGENT_ANTHROPIC_API_KEY`를 설정하거나, 설정 패널에서 브라우저 키를 추가하세요.',
      command: ANTHROPIC_KEY_CHECK_SNIPPET,
      commandSnippet: ANTHROPIC_KEY_CHECK_SNIPPET,
      source: 'provider-key',
    });
  }

  if (!status.frameCaption.localPathAvailable) {
    const localPathAction = status.frameCaption.localPathConfigured
      ? '피크 프레임 데이터 경로(INSIGHT_FRAME_CAPTION_BASE_PATH)가 감지되지 않아 읽기 실패했습니다. 운영 환경 변수 경로를 다시 확인하세요.'
      : '피크 프레임 데이터 경로를 찾지 못했습니다. 로컬 프레임 캡션 경로(INSIGHT_FRAME_CAPTION_BASE_PATH) 또는 상대 경로를 확인하세요.';
    checklist.push({
      id: 'frame-caption-path-missing',
      title: '피크 프레임 경로 미감지',
      severity: 'high',
      category: 'environment',
      action: localPathAction,
      command: buildFrameCaptionPathChecklistSnippet(),
      commandSnippet: buildFrameCaptionPathChecklistSnippet(),
      source: 'frame-caption-storage',
    });
  }

  if (!status.frameCaption.gdrivePathConfigured && !status.frameCaption.localPathAvailable) {
    checklist.push({
      id: 'frame-caption-gdrive-path-missing',
      title: '피크 프레임 GDrive 경로 미설정',
      severity: 'medium',
      category: 'environment',
      action: '로컬 피크 프레임 데이터가 없는 경우, INSIGHT_GDRIVE_FRAME_CAPTION_PATH 또는 GDRIVE_REMOTE_PATH 설정으로 증거 링크를 보완하세요.',
      command: buildFrameCaptionGdriveChecklistSnippet(),
      commandSnippet: buildFrameCaptionGdriveChecklistSnippet(),
      source: 'frame-caption-storage',
    });
  }

  const naverReadiness = status.providerReadiness['naver-directions'];
  if (naverReadiness.status !== 'ready') {
    checklist.push({
      id: 'provider-readiness-naver-directions',
      title: 'Naver Directions 준비 상태 확인 필요',
      severity: 'high',
      category: 'provider-readiness',
      action: naverReadiness.remediation,
      source: 'provider-readiness',
    });
  }

  const thumbnailReadiness = status.providerReadiness['youtube-thumbnail-durable-release'];
  if (thumbnailReadiness.status !== 'ready') {
    checklist.push({
      id: 'provider-readiness-thumbnail-durable-release',
      title: '썸네일 durable release 준비 상태 확인 필요',
      severity: thumbnailReadiness.status === 'degraded' ? 'medium' : 'high',
      category: 'provider-readiness',
      action: thumbnailReadiness.remediation,
      source: 'provider-readiness',
    });
  }
  return checklist;
}


export async function getAdminSystemStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminSystemStatusResponse> {
  env = { ...env };
  const isTestRuntime = env.NODE_ENV === 'test' || env.BUN_ENV === 'test';
  const cacheTtlRaw = Number(env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS || String(DEFAULT_CACHE_TTL_MS));
  const resolvedCacheTtlMs = Number.isFinite(cacheTtlRaw) && cacheTtlRaw >= 0 ? cacheTtlRaw : DEFAULT_CACHE_TTL_MS;
  const cacheTtlMs = isTestRuntime ? 0 : resolvedCacheTtlMs;
  const now = Date.now();

  if (cacheTtlMs > 0 && cachedStatus && cachedStatus.expiresAt > now) {
    return cachedStatus.value;
  }

  const asOf = new Date(now).toISOString();
  const keys = resolveAdminSystemKeyFlags(env);
  const runtime = await import('@/lib/admin/system-status/runtime');

  const storyboardEnabled = toBooleanFlag(env.STORYBOARD_AGENT_ENABLED, true);
  const storyboardEndpoint = sanitizeEndpointForDisplay(env.STORYBOARD_AGENT_API_URL);
  const storyboardHealthEndpoint = resolveHealthEndpoint(env.STORYBOARD_AGENT_API_URL, '/health');
  const storyboardAgent = makeIntegrationStatus(
    asOf,
    storyboardEnabled,
    Boolean(storyboardEndpoint && storyboardHealthEndpoint),
    storyboardEndpoint,
  );

  const bgeEnabled = toBooleanFlag(env.STORYBOARD_BGE_ENABLED, false);
  const bgeEndpoint = sanitizeEndpointForDisplay(env.STORYBOARD_BGE_EMBEDDING_URL);
  const bgeEmbedding = makeIntegrationStatus(asOf, bgeEnabled, Boolean(bgeEndpoint), bgeEndpoint);

  const frameCaptionSource = runtime.resolveFrameCaptionDataSource(env);
  const frameCaptionRemotePath = runtime.resolveFrameCaptionGdrivePath(env);
  const frameCaption = {
    configured: frameCaptionSource.configured || Boolean(frameCaptionRemotePath),
    localPathConfigured: frameCaptionSource.configured,
    localPathAvailable: frameCaptionSource.available,
    gdrivePathConfigured: Boolean(frameCaptionRemotePath),
    reachable: frameCaptionSource.available || Boolean(frameCaptionRemotePath),
    ...(frameCaptionSource.path ? { localPath: frameCaptionSource.path } : {}),
    ...(frameCaptionRemotePath ? { gdrivePath: frameCaptionRemotePath } : {}),
    ...(frameCaptionSource.configured || frameCaptionSource.available || frameCaptionRemotePath ? {} : { detail: '피크 프레임 데이터 경로가 감지되지 않았습니다.' }),
    checkedAt: asOf,
  } satisfies AdminSystemFrameCaptionStatus;

  const timeoutRaw = Number(env.INSIGHT_SYSTEM_STATUS_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS));
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;

  if (storyboardAgent.enabled && storyboardAgent.configured && storyboardHealthEndpoint) {
    const result = await probeReachability(storyboardHealthEndpoint, { method: 'GET' }, timeoutMs, false);
    storyboardAgent.reachable = result.reachable;
    if (result.detail) storyboardAgent.detail = result.detail;
  } else if (storyboardAgent.enabled && !storyboardAgent.configured) {
    storyboardAgent.detail = 'not_configured';
  }

  if (bgeEmbedding.enabled && bgeEmbedding.configured && bgeEndpoint) {
    const token = pickFirstEnvValue(env, ['STORYBOARD_BGE_EMBEDDING_TOKEN']);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const result = await probeReachability(
      bgeEndpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs: ['health check'] }),
      },
      timeoutMs,
      true,
    );

    bgeEmbedding.reachable = result.reachable;
    if (result.detail) bgeEmbedding.detail = result.detail;
  } else if (bgeEmbedding.enabled && !bgeEmbedding.configured) {
    bgeEmbedding.detail = 'not_configured';
  }

  const runDailyScriptPath = runtime.resolveRunDailyScriptPath(env);
  const runDailyLogInfo = runtime.resolveRunDailyLogInfo(env, runDailyScriptPath);
  const runDailyManifestInfo = runtime.resolveRunDailyManifestStatus(env, runDailyScriptPath);
  const hasReadableRunDailyManifest = runDailyManifestInfo.manifestStatus === 'available';
  const runDailyLogTailInfo = hasReadableRunDailyManifest
    ? { failedRequiredSteps: [], optionalSkips: [], downstreamSkips: [] }
    : runtime.parseRunDailyLogTailStatus(runDailyLogInfo.logPath);
  const runDailyFailureInfo = hasReadableRunDailyManifest
    ? runDailyManifestInfo
    : {
      ...runDailyLogTailInfo,
      finalStatus: runDailyManifestInfo.finalStatus ?? runDailyLogTailInfo.finalStatus,
      detail: runDailyLogTailInfo.detail ?? runDailyManifestInfo.detail,
    };
  const [
    githubActions,
    nightlyRegression,
    supabaseCounters,
    thumbnailDurableReleaseReadiness,
  ] = await Promise.all([
    resolveGithubActionsStatus(env, asOf, timeoutMs),
    resolveNightlyRegressionStatus(env, asOf, timeoutMs),
    resolveSupabaseCounterStatus(env, asOf, timeoutMs),
    resolveThumbnailDurableReleaseReadiness(env, asOf),
  ]);
  const naverDirectionsReadiness = buildNaverDirectionsReadiness(env, asOf);

  const runDailyDetail = sanitizeTextForDisplay(
    runDailyManifestInfo.detail ?? runDailyFailureInfo.detail,
    240,
  );
  const response: AdminSystemStatusResponse = {
    asOf,
    keys,
    storyboardAgent,
    bgeEmbedding,
    frameCaption,
    runDaily: {
      scriptPath: sanitizeRunDailyPath(runDailyScriptPath),
      executable: runtime.isRunDailyScriptExecutable(runDailyScriptPath),
      ...(runDailyLogInfo.logPath ? { latestLogPath: sanitizeRunDailyPath(runDailyLogInfo.logPath) } : {}),
      ...(runDailyLogInfo.logUpdatedAt ? { latestLogUpdatedAt: runDailyLogInfo.logUpdatedAt } : {}),
      ...(runDailyManifestInfo.manifestPath ? { latestManifestPath: sanitizeRunDailyPath(runDailyManifestInfo.manifestPath) } : {}),
      ...(runDailyManifestInfo.manifestStatus ? { manifestStatus: runDailyManifestInfo.manifestStatus } : {}),
      ...(runDailyFailureInfo.finalStatus ? { finalStatus: runDailyFailureInfo.finalStatus } : {}),
      ...(runDailyManifestInfo.finalExitCode !== undefined ? { finalExitCode: runDailyManifestInfo.finalExitCode } : {}),
      ...(runDailyDetail ? { detail: runDailyDetail } : {}),
      failedRequiredSteps: runDailyFailureInfo.failedRequiredSteps,
      optionalSkips: runDailyFailureInfo.optionalSkips,
      downstreamSkips: runDailyFailureInfo.downstreamSkips,
      ...(runDailyManifestInfo.stepEvents ? { stepEvents: runDailyManifestInfo.stepEvents } : {}),
      ...(runDailyManifestInfo.noWorkShortCircuit !== undefined ? { noWorkShortCircuit: runDailyManifestInfo.noWorkShortCircuit } : {}),
      ...(runDailyManifestInfo.policyMode ? { policyMode: runDailyManifestInfo.policyMode } : {}),
      ...(runDailyManifestInfo.runtime ? { runtime: runDailyManifestInfo.runtime } : {}),
      ...(runDailyManifestInfo.gdriveUpload ? { gdriveUpload: runDailyManifestInfo.gdriveUpload } : {}),
      stale: runDailyLogInfo.stale,
      checkedAt: asOf,
    },
    githubActions,
    nightlyRegression,
    supabaseCounters,
    providerReadiness: {
      'naver-directions': naverDirectionsReadiness,
      'youtube-thumbnail-durable-release': thumbnailDurableReleaseReadiness,
    },
    checklist: [],
  };
  response.checklist = buildAdminOpsChecklist(response, response.runDaily);

  if (cacheTtlMs > 0) {
    cachedStatus = {
      expiresAt: now + cacheTtlMs,
      value: response,
    };
  } else {
    cachedStatus = null;
  }

  return response;
}
