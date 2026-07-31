import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

const CONFIRMATION_TEXT = '마케팅 발송을 확인합니다';
const MAX_RECIPIENTS = 100;
const MAX_REQUEST_BYTES = 16_384;
const MAX_PROVIDER_RESPONSE_BYTES = 16_384;
const PROVIDER_TIMEOUT_MS = 8_000;
const MARKETING_DATA_KEYS: readonly string[] = [];
const PROVIDER_IDENTITY = 'g014_https_provider_v1';
// Production marketing egress is intentionally unavailable. A reviewed source-pinned
// provider identity/origin and its credentials must be approved before this can become
// a non-null configuration; environment variables cannot create an egress target.
const PRODUCTION_PROVIDER: ProviderEgressConfiguration | null = null;

type Channel = 'email' | 'sms' | 'push';
type Scalar = string | number | boolean | null;
export type MarketingCampaignRpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
type RpcClient = MarketingCampaignRpcClient;
export type ProviderDnsLookup = (hostname: string) => Promise<readonly { address: string }[]>;
export type ProviderFetch = (url: URL, init: RequestInit) => Promise<Response>;
export type ProviderEgressConfiguration = {
  identity: typeof PROVIDER_IDENTITY;
  endpoint: string;
  token: string;
};
type AdminAccess = Awaited<ReturnType<typeof requireAdmin>>;
export type MarketingCampaignRouteDependencies = {
  requireAdmin: () => Promise<AdminAccess>;
  createServiceClient: () => RpcClient;
  resolveDns: ProviderDnsLookup;
  fetch: ProviderFetch;
  provider: ProviderEgressConfiguration | null;
  now: () => number;
  providerTimeoutMs: number;
};
const productionMarketingRouteDependencies: MarketingCampaignRouteDependencies = {
  requireAdmin,
  createServiceClient: () => createSupabaseServiceRoleClient() as unknown as RpcClient,
  resolveDns: async (hostname) => lookup(hostname, { all: true, verbatim: true }),
  fetch: (url, init) => globalThis.fetch(url, init),
  provider: PRODUCTION_PROVIDER,
  now: () => Date.now(),
  providerTimeoutMs: PROVIDER_TIMEOUT_MS,
};
type Preview = { action: 'preview'; channel: Channel; recipientUserIds: string[]; title: string; message: string; data: Record<string, Scalar> };
type Apply = { action: 'apply'; operationId: string; previewHash: string; idempotencyKey: string };
type PreparedBatch = { operationId: string; batchId: string };
type ProviderPayload = {
  operationId: string;
  batchId: string;
  claimToken: string;
  providerAttemptId: string;
  idempotencyKey: string;
  channel: Channel;
  title: string;
  message: string;
  data: Record<string, Scalar>;
  recipientUserIds: string[];
};
type ClaimedDispatch = {
  operationId: string;
  batchId: string;
  claimToken: string;
  providerAttemptId: string;
  providerIdentity: typeof PROVIDER_IDENTITY;
  idempotencyKey: string;
  payloadDigest: string;
  payload: ProviderPayload;
};
type ProviderResult = { acceptedRecipientIds: string[]; acceptedRecipientDigest: string; providerReceiptId: string; idempotencyKey: string; providerAttemptId: string; payloadDigest: string };
type ProviderFailure = { providerReceiptId: string; idempotencyKey: string; providerAttemptId: string; payloadDigest: string; errorCode: 'provider_rejected' | 'provider_invalid_request' };
type Receipt = { operationId: string; status: 'applied' | 'partial' | 'failed'; auditId: string | null; counts: { requested: number; sent: number; suppressed: number; failed: number }; readback: { passed: boolean; notificationRows: number } };

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isMarketingRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isMarketingRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isMarketingUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isChannel(value: unknown): value is Channel {
  return value === 'email' || value === 'sms' || value === 'push';
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ');
  if (!normalized || normalized.length > limit) return null;

  try {
    assertPrivacySafe(normalized);
    return normalized;
  } catch {
    return null;
  }
}

function data(value: unknown): Record<string, Scalar> | null {
  if (!hasExactKeys(value, MARKETING_DATA_KEYS)) return null;

  try {
    assertPrivacySafe(value);
    return {};
  } catch {
    return null;
  }
}

function preview(value: unknown): Preview | null {
  if (!hasExactKeys(value, ['action', 'channel', 'recipientUserIds', 'title', 'message', 'data']) || value.action !== 'preview' || !isChannel(value.channel) || !Array.isArray(value.recipientUserIds)) {
    return null;
  }

  const title = text(value.title, 120);
  const message = text(value.message, 1_000);
  const sanitized = data(value.data);
  const recipientUserIds = value.recipientUserIds.filter(isMarketingUuid);
  if (!title || !message || !sanitized || recipientUserIds.length < 1 || recipientUserIds.length > MAX_RECIPIENTS || recipientUserIds.length !== value.recipientUserIds.length || new Set(recipientUserIds).size !== recipientUserIds.length) {
    return null;
  }

  const parsed = { action: 'preview' as const, channel: value.channel, recipientUserIds, title, message, data: sanitized };
  try {
    assertPrivacySafe([parsed.title, parsed.message, parsed.data, parsed.recipientUserIds, parsed.channel]);
    return parsed;
  } catch {
    return null;
  }
}

function apply(value: unknown): Apply | null {
  if (!hasExactKeys(value, ['action', 'operationId', 'previewHash', 'confirmationText', 'idempotencyKey']) || value.action !== 'apply' || !isMarketingUuid(value.operationId) || !isHash(value.previewHash) || value.confirmationText !== CONFIRMATION_TEXT || typeof value.idempotencyKey !== 'string') {
    return null;
  }

  const idempotencyKey = value.idempotencyKey.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) return null;

  try {
    assertPrivacySafe({ operationId: value.operationId, previewHash: value.previewHash, idempotencyKey });
    return { action: 'apply', operationId: value.operationId, previewHash: value.previewHash, idempotencyKey };
  } catch {
    return null;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isMarketingRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hashPreview(actorUserId: string, request: Preview, expiresAt: string) {
  return createHash('sha256').update(stable({ actorUserId, request, expiresAt })).digest('hex');
}

function canonicalRecipientIds(recipientIds: readonly string[]) {
  return recipientIds.map((recipientId) => recipientId.toLowerCase()).sort();
}

function hashAcceptedRecipientIds(recipientIds: readonly string[]) {
  return createHash('sha256').update(canonicalRecipientIds(recipientIds).join(',')).digest('hex');
}

function hashProviderReceipt(
  claim: ClaimedDispatch,
  providerReceiptId: string,
  outcome: { status: 'accepted'; acceptedRecipientDigest: string } | { status: 'failed'; errorCode: ProviderFailure['errorCode'] },
) {
  return createHash('sha256').update(stable({
    providerIdentity: claim.providerIdentity,
    providerReceiptId,
    idempotencyKey: claim.idempotencyKey,
    providerAttemptId: claim.providerAttemptId,
    payloadDigest: claim.payloadDigest,
    outcome,
  })).digest('hex');
}

async function rpc(client: RpcClient, fn: string, params: Record<string, unknown>) {
  try {
    const result = await client.rpc(fn, params);
    return result.error ? null : result.data;
  } catch {
    return null;
  }
}

function string(value: unknown, key: string): string | null {
  return isMarketingRecord(value) && typeof value[key] === 'string' ? value[key] : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function receipt(value: unknown): Receipt | null {
  if (!hasExactKeys(value, ['operationId', 'status', 'auditId', 'counts', 'readback']) || !isMarketingUuid(value.operationId) || (value.status !== 'applied' && value.status !== 'partial' && value.status !== 'failed') || !(value.auditId === null || isMarketingUuid(value.auditId)) || !hasExactKeys(value.counts, ['requested', 'sent', 'suppressed', 'failed']) || !hasExactKeys(value.readback, ['passed', 'notificationRows'])) {
    return null;
  }

  const requested = count(value.counts.requested);
  const sent = count(value.counts.sent);
  const suppressed = count(value.counts.suppressed);
  const failed = count(value.counts.failed);
  const notificationRows = count(value.readback.notificationRows);
  if (requested === null || sent === null || suppressed === null || failed === null || notificationRows === null || typeof value.readback.passed !== 'boolean') return null;

  try {
    assertPrivacySafe(value);
    return { operationId: value.operationId, status: value.status, auditId: value.auditId, counts: { requested, sent, suppressed, failed }, readback: { passed: value.readback.passed, notificationRows } };
  } catch {
    return null;
  }
}

function prepared(value: unknown): PreparedBatch | null {
  if (!hasExactKeys(value, ['status', 'replayed', 'operationId', 'batchId']) || value.status !== 'prepared' || typeof value.replayed !== 'boolean' || !isMarketingUuid(value.operationId) || !isMarketingUuid(value.batchId)) return null;
  return { operationId: value.operationId, batchId: value.batchId };
}

function providerPayload(value: unknown): ProviderPayload | null {
  if (!hasExactKeys(value, ['operationId', 'batchId', 'claimToken', 'providerAttemptId', 'idempotencyKey', 'channel', 'title', 'message', 'data', 'recipientUserIds']) || !isMarketingUuid(value.operationId) || !isMarketingUuid(value.batchId) || !isMarketingUuid(value.claimToken) || !isMarketingUuid(value.providerAttemptId) || typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.idempotencyKey) || !isChannel(value.channel) || !Array.isArray(value.recipientUserIds)) {
    return null;
  }

  const title = text(value.title, 120);
  const message = text(value.message, 1_000);
  const sanitized = data(value.data);
  const recipientUserIds = value.recipientUserIds.filter(isMarketingUuid);
  if (!title || !message || !sanitized || recipientUserIds.length < 1 || recipientUserIds.length > MAX_RECIPIENTS || recipientUserIds.length !== value.recipientUserIds.length || new Set(recipientUserIds).size !== recipientUserIds.length) return null;
  return { operationId: value.operationId, batchId: value.batchId, claimToken: value.claimToken, providerAttemptId: value.providerAttemptId, idempotencyKey: value.idempotencyKey, channel: value.channel, title, message, data: sanitized, recipientUserIds };
}

function claimedDispatch(value: unknown, expected: PreparedBatch): ClaimedDispatch | null {
  if (!hasExactKeys(value, ['status', 'operationId', 'batchId', 'claimToken', 'providerAttemptId', 'providerIdentity', 'idempotencyKey', 'payloadDigest', 'payload']) || value.status !== 'claimed' || !isMarketingUuid(value.operationId) || !isMarketingUuid(value.batchId) || !isMarketingUuid(value.claimToken) || !isMarketingUuid(value.providerAttemptId) || value.providerIdentity !== PROVIDER_IDENTITY || typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.idempotencyKey) || !isHash(value.payloadDigest)) return null;

  const payload = providerPayload(value.payload);
  if (!payload || value.operationId !== expected.operationId || value.batchId !== expected.batchId || payload.operationId !== value.operationId || payload.batchId !== value.batchId || payload.claimToken !== value.claimToken || payload.providerAttemptId !== value.providerAttemptId || payload.idempotencyKey !== value.idempotencyKey) return null;

  const claimed: ClaimedDispatch = { operationId: value.operationId, batchId: value.batchId, claimToken: value.claimToken, providerAttemptId: value.providerAttemptId, providerIdentity: PROVIDER_IDENTITY, idempotencyKey: value.idempotencyKey, payloadDigest: value.payloadDigest, payload };
  try {
    assertPrivacySafe([claimed.operationId, claimed.batchId, claimed.claimToken, claimed.providerAttemptId, claimed.idempotencyKey, claimed.payloadDigest, claimed.payload.channel, claimed.payload.title, claimed.payload.message, claimed.payload.data, claimed.payload.recipientUserIds]);
    return claimed;
  } catch {
    return null;
  }
}

function providerResult(value: unknown, claim: ClaimedDispatch): ProviderResult | null {
  if (!hasExactKeys(value, ['acceptedRecipientIds', 'providerReceiptId', 'idempotencyKey', 'providerAttemptId', 'payloadDigest']) || !Array.isArray(value.acceptedRecipientIds) || typeof value.providerReceiptId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value.providerReceiptId) || value.idempotencyKey !== claim.idempotencyKey || value.providerAttemptId !== claim.providerAttemptId || value.payloadDigest !== claim.payloadDigest) return null;

  const acceptedRecipientIds = value.acceptedRecipientIds.filter(isMarketingUuid);
  const allowed = new Set(canonicalRecipientIds(claim.payload.recipientUserIds));
  const canonicalAcceptedRecipientIds = canonicalRecipientIds(acceptedRecipientIds);
  if (acceptedRecipientIds.length !== value.acceptedRecipientIds.length || acceptedRecipientIds.length > allowed.size || new Set(canonicalAcceptedRecipientIds).size !== canonicalAcceptedRecipientIds.length || !canonicalAcceptedRecipientIds.every((id) => allowed.has(id))) return null;

  try {
    assertPrivacySafe(value);
    return {
      acceptedRecipientIds: canonicalAcceptedRecipientIds,
      acceptedRecipientDigest: hashAcceptedRecipientIds(canonicalAcceptedRecipientIds),
      providerReceiptId: value.providerReceiptId,
      idempotencyKey: value.idempotencyKey,
      providerAttemptId: value.providerAttemptId,
      payloadDigest: value.payloadDigest,
    };
  } catch {
    return null;
  }
}
function providerFailure(value: unknown, claim: ClaimedDispatch): ProviderFailure | null {
  if (!hasExactKeys(value, ['status', 'providerReceiptId', 'idempotencyKey', 'providerAttemptId', 'payloadDigest', 'errorCode']) || value.status !== 'failed' || typeof value.providerReceiptId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value.providerReceiptId) || value.idempotencyKey !== claim.idempotencyKey || value.providerAttemptId !== claim.providerAttemptId || value.payloadDigest !== claim.payloadDigest || (value.errorCode !== 'provider_rejected' && value.errorCode !== 'provider_invalid_request')) return null;

  try {
    assertPrivacySafe(value);
    return { providerReceiptId: value.providerReceiptId, idempotencyKey: value.idempotencyKey, providerAttemptId: value.providerAttemptId, payloadDigest: value.payloadDigest, errorCode: value.errorCode };
  } catch {
    return null;
  }
}


function isUnsafeProviderAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [first, second] = address.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19));
  }
  if (version !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mappedIpv4 ? isUnsafeProviderAddress(mappedIpv4[1]) : false;
}

export async function resolveMarketingProviderUrl(
  provider: ProviderEgressConfiguration | null,
  resolveDns: ProviderDnsLookup,
): Promise<URL | null> {
  if (!provider || provider.identity !== PROVIDER_IDENTITY || !provider.token.trim()) return null;

  let providerUrl: URL;
  try {
    providerUrl = new URL(provider.endpoint);
  } catch {
    return null;
  }

  const hostname = providerUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (providerUrl.protocol !== 'https:' || providerUrl.username || providerUrl.password || providerUrl.hash || !hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return null;
  if (isIP(hostname) && isUnsafeProviderAddress(hostname)) return null;

  try {
    const addresses = await resolveDns(hostname);
    if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeProviderAddress(address))) return null;
  } catch {
    return null;
  }
  return providerUrl;
}

async function readBoundedProviderJson(response: Response, timeoutMs: number): Promise<unknown | null> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES)) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + timeoutMs;
  let totalBytes = 0;
  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error('provider_response_timeout');

      let timer: ReturnType<typeof setTimeout> | undefined;
      let next: ReadableStreamReadResult<Uint8Array> | null = null;
      try {
        next = await Promise.race([
          reader.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
            timer = setTimeout(() => reject(new Error('provider_response_timeout')), remainingMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!next) throw new Error('provider_response_timeout');
      const { done, value } = next;
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function recordPreEgressFailure(client: RpcClient, request: Apply, actor: string, batchId: string) {
  return receipt(await rpc(client, 'fail_marketing_campaign_batch', {
    p_operation_id: request.operationId,
    p_batch_id: batchId,
    p_actor_user_id: actor,
    p_preview_hash: request.previewHash,
    p_error_code: 'provider_unavailable',
  }));
}

function unknownOutcome() {
  return noStoreJson({
    error: 'marketing_provider_outcome_unknown',
    message: '제공자 발송 결과를 확인하지 못해 재전송하지 않았습니다. 운영자 확인이 필요합니다.',
    retryable: false,
  }, { status: 503 });
}

export async function handleMarketingCampaignRequest(
  initialAdminUserId: string,
  body: unknown,
  dependencies: MarketingCampaignRouteDependencies = productionMarketingRouteDependencies,
) {
  const previewRequest = preview(body);
  if (previewRequest) {
    const expiresAt = new Date(dependencies.now() + 10 * 60 * 1000).toISOString();
    const previewHash = hashPreview(initialAdminUserId, previewRequest, expiresAt);
    const client = dependencies.createServiceClient();
    const result = await rpc(client, 'preview_marketing_campaign', {
      p_actor_user_id: initialAdminUserId,
      p_channel: previewRequest.channel,
      p_recipient_user_ids: previewRequest.recipientUserIds,
      p_title: previewRequest.title,
      p_message: previewRequest.message,
      p_data: previewRequest.data,
      p_preview_hash: previewHash,
      p_expires_at: expiresAt,
    });
    const operationId = string(result, 'operationId');
    const storedExpiresAt = string(result, 'expiresAt');
    const requestedCount = count(isMarketingRecord(result) ? result.requestedCount : null);
    const batchCap = count(isMarketingRecord(result) ? result.batchCap : null);
    if (!isMarketingUuid(operationId) || !storedExpiresAt || Number.isNaN(Date.parse(storedExpiresAt)) || requestedCount === null || batchCap !== MAX_RECIPIENTS) {
      return noStoreJson({ error: 'marketing_preview_failed', message: '발송 미리보기를 만들지 못했습니다.' }, { status: 502 });
    }
    return noStoreJson({ operationId, previewHash, expiresAt: storedExpiresAt, summary: { channel: previewRequest.channel, requestedCount, batchCap, title: previewRequest.title, message: previewRequest.message }, requiredConfirmation: CONFIRMATION_TEXT });
  }

  const applyRequest = apply(body);
  if (!applyRequest) return noStoreJson({ error: 'marketing_request_invalid', message: '확인 정보 또는 발송 내용이 올바르지 않습니다.' }, { status: 400 });

  const currentAdmin = await dependencies.requireAdmin();
  if (!currentAdmin.ok) {
    currentAdmin.response.headers.set('Cache-Control', 'no-store');
    return currentAdmin.response;
  }
  if (currentAdmin.userId !== initialAdminUserId) return noStoreJson({ error: 'marketing_permission_changed', message: '관리자 권한이 변경되었습니다.' }, { status: 403 });

  const client = dependencies.createServiceClient();
  const preparation = await rpc(client, 'prepare_marketing_campaign_batch', {
    p_operation_id: applyRequest.operationId,
    p_actor_user_id: currentAdmin.userId,
    p_preview_hash: applyRequest.previewHash,
    p_idempotency_key: applyRequest.idempotencyKey,
    p_batch_limit: MAX_RECIPIENTS,
    p_timezone: 'Asia/Seoul',
  });
  if (isMarketingRecord(preparation) && preparation.status === 'completed') {
    const finalReceipt = receipt(preparation.receipt);
    return finalReceipt?.readback.passed
      ? noStoreJson({ receipt: finalReceipt })
      : noStoreJson({ error: 'marketing_readback_failed', message: '발송 결과를 확인하지 못했습니다.' }, { status: 502 });
  }
  if (isMarketingRecord(preparation) && preparation.status === 'suppressed') {
    return noStoreJson({ status: 'suppressed', message: '현재 동의 또는 자격 조건에 따라 발송하지 않았습니다.', retryable: false });
  }

  const batch = prepared(preparation);
  if (!batch || batch.operationId !== applyRequest.operationId) {
    return noStoreJson({ error: 'marketing_apply_failed', message: '발송 준비를 완료하지 못했습니다. 재전송하지 않았습니다.', retryable: false }, { status: 502 });
  }

  const providerUrl = await resolveMarketingProviderUrl(dependencies.provider, dependencies.resolveDns);
  const providerToken = dependencies.provider?.token.trim();
  if (!providerUrl || !providerToken) {
    const failureReceipt = await recordPreEgressFailure(client, applyRequest, currentAdmin.userId, batch.batchId);
    return failureReceipt?.readback.passed
      ? noStoreJson({ receipt: failureReceipt, message: '제공자 연결이 준비되지 않아 발송하지 않았습니다.' }, { status: 503 })
      : noStoreJson({ error: 'marketing_failure_record_failed', message: '제공자 미준비 상태를 기록하지 못했습니다.', retryable: false }, { status: 502 });
  }

  // The RPC atomically revalidates consent and creates the unknown outbox attempt
  // before this handler can perform any provider-side effect.
  const claimResult = await rpc(client, 'claim_marketing_campaign_dispatch', {
    p_operation_id: applyRequest.operationId,
    p_batch_id: batch.batchId,
    p_actor_user_id: currentAdmin.userId,
    p_preview_hash: applyRequest.previewHash,
    p_idempotency_key: applyRequest.idempotencyKey,
    p_timezone: 'Asia/Seoul',
  });
  if (isMarketingRecord(claimResult) && claimResult.status === 'completed') {
    const finalReceipt = receipt(claimResult.receipt);
    return finalReceipt?.readback.passed
      ? noStoreJson({ receipt: finalReceipt })
      : noStoreJson({ error: 'marketing_readback_failed', message: '발송하지 않은 결과를 확인하지 못했습니다.' }, { status: 502 });
  }
  if (isMarketingRecord(claimResult) && claimResult.status === 'suppressed') {
    return noStoreJson({ status: 'suppressed', message: '발송 직전 동의 또는 자격 조건이 변경되어 발송하지 않았습니다.', retryable: false });
  }

  const claim = claimedDispatch(claimResult, batch);
  if (!claim) {
    return noStoreJson({ error: 'marketing_claim_failed', message: '발송 권한을 확정하지 못해 제공자에 요청하지 않았습니다.', retryable: false }, { status: 502 });
  }

  try {
    assertPrivacySafe([claim.payload.operationId, claim.payload.batchId, claim.payload.claimToken, claim.payload.providerAttemptId, claim.payload.idempotencyKey, claim.payload.channel, claim.payload.title, claim.payload.message, claim.payload.data, claim.payload.recipientUserIds]);
  } catch {
    return unknownOutcome();
  }

  let providerResponse: Response;
  try {
    providerResponse = await dependencies.fetch(providerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': claim.idempotencyKey,
        'X-Provider-Attempt-Id': claim.providerAttemptId,
        'X-Payload-Digest': claim.payloadDigest,
      },
      body: JSON.stringify(claim.payload),
      redirect: 'error',
      signal: AbortSignal.timeout(dependencies.providerTimeoutMs),
    });
  } catch {
    return unknownOutcome();
  }
  // A response without the stable echo is not proof that no delivery happened.
  if (!providerResponse.ok) return unknownOutcome();

  const providerBody = await readBoundedProviderJson(providerResponse, dependencies.providerTimeoutMs);
  const provider = providerResult(providerBody, claim);
  if (!provider) {
    const failure = providerFailure(providerBody, claim);
    if (!failure) return unknownOutcome();
    const failed = receipt(await rpc(client, 'fail_marketing_campaign_provider_attempt', {
      p_operation_id: applyRequest.operationId,
      p_batch_id: claim.batchId,
      p_actor_user_id: currentAdmin.userId,
      p_preview_hash: applyRequest.previewHash,
      p_claim_token: claim.claimToken,
      p_provider_attempt_id: claim.providerAttemptId,
      p_provider_receipt_id: failure.providerReceiptId,
      p_provider_receipt_hash: hashProviderReceipt(claim, failure.providerReceiptId, { status: 'failed', errorCode: failure.errorCode }),
      p_provider_payload_digest: failure.payloadDigest,
      p_error_code: failure.errorCode,
    }));
    return failed?.readback.passed
      ? noStoreJson({ receipt: failed, message: '제공자가 발송을 거부해 발송하지 않았습니다.' }, { status: 502 })
      : noStoreJson({ error: 'marketing_failure_readback_failed', message: '제공자 거부 결과를 확인하지 못했습니다. 재전송하지 않았습니다.', retryable: false }, { status: 502 });
  }

  const finalized = receipt(await rpc(client, 'finalize_marketing_campaign_batch', {
    p_operation_id: applyRequest.operationId,
    p_batch_id: claim.batchId,
    p_actor_user_id: currentAdmin.userId,
    p_preview_hash: applyRequest.previewHash,
    p_claim_token: claim.claimToken,
    p_provider_attempt_id: claim.providerAttemptId,
    p_provider_receipt_id: provider.providerReceiptId,
    p_provider_receipt_hash: hashProviderReceipt(claim, provider.providerReceiptId, {
      status: 'accepted',
      acceptedRecipientDigest: provider.acceptedRecipientDigest,
    }),
    p_provider_payload_digest: provider.payloadDigest,
    p_accepted_user_ids: provider.acceptedRecipientIds,
    p_timezone: 'Asia/Seoul',
  }));
  return finalized?.readback.passed
    ? noStoreJson({ receipt: finalized })
    : noStoreJson({ error: 'marketing_readback_failed', message: '제공자 응답을 기록한 뒤 발송 결과를 확인하지 못했습니다. 재전송하지 않았습니다.', retryable: false }, { status: 502 });
}

export function createMarketingCampaignPost(
  overrides: Partial<MarketingCampaignRouteDependencies> = {},
) {
  const dependencies = { ...productionMarketingRouteDependencies, ...overrides };
  return async (request: NextRequest) => {
    const initialAdmin = await dependencies.requireAdmin();
    if (!initialAdmin.ok) {
      initialAdmin.response.headers.set('Cache-Control', 'no-store');
      return initialAdmin.response;
    }
    if (!isTrustedSameOriginMutation(request)) {
      return noStoreJson({ error: 'marketing_request_invalid', message: '요청 형식이 올바르지 않습니다.' }, { status: 403 });
    }

    const bodyResult = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    if (!bodyResult.ok) {
      return noStoreJson({ error: 'marketing_request_invalid', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
    }
    return handleMarketingCampaignRequest(initialAdmin.userId, bodyResult.value, dependencies);
  };
}

