import type { AdminProviderReadiness, AdminProviderReadinessStatus } from '@/types/admin-system-status';

const SECRET_KEY_PATTERN = /(secret|token|key|authorization|password|credential|service[_-]?role|client[_-]?secret|api[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(bearer\s+|service_role|supabase_service_role|sk_[A-Za-z0-9]|[A-Za-z0-9_-]{32,})/i;
const MAX_STRING_DIAGNOSTIC_LENGTH = 120;
const MAX_DIAGNOSTIC_KEYS = 12;

export const NAVER_DIRECTIONS_PROVIDER_ID = 'naver-directions';
export const THUMBNAIL_DURABLE_RELEASE_PROVIDER_ID = 'youtube-thumbnail-durable-release';

export type ProviderReadinessInput = {
  provider: string;
  status: AdminProviderReadinessStatus;
  reasonCode: string;
  checkedAt: string;
  remediation: string;
  diagnostics?: Record<string, unknown>;
};

export function hasNonEmptyProviderValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveNaverDirectionsCredentials(env: NodeJS.ProcessEnv = process.env): {
  clientId?: string;
  clientSecret?: string;
} {
  return {
    clientId:
      env.NEXT_NAVER_CLIENT_ID?.trim()
      || env.NEXT_NAVER_CLIENT_ID_BYEON?.trim()
      || env.NEXT_PUBLIC_NAVER_CLIENT_ID?.trim()
      || env.NEXT_PUBLIC_NAVER_CLIENT_ID_BYEON?.trim()
      || undefined,
    clientSecret:
      env.NEXT_NAVER_CLIENT_SECRET?.trim()
      || env.NEXT_NAVER_CLIENT_SECRET_BYEON?.trim()
      || undefined,
  };
}

function sanitizeDiagnosticKey(rawKey: string): string | null {
  const key = rawKey.trim().replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  if (key === 'releaseKey') return key;
  if (!key) return null;
  if (SECRET_KEY_PATTERN.test(key)) return null;
  return key;
}

function sanitizeDiagnosticValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_STRING_DIAGNOSTIC_LENGTH);
  if (!normalized) return undefined;
  if (SECRET_VALUE_PATTERN.test(normalized)) return '[redacted]';
  return normalized;
}

export function sanitizeProviderDiagnostics(
  diagnostics: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  if (!diagnostics) return sanitized;

  for (const [rawKey, rawValue] of Object.entries(diagnostics).slice(0, MAX_DIAGNOSTIC_KEYS)) {
    const key = sanitizeDiagnosticKey(rawKey);
    if (!key) continue;
    const value = sanitizeDiagnosticValue(rawValue);
    if (value !== undefined) sanitized[key] = value;
  }

  return sanitized;
}

export function buildProviderReadiness(input: ProviderReadinessInput): AdminProviderReadiness {
  return {
    provider: input.provider,
    status: input.status,
    reasonCode: input.reasonCode,
    checkedAt: input.checkedAt,
    remediation: input.remediation,
    diagnostics: sanitizeProviderDiagnostics(input.diagnostics),
  };
}

export function buildNaverDirectionsReadiness(
  env: NodeJS.ProcessEnv = process.env,
  checkedAt = new Date().toISOString(),
): AdminProviderReadiness {
  const credentials = resolveNaverDirectionsCredentials(env);
  const configured = hasNonEmptyProviderValue(credentials.clientId) && hasNonEmptyProviderValue(credentials.clientSecret);

  return buildProviderReadiness({
    provider: NAVER_DIRECTIONS_PROVIDER_ID,
    status: configured ? 'ready' : 'unavailable',
    reasonCode: configured ? 'naver-directions-ready' : 'naver-directions-credentials-missing',
    checkedAt,
    remediation: configured
      ? 'Naver Directions credentials are configured.'
      : 'Configure NEXT_NAVER_CLIENT_ID and NEXT_NAVER_CLIENT_SECRET for server-side Directions calls.',
    diagnostics: {
      configured,
      clientIdConfigured: hasNonEmptyProviderValue(credentials.clientId),
    },
  });
}
