import type {
  AdminInsightGithubActionsStatus,
  AdminInsightSystemIntegrationStatus,
  AdminInsightSystemFrameCaptionStatus,
  AdminInsightSystemRunDailyStatus,
  AdminInsightSupabaseCounterStatus,
  AdminInsightSystemStatusChecklistItem,
  AdminInsightSystemStatusKeyFlags,
  AdminInsightSystemStatusResponse,
} from '@/types/insight';

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_GITHUB_WORKFLOW = 'daily-crawler.yml';

type CachedStatusEntry = {
  expiresAt: number;
  value: AdminInsightSystemStatusResponse;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return { reachable: false, detail: message };
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

export function resolveAdminInsightSystemKeyFlags(
  env: NodeJS.ProcessEnv = process.env,
): AdminInsightSystemStatusKeyFlags {
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
): AdminInsightSystemIntegrationStatus {
  return {
    enabled,
    configured,
    reachable: false,
    ...(endpoint ? { endpoint } : {}),
    checkedAt: asOf,
  };
}

function makeDisabledGithubActionsStatus(asOf: string, enabled: boolean, detail?: string): AdminInsightGithubActionsStatus {
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
): Promise<AdminInsightGithubActionsStatus> {
  const enabled = toBooleanFlag(env.INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED, false);
  if (!enabled) return makeDisabledGithubActionsStatus(asOf, false, 'disabled');

  const repository = pickFirstEnvValue(env, ['INSIGHT_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY']);
  const token = pickFirstEnvValue(env, ['INSIGHT_GITHUB_TOKEN', 'GITHUB_TOKEN']);
  const workflow = pickFirstEnvValue(env, ['INSIGHT_GITHUB_WORKFLOW']) || DEFAULT_GITHUB_WORKFLOW;
  const branch = pickFirstEnvValue(env, ['INSIGHT_GITHUB_BRANCH']);

  if (!repository || !token) {
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
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository).replace('%2F', '/')}/actions/workflows/${encodeURIComponent(workflow)}/runs?${params.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: timeout.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        enabled: true,
        configured: true,
        reachable: false,
        workflow,
        ...(branch ? { branch } : {}),
        detail: `HTTP ${response.status}`,
        checkedAt: asOf,
      };
    }

    const payload = await response.json() as { workflow_runs?: Array<Record<string, unknown>> };
    const latest = Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] : undefined;
    const latestRunUrl = typeof latest?.html_url === 'string' ? sanitizeEndpointForDisplay(latest.html_url) : undefined;
    return {
      enabled: true,
      configured: true,
      reachable: true,
      workflow,
      ...(branch ? { branch } : {}),
      ...(typeof latest?.id === 'number' ? { latestRunId: latest.id } : {}),
      ...(typeof latest?.status === 'string' ? { latestRunStatus: sanitizeTextForDisplay(latest.status) } : {}),
      ...(typeof latest?.conclusion === 'string' || latest?.conclusion === null ? { latestRunConclusion: latest.conclusion as string | null } : {}),
      ...(latestRunUrl ? { latestRunUrl } : {}),
      ...(typeof latest?.created_at === 'string' ? { latestRunCreatedAt: latest.created_at } : {}),
      ...(typeof latest?.updated_at === 'string' ? { latestRunUpdatedAt: latest.updated_at } : {}),
      checkedAt: asOf,
    };
  } catch (error) {
    return {
      enabled: true,
      configured: true,
      reachable: false,
      workflow,
      ...(branch ? { branch } : {}),
      detail: error instanceof Error ? sanitizeTextForDisplay(error.message) : 'unknown_error',
      checkedAt: asOf,
    };
  } finally {
    timeout.clear();
  }
}

function makeDisabledSupabaseCounterStatus(asOf: string, enabled: boolean, detail?: string): AdminInsightSupabaseCounterStatus {
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
): Promise<AdminInsightSupabaseCounterStatus> {
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
      reachable: restaurantsTotal !== undefined || evaluatedRestaurants !== undefined,
      ...(restaurantsTotal !== undefined ? { restaurantsTotal } : {}),
      ...(evaluatedRestaurants !== undefined ? { evaluatedRestaurants } : {}),
      ...(restaurantsTotal === undefined && evaluatedRestaurants === undefined ? { detail: 'count_unavailable' } : {}),
      checkedAt: asOf,
    };
  } catch (error) {
    return {
      enabled: true,
      configured: true,
      reachable: false,
      detail: error instanceof Error ? sanitizeTextForDisplay(error.message) : 'unknown_error',
      checkedAt: asOf,
    };
  }
}

export function buildAdminInsightOpsChecklist(
  status: Pick<AdminInsightSystemStatusResponse, 'keys' | 'storyboardAgent' | 'bgeEmbedding' | 'frameCaption'>,
  runDaily?: AdminInsightSystemRunDailyStatus,
): AdminInsightSystemStatusChecklistItem[] {
  const checklist: AdminInsightSystemStatusChecklistItem[] = [];
  const hasRunDailyScript = Boolean(runDaily?.scriptPath);
  const hasRunDailyScriptIssue = !hasRunDailyScript;
  const hasRunDailyExecutableIssue = Boolean(runDaily?.scriptPath) && !(runDaily?.executable ?? false);
  const hasRunDailyStaleIssue = Boolean(runDaily && runDaily.stale);
  const hasRunDailyFailureIssue = Boolean(runDaily?.failedRequiredSteps && runDaily.failedRequiredSteps.length > 0);

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

  return checklist;
}


export async function getAdminInsightSystemStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminInsightSystemStatusResponse> {
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
  const keys = resolveAdminInsightSystemKeyFlags(env);
  const runtime = await import('@/lib/insight/chat-system-status-runtime');

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
  } satisfies AdminInsightSystemFrameCaptionStatus;

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
  const runDailyLogTailInfo = runDailyManifestInfo.finalStatus
    ? { failedRequiredSteps: [], optionalSkips: [], downstreamSkips: [] }
    : runtime.parseRunDailyLogTailStatus(runDailyLogInfo.logPath);
  const runDailyFailureInfo = runDailyManifestInfo.finalStatus ? runDailyManifestInfo : runDailyLogTailInfo;
  const [githubActions, supabaseCounters] = await Promise.all([
    resolveGithubActionsStatus(env, asOf, timeoutMs),
    resolveSupabaseCounterStatus(env, asOf, timeoutMs),
  ]);

  const response: AdminInsightSystemStatusResponse = {
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
      ...(runDailyFailureInfo.finalStatus ? { finalStatus: runDailyFailureInfo.finalStatus } : {}),
      ...(runDailyManifestInfo.finalExitCode !== undefined ? { finalExitCode: runDailyManifestInfo.finalExitCode } : {}),
      failedRequiredSteps: runDailyFailureInfo.failedRequiredSteps,
      optionalSkips: runDailyFailureInfo.optionalSkips,
      downstreamSkips: runDailyFailureInfo.downstreamSkips,
      ...(runDailyManifestInfo.noWorkShortCircuit !== undefined ? { noWorkShortCircuit: runDailyManifestInfo.noWorkShortCircuit } : {}),
      ...(runDailyManifestInfo.policyMode ? { policyMode: runDailyManifestInfo.policyMode } : {}),
      stale: runDailyLogInfo.stale,
      checkedAt: asOf,
    },
    githubActions,
    supabaseCounters,
    checklist: [],
  };
  response.checklist = buildAdminInsightOpsChecklist(response, response.runDaily);

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
