import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ANYCAP_PROVIDER_ID = 'anycap' as const;
export const ANYCAP_REQUIRED_MODEL = 'gpt-image-2' as const;

export type AnyCapGptImageReadinessStatus = 'ready' | 'missing' | 'auth_required' | 'invalid' | 'error';

export type AnyCapProbeResult = {
  command: string[];
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
};

export type AnyCapGptImageReadinessInput = {
  requestedModel?: string;
  statusProbe?: AnyCapProbeResult;
  modelsProbe?: AnyCapProbeResult;
  checkedAt?: string;
};

export type AnyCapGptImageReadiness = {
  providerId: typeof ANYCAP_PROVIDER_ID;
  model: typeof ANYCAP_REQUIRED_MODEL;
  strictExactModelRequired: true;
  fallbackAllowed: false;
  status: AnyCapGptImageReadinessStatus;
  reason: string;
  trace: {
    checkedAt: string;
    requestedModel: string;
    statusCommand?: string[];
    statusExitCode?: number | null;
    modelsCommand?: string[];
    modelsExitCode?: number | null;
    snippets: string[];
  };
  remediation: string[];
};

type ReadinessFailure = Exclude<AnyCapGptImageReadinessStatus, 'ready'>;

const TRACE_SNIPPET_LIMIT = 240;
const EXEC_TIMEOUT_MS = 10_000;
const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9_-]{12,}/gi,
  /(api[_-]?key|token|secret|password|authorization|credential)(\s*[:=]\s*)([^\s,}"']+)/gi,
  /([A-Za-z0-9_-]{32,})/g,
];
const AUTH_REQUIRED_PATTERN = /(auth(?:entication)?[_\s-]*(?:required|needed|failed)|auth_required|not\s+(?:logged\s+in|authenticated)|login\s+required|please\s+log\s+in|unauthorized|invalid\s+token|missing\s+token|expired\s+session)/i;

const REMEDIATION: Record<AnyCapGptImageReadinessStatus, string[]> = {
  ready: ['AnyCap CLI가 gpt-image-2 모델을 사용할 준비가 됐습니다. 더미 이미지 생성 전 이 상태를 확인하세요.'],
  missing: ['AnyCap CLI 설치와 PATH 등록을 확인하세요.', '모델 카탈로그에 gpt-image-2가 보이는지 anycap image models로 확인하세요.'],
  auth_required: ['서버/운영 계정에서 anycap login을 완료하세요.', '로그인 후 anycap status와 anycap image models를 다시 실행하세요.'],
  invalid: ['이미지 생성 모델 설정을 정확히 gpt-image-2로 고정하세요.', '대체 모델 또는 별칭을 사용하지 마세요.'],
  error: ['AnyCap CLI 상태 명령과 모델 카탈로그 명령을 운영 셸에서 직접 확인하세요.', '민감정보를 제외한 오류 로그를 확인한 뒤 재시도하세요.'],
};

export function sanitizeAnyCapTraceSnippet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let sanitized = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!sanitized) return undefined;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_match, key, sep) => {
      if (typeof key === 'string' && typeof sep === 'string') return `${key}${sep}[redacted]`;
      return '[redacted]';
    });
  }
  return sanitized.slice(0, TRACE_SNIPPET_LIMIT);
}

function buildReadiness(
  status: AnyCapGptImageReadinessStatus,
  reason: string,
  input: AnyCapGptImageReadinessInput,
): AnyCapGptImageReadiness {
  const snippets = [
    sanitizeAnyCapTraceSnippet(input.statusProbe?.stdout),
    sanitizeAnyCapTraceSnippet(input.statusProbe?.stderr),
    sanitizeAnyCapTraceSnippet(input.modelsProbe?.stdout),
    sanitizeAnyCapTraceSnippet(input.modelsProbe?.stderr),
    sanitizeAnyCapTraceSnippet(input.statusProbe?.errorCode),
    sanitizeAnyCapTraceSnippet(input.modelsProbe?.errorCode),
  ].filter((entry): entry is string => Boolean(entry));

  return {
    providerId: ANYCAP_PROVIDER_ID,
    model: ANYCAP_REQUIRED_MODEL,
    strictExactModelRequired: true,
    fallbackAllowed: false,
    status,
    reason,
    trace: {
      checkedAt: input.checkedAt ?? new Date().toISOString(),
      requestedModel: input.requestedModel?.trim() || ANYCAP_REQUIRED_MODEL,
      statusCommand: input.statusProbe?.command,
      statusExitCode: input.statusProbe?.exitCode,
      modelsCommand: input.modelsProbe?.command,
      modelsExitCode: input.modelsProbe?.exitCode,
      snippets: snippets.slice(0, 6),
    },
    remediation: REMEDIATION[status],
  };
}

function fail(status: ReadinessFailure, reason: string, input: AnyCapGptImageReadinessInput): AnyCapGptImageReadiness {
  return buildReadiness(status, reason, input);
}

function combinedProbeText(probe: AnyCapProbeResult | undefined): string {
  return `${probe?.stdout ?? ''}\n${probe?.stderr ?? ''}\n${probe?.errorCode ?? ''}`;
}

function isMissingCli(probe: AnyCapProbeResult | undefined): boolean {
  if (!probe) return false;
  return probe.errorCode === 'ENOENT' || probe.errorCode === 'command_not_found' || /not recognized|not found|ENOENT/i.test(combinedProbeText(probe));
}

function isAuthRequiredProbe(probe: AnyCapProbeResult | undefined): boolean {
  return AUTH_REQUIRED_PATTERN.test(combinedProbeText(probe));
}

function parseJsonOutput(probe: AnyCapProbeResult | undefined): unknown {
  const raw = probe?.stdout?.trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function hasExplicitAuthRequired(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const booleanFlags = [record.authRequired, record.auth_required, record.requiresAuth, record.requires_auth];
  if (booleanFlags.some((flag) => flag === true)) return true;

  const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated ?? record.authorized;
  if (loggedIn === false) return true;

  const status = typeof record.status === 'string' ? record.status : undefined;
  const reason = typeof record.reason === 'string' ? record.reason : undefined;
  const message = typeof record.message === 'string' ? record.message : undefined;
  return AUTH_REQUIRED_PATTERN.test(`${status ?? ''} ${reason ?? ''} ${message ?? ''}`);
}

function collectModelNames(value: unknown, names = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    names.add(value);
    return names;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectModelNames(entry, names);
    return names;
  }

  if (!value || typeof value !== 'object') return names;

  const record = value as Record<string, unknown>;
  for (const key of ['id', 'name', 'model', 'modelId', 'model_id']) {
    const candidate = record[key];
    if (typeof candidate === 'string') names.add(candidate);
  }

  for (const key of ['models', 'data', 'items', 'imageModels', 'image_models']) {
    if (key in record) collectModelNames(record[key], names);
  }

  return names;
}

function collectModelNamesFromText(value: string | undefined, names = new Set<string>()): Set<string> {
  if (!value) return names;
  for (const match of value.matchAll(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g)) {
    names.add(match[0]);
  }
  return names;
}

export function normalizeAnyCapGptImageReadiness(input: AnyCapGptImageReadinessInput): AnyCapGptImageReadiness {
  const requestedModel = input.requestedModel?.trim() || ANYCAP_REQUIRED_MODEL;
  if (requestedModel !== ANYCAP_REQUIRED_MODEL) {
    return fail('invalid', `Configured image model must be exactly ${ANYCAP_REQUIRED_MODEL}; received ${requestedModel}.`, input);
  }

  if (isMissingCli(input.statusProbe) || isMissingCli(input.modelsProbe)) {
    return fail('missing', 'AnyCap CLI is missing or not available on PATH.', input);
  }

  const statusJson = parseJsonOutput(input.statusProbe);
  const modelsJson = parseJsonOutput(input.modelsProbe);

  if (isAuthRequiredProbe(input.statusProbe) || isAuthRequiredProbe(input.modelsProbe) || hasExplicitAuthRequired(statusJson) || hasExplicitAuthRequired(modelsJson)) {
    return fail('auth_required', 'AnyCap authentication is required before checking gpt-image-2 readiness.', input);
  }

  if (input.statusProbe && input.statusProbe.exitCode !== 0) {
    return fail('error', 'anycap status failed before model readiness could be confirmed.', input);
  }

  if (!input.modelsProbe) {
    return fail('error', 'AnyCap model catalog probe was not provided.', input);
  }

  if (input.modelsProbe.exitCode !== 0) {
    return fail('error', 'anycap image models failed before gpt-image-2 catalog readiness could be confirmed.', input);
  }

  const models = collectModelNames(modelsJson);
  collectModelNamesFromText(input.modelsProbe.stdout, models);
  collectModelNamesFromText(input.modelsProbe.stderr, models);
  if (!models.has(ANYCAP_REQUIRED_MODEL)) {
    return fail('missing', `${ANYCAP_REQUIRED_MODEL} is missing from the AnyCap image model catalog.`, input);
  }

  return buildReadiness('ready', `${ANYCAP_REQUIRED_MODEL} is available through AnyCap with no fallback model.`, input);
}

async function runAnyCapCommand(args: string[]): Promise<AnyCapProbeResult> {
  const command = ['anycap', ...args];
  try {
    const result = await execFileAsync('anycap', args, {
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { command, exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: string | number; stdout?: string; stderr?: string; signal?: string };
    return {
      command,
      exitCode: typeof err.code === 'number' ? err.code : null,
      stdout: err.stdout,
      stderr: err.stderr,
      errorCode: typeof err.code === 'string' ? err.code : err.signal,
    };
  }
}

export function resolveAnyCapRequestedModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ANYCAP_IMAGE_MODEL ?? env.ANYCAP_GPT_IMAGE_MODEL ?? ANYCAP_REQUIRED_MODEL).trim() || ANYCAP_REQUIRED_MODEL;
}
export function buildAnyCapGptImageReadinessError(error: unknown): AnyCapGptImageReadiness {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown readiness probe error.';
  return normalizeAnyCapGptImageReadiness({
    statusProbe: {
      command: ['anycap', 'status'],
      exitCode: 1,
      stderr: message,
      errorCode: 'probe_error',
    },
  });
}

export async function probeAnyCapGptImageReadiness(env: NodeJS.ProcessEnv = process.env): Promise<AnyCapGptImageReadiness> {
  const requestedModel = resolveAnyCapRequestedModel(env);
  if (requestedModel !== ANYCAP_REQUIRED_MODEL) {
    return normalizeAnyCapGptImageReadiness({ requestedModel });
  }

  const statusProbe = await runAnyCapCommand(['status']);
  if (isMissingCli(statusProbe) || isAuthRequiredProbe(statusProbe) || statusProbe.exitCode !== 0) {
    return normalizeAnyCapGptImageReadiness({ requestedModel, statusProbe });
  }

  const modelsProbe = await runAnyCapCommand(['image', 'models']);
  return normalizeAnyCapGptImageReadiness({ requestedModel, statusProbe, modelsProbe });
}
