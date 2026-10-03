import 'server-only';
import { createHash } from 'node:crypto';
import type { AdminSentryIssue, AdminSentryResponse, SentryIssueStatus } from '@/types/admin-sentry';
import { safeErrorType, validSentryDsn } from '@/lib/monitoring/sentry-privacy';

export const SENTRY_PAGE_SIZE = 50;
const CACHE_TTL_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const origins = new Set(['https://sentry.io', 'https://us.sentry.io', 'https://de.sentry.io']);
const cache = new Map<string, { expiresAt: number; pending: Promise<AdminSentryResponse> }>();
const cooldowns = new Map<string, number>();
let inFlightRequests = 0;

function configuration(env: NodeJS.ProcessEnv) {
  const org = env.SENTRY_ORG?.trim();
  const project = env.SENTRY_PROJECT?.trim();
  const token = env.SENTRY_ISSUES_READ_TOKEN?.trim();
  const origin = env.SENTRY_URL?.trim() || 'https://sentry.io';
  if (!org || !project || !token || !origins.has(origin)
    || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(org)
    || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)
    || token.length > 1024 || /\s/.test(token)) return null;
  return { org, project, token, origin };
}

export function validSentryCursor(cursor: string | null): boolean {
  return cursor === null || /^\d{1,20}:\d{1,10}:[01]$/.test(cursor);
}

function nextCursor(header: string | null): string | null {
  for (const part of header?.split(',') ?? []) {
    if (!/rel="next"/.test(part) || !/results="true"/.test(part)) continue;
    const value = part.match(/cursor="([^"]+)"/)?.[1] ?? null;
    return validSentryCursor(value) ? value : null;
  }
  return null;
}

async function readBody(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_RESPONSE_BYTES || !response.body) throw new Error('sentry_unavailable');
  const reader = response.body.getReader();
  const body = new Uint8Array(MAX_RESPONSE_BYTES);
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('sentry_unavailable');
      body.set(value, bytes - value.byteLength);
    }
    return JSON.parse(new TextDecoder().decode(body.subarray(0, bytes)));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function normalizeIssue(value: unknown, org: string, project: string, origin: string): AdminSentryIssue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const issueProject = row.project as { slug?: unknown } | undefined;
  if (issueProject?.slug !== project || typeof row.id !== 'string' || !/^\d{1,24}$/.test(row.id)) return null;
  if (!['unresolved', 'resolved', 'ignored'].includes(String(row.status))) return null;
  const metadata = row.metadata as { type?: unknown } | undefined;
  const count = typeof row.count === 'string' && /^\d{1,15}$/.test(row.count) ? Number(row.count) : row.count;
  const lastSeen = typeof row.lastSeen === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(row.lastSeen) && Number.isFinite(Date.parse(row.lastSeen)) ? new Date(row.lastSeen).toISOString() : null;
  return {
    id: row.id,
    shortId: typeof row.shortId === 'string' && /^[A-Z0-9_-]{1,64}$/.test(row.shortId) ? row.shortId : `#${row.id}`,
    type: safeErrorType(metadata?.type),
    status: row.status as SentryIssueStatus,
    level: ['fatal', 'error', 'warning', 'info'].includes(String(row.level)) ? row.level as AdminSentryIssue['level'] : 'error',
    count: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0,
    lastSeen,
    // Never relay arbitrary upstream URLs or raw titles/messages/culprits.
    href: `${origin}/organizations/${org}/issues/${row.id}/`,
  };
}

export async function getAdminSentryIssues(
  status: SentryIssueStatus,
  cursor: string | null,
  options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; now?: () => number } = {},
): Promise<AdminSentryResponse> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const config = configuration(env);
  const collection = {
    browser: Boolean(validSentryDsn(env.NEXT_PUBLIC_SENTRY_DSN)),
    server: Boolean(validSentryDsn(env.SENTRY_DSN?.trim() || env.NEXT_PUBLIC_SENTRY_DSN)),
  };
  const base: AdminSentryResponse = {
    state: 'not_configured', collection, dashboardUrl: config ? `${config.origin}/organizations/${config.org}/issues/` : null,
    issues: [], nextCursor: null, fetchedAt: null,
  };
  if (!validSentryCursor(cursor) || !['unresolved', 'resolved', 'ignored'].includes(status)) throw new Error('sentry_query_invalid');
  if (!config) return base;
  const key = createHash('sha256').update(JSON.stringify([config, collection, status, cursor])).digest('hex');
  const found = cache.get(key);
  if (found && found.expiresAt > now()) return found.pending;
  const providerKey = createHash('sha256').update(JSON.stringify([config.origin, config.org])).digest('hex');
  for (const [scope, until] of cooldowns) if (until <= now()) cooldowns.delete(scope);
  if ((cooldowns.get(providerKey) ?? 0) > now()) return { ...base, state: 'unavailable' };
  for (const [cacheKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(cacheKey);
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  const pending = (async (): Promise<AdminSentryResponse> => {
    if (inFlightRequests >= 4) return { ...base, state: 'unavailable' };
    inFlightRequests += 1;
    const url = new URL(`/api/0/organizations/${config.org}/issues/`, config.origin);
    url.searchParams.set('project', config.project);
    url.searchParams.set('query', `is:${status} issue.category:error`);
    url.searchParams.set('sort', 'date');
    url.searchParams.set('limit', String(SENTRY_PAGE_SIZE));
    url.searchParams.set('statsPeriod', '14d');
    if (cursor) url.searchParams.set('cursor', cursor);
    try {
      const response = await (options.fetcher ?? fetch)(url, {
        headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d{1,6}$/.test(retry) ? Number(retry) : null;
          const date = retry && seconds === null ? Date.parse(retry) : NaN;
          const delay = seconds !== null ? seconds * 1000 : Number.isFinite(date) ? date - now() : CACHE_TTL_MS;
          if (cooldowns.size >= 32 && !cooldowns.has(providerKey)) cooldowns.delete(cooldowns.keys().next().value!);
          cooldowns.set(providerKey, now() + Math.max(CACHE_TTL_MS, delay));
        }
        await response.body?.cancel();
        return { ...base, state: 'unavailable' };
      }
      const rows = await readBody(response);
      if (!Array.isArray(rows) || rows.length > SENTRY_PAGE_SIZE) return { ...base, state: 'unavailable' };
      const issues = rows.map((row) => normalizeIssue(row, config.org, config.project, config.origin));
      if (issues.some((row) => !row || row.status !== status) || new Set(issues.map((row) => row?.id)).size !== rows.length) return { ...base, state: 'unavailable' };
      return {
        ...base, state: 'connected',
        issues: issues as AdminSentryIssue[],
        nextCursor: nextCursor(response.headers.get('link')),
        fetchedAt: new Date(now()).toISOString(),
      };
    } catch { return { ...base, state: 'unavailable' }; }
    finally { inFlightRequests -= 1; }
  })();
  cache.set(key, { expiresAt: now() + CACHE_TTL_MS, pending });
  return pending;
}
