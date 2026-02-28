import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  AdminInsightSystemIntegrationStatus,
  AdminInsightSystemStatusChecklistItem,
  AdminInsightSystemStatusKeyFlags,
  AdminInsightSystemStatusResponse,
} from '@/types/insight';

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_CACHE_TTL_MS = 30_000;

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

function resolveRunDailyScriptPath(env: NodeJS.ProcessEnv): string | undefined {
  const explicitPath = pickFirstEnvValue(env, ['RUN_DAILY_SCRIPT_PATH', 'RUN_DAILY_SCRIPT']);
  if (explicitPath) {
    try {
      const explicitResolved = path.resolve(explicitPath);
      if (!existsSync(explicitResolved)) return undefined;
      const explicitStats = statSync(explicitResolved);
      return explicitStats.isFile() ? explicitResolved : undefined;
    } catch {
      return undefined;
    }
  }

  const candidatePaths = [
    path.resolve(process.cwd(), 'backend', 'run_daily.sh'),
    path.resolve(process.cwd(), '..', 'backend', 'run_daily.sh'),
    path.resolve(process.cwd(), '..', '..', 'backend', 'run_daily.sh'),
  ];

  for (const candidate of candidatePaths) {
    try {
      const candidatePath = path.resolve(candidate);
      if (!existsSync(candidatePath)) continue;
      const stats = statSync(candidatePath);
      if (stats.isFile()) return candidatePath;
    } catch {
      continue;
    }
  }

  return undefined;
}

export function resolveAdminInsightSystemKeyFlags(
  env: NodeJS.ProcessEnv = process.env,
): AdminInsightSystemStatusKeyFlags {
  return {
    supabaseUrl: hasNonEmptyValue(env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRoleKey: hasNonEmptyValue(env.SUPABASE_SERVICE_ROLE_KEY),
    geminiServerKey: Boolean(
      pickFirstEnvValue(env, [
        'GEMINI_OCR_YEON',
        'STORYBOARD_AGENT_GEMINI_API_KEY',
        'GEMINI_API_KEY',
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

export function buildAdminInsightOpsChecklist(
  status: Pick<AdminInsightSystemStatusResponse, 'keys' | 'storyboardAgent' | 'bgeEmbedding'>,
  runDailyScriptPath?: string,
): AdminInsightSystemStatusChecklistItem[] {
  const checklist: AdminInsightSystemStatusChecklistItem[] = [];

  if (!status.keys.supabaseUrl || !status.keys.supabaseServiceRoleKey) {
    checklist.push({
      id: 'supabase-keys',
      title: 'Supabase 키 미설정',
      severity: 'critical',
      category: 'environment',
      action: 'Supabase 연결 키(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)를 설정하세요.',
      source: 'run_daily',
    });
  }

  if (!runDailyScriptPath) {
    checklist.push({
      id: 'run-daily-script-missing',
      title: '수집 스크립트 미감지',
      severity: 'high',
      category: 'environment',
      action:
        'run_daily 자동 수집 파이프라인이 감지되지 않았습니다. 운영 서버에서 `backend/run_daily.sh`(또는 RUN_DAILY_SCRIPT_PATH)를 배치하고, `chmod +x` 후 crontab(`0 4 * * * /path/to/backend/run_daily.sh >> ...`)에 등록해 실행되게 설정하세요.',
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
      source: 'storyboard-agent',
    });
  } else if (status.storyboardAgent.enabled && status.storyboardAgent.configured && !status.storyboardAgent.reachable) {
    checklist.push({
      id: 'storyboard-health-failed',
      title: '스토리보드 에이전트 미연결',
      severity: 'high',
      category: 'integration',
      action: '스토리보드 에이전트 /health 응답을 확인하세요.',
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
      source: 'bge-embedding',
    });
  } else if (status.bgeEmbedding.enabled && status.bgeEmbedding.configured && !status.bgeEmbedding.reachable) {
    checklist.push({
      id: 'bge-health-failed',
      title: 'BGE 임베딩 미연결',
      severity: 'high',
      category: 'integration',
      action: 'BGE 임베딩 서버를 실행하고 네트워크 접근을 확인하세요.',
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
        'Gemini 서버 키가 없습니다. `GEMINI_OCR_YEON` 또는 `STORYBOARD_AGENT_GEMINI_API_KEY`(또는 `GOOGLE_API_KEY`)를 설정하거나, 설정 패널에서 브라우저 키로 추가하세요.',
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
      source: 'provider-key',
    });
  }

  return checklist;
}


export async function getAdminInsightSystemStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminInsightSystemStatusResponse> {
  const cacheTtlRaw = Number(env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS || String(DEFAULT_CACHE_TTL_MS));
  const cacheTtlMs = Number.isFinite(cacheTtlRaw) && cacheTtlRaw >= 0 ? cacheTtlRaw : DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  if (cachedStatus && cachedStatus.expiresAt > now) {
    return cachedStatus.value;
  }

  const asOf = new Date(now).toISOString();
  const keys = resolveAdminInsightSystemKeyFlags(env);

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

  const response: AdminInsightSystemStatusResponse = {
    asOf,
    keys,
    storyboardAgent,
    bgeEmbedding,
    checklist: [],
  };

  const runDailyScriptPath = resolveRunDailyScriptPath(env);
  response.checklist = buildAdminInsightOpsChecklist(response, runDailyScriptPath);

  cachedStatus = {
    expiresAt: now + cacheTtlMs,
    value: response,
  };

  return response;
}
