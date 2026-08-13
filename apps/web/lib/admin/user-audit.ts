import { createHmac, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { assertPrivacySafe } from '@/lib/privacy/sanitize';

export const ADMIN_USER_AUDIT_ACTIONS = Object.freeze([
  'admin_user_created',
  'admin_user_profile_updated',
  'admin_user_role_granted',
  'admin_user_role_revoked',
  'admin_user_disabled',
  'admin_user_reactivated',
] as const);

export const ADMIN_USER_AUDIT_STATUSES = Object.freeze([
  'intent',
  'applied',
  'failed',
] as const);

export const ADMIN_USER_AUDIT_REASON_CODES = Object.freeze([
  'ADMIN_USER_CREATE_INTENT',
  'ADMIN_USER_CREATE_APPLIED',
  'ADMIN_USER_CREATE_FAILED',
  'ADMIN_USER_PROFILE_UPDATE_INTENT',
  'ADMIN_USER_PROFILE_UPDATE_APPLIED',
  'ADMIN_USER_PROFILE_UPDATE_FAILED',
  'ADMIN_USER_ROLE_GRANT_INTENT',
  'ADMIN_USER_ROLE_GRANT_APPLIED',
  'ADMIN_USER_ROLE_GRANT_FAILED',
  'ADMIN_USER_ROLE_REVOKE_INTENT',
  'ADMIN_USER_ROLE_REVOKE_APPLIED',
  'ADMIN_USER_ROLE_REVOKE_FAILED',
  'ADMIN_USER_DISABLE_INTENT',
  'ADMIN_USER_DISABLE_APPLIED',
  'ADMIN_USER_DISABLE_FAILED',
  'ADMIN_USER_REACTIVATE_INTENT',
  'ADMIN_USER_REACTIVATE_APPLIED',
  'ADMIN_USER_REACTIVATE_FAILED',
] as const);

export const ADMIN_USER_AUDIT_COUNT_KEYS = Object.freeze([
  'requested',
  'created',
  'updated',
  'failed',
] as const);

export const ADMIN_USER_AUDIT_FLAG_KEYS = Object.freeze([
  'profileChanged',
  'roleAdmin',
  'accountDisabled',
] as const);

type AdminUserAuditAction = (typeof ADMIN_USER_AUDIT_ACTIONS)[number];
type AdminUserAuditStatus = (typeof ADMIN_USER_AUDIT_STATUSES)[number];
type AdminUserAuditReasonCode = (typeof ADMIN_USER_AUDIT_REASON_CODES)[number];
type AdminUserAuditCountKey = (typeof ADMIN_USER_AUDIT_COUNT_KEYS)[number];
type AdminUserAuditFlagKey = (typeof ADMIN_USER_AUDIT_FLAG_KEYS)[number];

type AdminUserAuditCounts = Partial<Record<AdminUserAuditCountKey, number>>;
type AdminUserAuditFlags = Partial<Record<AdminUserAuditFlagKey, boolean>>;

export type AdminUserAuditPayload = {
  actorUserId: string;
  targetUserId?: string | null;
  action: AdminUserAuditAction;
  reasonCode: AdminUserAuditReasonCode;
  status?: AdminUserAuditStatus;
  correlationId?: string | null;
  errorCode?: AdminUserAuditReasonCode | null;
  counts?: AdminUserAuditCounts;
  flags?: AdminUserAuditFlags;
};

type RecordValue = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AUDIT_COUNT = 1_000_000_000;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasOwn = (value: RecordValue, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const isAdminUserAuditAction = (value: unknown): value is AdminUserAuditAction =>
  typeof value === 'string'
  && (ADMIN_USER_AUDIT_ACTIONS as readonly string[]).includes(value);

export const isAdminUserAuditReasonCode = (
  value: unknown,
): value is AdminUserAuditReasonCode =>
  typeof value === 'string'
  && (ADMIN_USER_AUDIT_REASON_CODES as readonly string[]).includes(value);

const isAdminUserAuditStatus = (value: unknown): value is AdminUserAuditStatus =>
  typeof value === 'string'
  && (ADMIN_USER_AUDIT_STATUSES as readonly string[]).includes(value);

const expectedReasonCode = (
  action: AdminUserAuditAction,
  status: AdminUserAuditStatus,
): AdminUserAuditReasonCode => {
  const operation = {
    admin_user_created: 'ADMIN_USER_CREATE',
    admin_user_profile_updated: 'ADMIN_USER_PROFILE_UPDATE',
    admin_user_role_granted: 'ADMIN_USER_ROLE_GRANT',
    admin_user_role_revoked: 'ADMIN_USER_ROLE_REVOKE',
    admin_user_disabled: 'ADMIN_USER_DISABLE',
    admin_user_reactivated: 'ADMIN_USER_REACTIVATE',
  }[action];

  const outcome = {
    intent: 'INTENT',
    applied: 'APPLIED',
    failed: 'FAILED',
  }[status];

  return `${operation}_${outcome}` as AdminUserAuditReasonCode;
};

const assertContract: (
  condition: unknown,
  message?: string,
) => asserts condition = (
  condition,
  message = '허용되지 않은 감사 기록 형식입니다.',
) => {
  if (!condition) throw new Error(message);
};

const normalizeCounts = (value: unknown): AdminUserAuditCounts => {
  if (value === undefined) return {};
  assertContract(isRecord(value));

  const counts: AdminUserAuditCounts = {};
  for (const key of Object.keys(value)) {
    assertContract((ADMIN_USER_AUDIT_COUNT_KEYS as readonly string[]).includes(key));
    const entry = value[key];
    assertContract(
      typeof entry === 'number'
      && Number.isSafeInteger(entry)
      && entry >= 0
      && entry <= MAX_AUDIT_COUNT,
    );
    counts[key as AdminUserAuditCountKey] = entry;
  }
  return counts;
};

const normalizeFlags = (value: unknown): AdminUserAuditFlags => {
  if (value === undefined) return {};
  assertContract(isRecord(value));

  const flags: AdminUserAuditFlags = {};
  for (const key of Object.keys(value)) {
    assertContract((ADMIN_USER_AUDIT_FLAG_KEYS as readonly string[]).includes(key));
    const entry = value[key];
    assertContract(typeof entry === 'boolean');
    flags[key as AdminUserAuditFlagKey] = entry;
  }
  return flags;
};

const normalizeAuditPayload = (payload: AdminUserAuditPayload) => {
  assertPrivacySafe(payload, {
    maxDepth: 4,
    maxEntries: 24,
    maxStringLength: 128,
  });

  const rawPayload = payload as unknown as RecordValue;
  assertContract(
    !hasOwn(rawPayload, 'reason')
    && !hasOwn(rawPayload, 'beforeState')
    && !hasOwn(rawPayload, 'afterState'),
  );

  assertContract(isAdminUserAuditAction(payload.action));
  const status = payload.status ?? 'intent';
  assertContract(isAdminUserAuditStatus(status));
  assertContract(UUID_PATTERN.test(payload.actorUserId));
  assertContract(payload.targetUserId === undefined || payload.targetUserId === null || UUID_PATTERN.test(payload.targetUserId));
  assertContract(payload.correlationId === undefined || payload.correlationId === null || UUID_PATTERN.test(payload.correlationId));

  const reasonCode = expectedReasonCode(payload.action, status);
  assertContract(payload.reasonCode === reasonCode);
  assertContract(
    status === 'failed'
      ? payload.errorCode === reasonCode
      : payload.errorCode === undefined || payload.errorCode === null,
  );

  return {
    actorUserId: payload.actorUserId,
    targetUserId: payload.targetUserId ?? null,
    action: payload.action,
    reasonCode,
    status,
    correlationId: payload.correlationId ?? null,
    errorCode: status === 'failed' ? reasonCode : null,
    counts: normalizeCounts(payload.counts),
    flags: normalizeFlags(payload.flags),
  };
};

function hashValue(value: string | null, domain: 'ip' | 'user-agent') {
  const key = process.env.PRIVACY_AUDIT_HASH_KEY?.trim();
  if (!value || !key || Buffer.byteLength(key, 'utf8') < 32) return null;
  return createHmac('sha256', key)
    .update(`tzudong:privacy-audit:${domain}:v1\n${value}`, 'utf8')
    .digest('hex');
}

export function buildAdminUserAuditRequestContext(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = request.headers.get('user-agent');

  return {
    requestId: randomUUID(),
    ipHash: hashValue(forwardedFor, 'ip'),
    userAgentHash: hashValue(userAgent, 'user-agent'),
  };
}

export async function recordAdminUserAuditEvent(
  supabase: SupabaseClient,
  request: NextRequest,
  payload: AdminUserAuditPayload,
) {
  const normalized = normalizeAuditPayload(payload);
  const auditContext = buildAdminUserAuditRequestContext(request);

  const { data, error } = await supabase
    .rpc('append_admin_user_audit_event', {
      p_actor_user_id: normalized.actorUserId,
      p_target_user_id: normalized.targetUserId,
      p_action: normalized.action,
      p_reason: normalized.reasonCode,
      p_status: normalized.status,
      p_correlation_id: normalized.correlationId,
      p_audit_counts: normalized.counts,
      p_audit_flags: normalized.flags,
      p_applied_at: normalized.status === 'applied' ? new Date().toISOString() : null,
      p_error_code: normalized.errorCode,
      p_request_id: auditContext.requestId,
      p_ip_hash: auditContext.ipHash,
      p_user_agent_hash: auditContext.userAgentHash,
    });

  if (error) throw error;
  assertContract(typeof data === 'string' && UUID_PATTERN.test(data));
  return data;
}
