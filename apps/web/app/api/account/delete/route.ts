import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import {
  isAccountDeletionConfirmation,
  isAccountDeletionPreviewHash,
  isAccountDeletionRequestId,
  isAccountDeletionSourceManifestHash,
  MAX_ACCOUNT_DELETION_STORAGE_RECEIPT_REFS,
  parseAccountDeletionReceipt,
  parseAccountDeletionPreview,
  type AccountDeletionCounts,
  type AccountDeletionReceipt,
  type AccountDeletionStorageReceiptRef,
} from '@/lib/privacy/account-deletion';
import {
  bearerTokenFromAuthorization,
  parseAccountDeletionReauthRequest,
} from '@/lib/privacy/account-deletion-reauth';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import type { Database } from '@/integrations/supabase/types';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
type AccountDeletionApplyRequest = Readonly<{
  userId: string;
  proofId: string;
  requestId: string;
  previewHash: string;
  confirmationText: string;
  idempotencyKey: string;
  sourceManifestHash: string;
}>;

const parseAccountDeletionApplyRequest = (
  value: unknown,
): AccountDeletionApplyRequest | null => {
  const reauth = isRecord(value)
    ? parseAccountDeletionReauthRequest({
      userId: value.userId,
      proofId: value.proofId,
      requestId: value.requestId,
      idempotencyKey: value.idempotencyKey,
    })
    : null;
  if (
    !reauth
    || !isRecord(value)
    || !hasOnlyKeys(value, [
      'userId',
      'proofId',
      'requestId',
      'previewHash',
      'confirmationText',
      'idempotencyKey',
      'sourceManifestHash',
    ])
    || Object.keys(value).length !== 7
    || !isAccountDeletionPreviewHash(value.previewHash)
    || !isAccountDeletionConfirmation(value.confirmationText)
    || !isAccountDeletionSourceManifestHash(value.sourceManifestHash)
  ) {
    return null;
  }

  return {
    ...reauth,
    previewHash: value.previewHash,
    confirmationText: value.confirmationText,
    sourceManifestHash: value.sourceManifestHash,
  };
};



export const runtime = 'nodejs';

type RpcRow = Record<string, unknown>;
type AccountDeletionStatusQuery = Readonly<{
  requestId: string;
  previewHash: string;
  sourceManifestHash: string;
}>;

const FAILURE_MESSAGES: Record<string, string> = {
  ACTOR_NOT_ALLOWED: '다른 사용자의 계정 삭제는 관리자만 요청할 수 있습니다.',
  ACTOR_OR_TARGET_REQUIRED: '계정 삭제 요청 정보가 올바르지 않습니다.',
  AUTH_CLEANUP_FAILED: '인증 계정 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
  AUTH_READBACK_PASSED: '인증 계정 삭제 확인이 진행 중입니다.',
  APPLIED: '계정 삭제 처리가 확인되었습니다.',
  APPLY_STARTED: '계정 삭제 요청을 처리하고 있습니다.',
  APPLY_NOT_STARTED: '계정 삭제 요청을 시작하지 못했습니다.',
  DB_READBACK_PASSED: '계정 데이터 삭제 확인이 진행 중입니다.',
  DB_AND_SESSION_READBACK_PASSED: '세션 삭제 확인이 진행 중입니다.',
  DB_CLEANUP_FAILED: '계정 데이터 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
  DB_OR_SESSION_CLEANUP_FAILED: '계정 데이터 또는 세션 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
  IDEMPOTENCY_KEY_MISMATCH: '같은 삭제 요청에는 같은 재시도 키가 필요합니다.',
  INVALID_APPLY_REQUEST: '계정 삭제 요청 정보가 올바르지 않습니다.',
  LAST_ADMIN_PROTECTED: '마지막 활성 관리자의 계정은 삭제할 수 없습니다.',
  LEGAL_HOLD_ACTIVE: '보류 중인 계정 삭제 요청이 있어 처리할 수 없습니다.',
  POLICY_CHANGED: '삭제 기준이 변경되었습니다. 미리보기를 다시 요청해 주세요.',
  POLICY_UNAVAILABLE: '현재 계정 삭제 기준을 확인할 수 없습니다.',
  PREVIEW_EXPIRED: '삭제 미리보기 유효 시간이 지났습니다. 다시 확인해 주세요.',
  PREVIEW_NOT_FOUND: '삭제 미리보기를 찾을 수 없습니다. 다시 확인해 주세요.',
  PREVIEW_READY: '계정 삭제 요청을 준비했습니다.',
  REAUTH_PROOF_UNAVAILABLE: '세션 기반 재인증 보안 확인을 사용할 수 없어 계정 삭제를 현재 진행할 수 없습니다.',
  REAUTH_REQUIRED: '최근 로그인 확인이 필요합니다. 다시 로그인한 뒤 재시도해 주세요.',
  REPLAYED_PREVIEW: '이미 사용된 삭제 미리보기입니다.',
  RETENTION_POLICY_UNAVAILABLE: '보존 분리 기준을 확인할 수 없어 계정 삭제를 진행하지 않았습니다.',
  SESSION_READBACK_REQUIRED: '세션 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
  STORAGE_CLEANUP_FAILED: '저장 파일 정리를 확인하지 못했습니다. 계정 삭제가 완료되지 않았습니다.',
  STORAGE_READBACK_PASSED: '저장 파일 삭제 확인이 진행 중입니다.',
  TARGET_NOT_FOUND: '대상 계정을 찾을 수 없습니다.',
};
const REAUTH_FAILURE_REASON_CODES: Record<string, keyof typeof FAILURE_MESSAGES> = {
  account_deletion_reauth_proof_invalid_actor: 'REAUTH_REQUIRED',
  account_deletion_reauth_proof_invalid_claims: 'REAUTH_REQUIRED',
  account_deletion_reauth_proof_missing_compatibility_reauthentication: 'REAUTH_REQUIRED',
  account_deletion_reauth_proof_not_available: 'REAUTH_PROOF_UNAVAILABLE',
  account_deletion_reauth_proof_password_reauthentication_required: 'REAUTH_REQUIRED',
};
const ACCOUNT_DELETION_STATUS_QUERY_KEYS = [
  'requestId',
  'previewHash',
  'sourceManifestHash',
] as const;

const isRecord = (value: unknown): value is RpcRow =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: RpcRow, allowedKeys: readonly string[]) =>
  Object.keys(value).every((key) => allowedKeys.includes(key));
const isAccountDeletionStatusQuery = (
  request: NextRequest,
): AccountDeletionStatusQuery | null => {
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].length !== ACCOUNT_DELETION_STATUS_QUERY_KEYS.length
    || ![...query.keys()].every((key) =>
      ACCOUNT_DELETION_STATUS_QUERY_KEYS.includes(
        key as (typeof ACCOUNT_DELETION_STATUS_QUERY_KEYS)[number],
      ))
    || ACCOUNT_DELETION_STATUS_QUERY_KEYS.some((key) => query.getAll(key).length !== 1)
  ) {
    return null;
  }

  const requestId = query.get('requestId');
  const previewHash = query.get('previewHash');
  const sourceManifestHash = query.get('sourceManifestHash');
  return isAccountDeletionRequestId(requestId)
    && isAccountDeletionPreviewHash(previewHash)
    && isAccountDeletionSourceManifestHash(sourceManifestHash)
    ? { requestId, previewHash, sourceManifestHash }
    : null;
};
const hasEmptyGetBody = (request: NextRequest) => {
  const contentLength = request.headers.get('content-length');
  return request.body === null
    && !request.headers.has('transfer-encoding')
    && (contentLength === null || contentLength === '0');
};

const asSingleRow = (value: unknown): RpcRow | null =>
  Array.isArray(value) && value.length === 1 && isRecord(value[0]) ? value[0] : null;
const ACCOUNT_DELETION_DATABASE_CLEANUP_ROW_KEYS = [
  'request_id',
  'status',
  'reason_code',
  'db_readback_passed',
  'session_readback_passed',
  'source_manifest_hash',
] as const;
const isAccountDeletionDatabaseCleanupRow = (
  value: unknown,
  request: AccountDeletionApplyRequest,
): value is RpcRow => {
  if (
    !isRecord(value)
    || Object.keys(value).length !== ACCOUNT_DELETION_DATABASE_CLEANUP_ROW_KEYS.length
    || !hasOnlyKeys(value, ACCOUNT_DELETION_DATABASE_CLEANUP_ROW_KEYS)
  ) {
    return false;
  }

  return value.request_id === request.requestId
    && value.status === 'applying'
    && value.reason_code === 'DB_READBACK_PASSED'
    && value.db_readback_passed === true
    && value.session_readback_passed === false
    && value.source_manifest_hash === request.sourceManifestHash;
};
const idempotencyKeyBindingSha256 = (idempotencyKey: string) =>
  createHash('sha256')
    .update(`g038-account-deletion-idempotency-binding:v1\n${idempotencyKey}`, 'utf8')
    .digest('hex');

const asSafeCount = (value: unknown): number | null =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= 0
  && value <= 2_147_483_647
    ? value
    : null;

const countsFromRow = (row: RpcRow): AccountDeletionCounts | null => {
  const deleteCount = asSafeCount(row.delete_count);
  const anonymizeCount = asSafeCount(row.anonymize_count);
  const separateCount = asSafeCount(row.separate_count);
  const retainCount = asSafeCount(row.retain_count);
  if (
    deleteCount === null
    || anonymizeCount === null
    || separateCount === null
    || retainCount === null
  ) {
    return null;
  }

  return {
    delete: deleteCount,
    anonymize: anonymizeCount,
    separate: separateCount,
    retain: retainCount,
  };
};

const rpcFailureReasonCode = (error: unknown): keyof typeof FAILURE_MESSAGES | null => {
  if (!isRecord(error)) return null;
  const message = error.message;
  return typeof message === 'string' && Object.hasOwn(REAUTH_FAILURE_REASON_CODES, message)
    ? REAUTH_FAILURE_REASON_CODES[message]
    : null;
};

const noStoreJson = (body: unknown, init: ResponseInit = {}) => {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

const failureResponse = (reasonCode: unknown, status = 409) => {
  if (typeof reasonCode !== 'string' || !Object.hasOwn(FAILURE_MESSAGES, reasonCode)) {
    return noStoreJson({ error: FAILURE_MESSAGES.DB_OR_SESSION_CLEANUP_FAILED }, { status: 500 });
  }

  return noStoreJson(
    { error: FAILURE_MESSAGES[reasonCode], reasonCode },
    { status },
  );
};
const serverFailureResponse = () =>
  noStoreJson(
    { error: FAILURE_MESSAGES.DB_OR_SESSION_CLEANUP_FAILED, reasonCode: 'DB_OR_SESSION_CLEANUP_FAILED' },
    { status: 500 },
  );
const createBearerClient = (bearerToken: string) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
  });
};
const readCurrentAccountDeletionStatus = async (
  query: AccountDeletionStatusQuery,
) => {
  const sessionClient = await createServerClient();
  return sessionClient.rpc('read_current_account_deletion_status', {
    p_request_id: query.requestId,
    p_preview_hash: query.previewHash,
    p_source_manifest_hash: query.sourceManifestHash,
  });
};

const isBoundedProviderReceiptReference = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/.test(value);

const storageReceiptRefsFromRow = (
  value: unknown,
): readonly AccountDeletionStorageReceiptRef[] | null => {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNT_DELETION_STORAGE_RECEIPT_REFS) return null;

  const objectLocators = new Set<string>();
  const providerReceiptRefs = new Set<string>();
  const receiptRefs: AccountDeletionStorageReceiptRef[] = [];
  for (const receipt of value) {
    if (
      !isRecord(receipt)
      || Object.keys(receipt).length !== 4
      || !hasOnlyKeys(receipt, [
        'object_locator_hash',
        'object_version_hash',
        'provider_receipt_ref',
        'provider_receipt_hash',
      ])
    ) {
      return null;
    }

    const objectLocatorHash = receipt.object_locator_hash;
    const objectVersionHash = receipt.object_version_hash;
    const providerReceiptRef = receipt.provider_receipt_ref;
    const providerReceiptHash = receipt.provider_receipt_hash;
    if (
      !isAccountDeletionSourceManifestHash(objectLocatorHash)
      || !isAccountDeletionSourceManifestHash(objectVersionHash)
      || !isBoundedProviderReceiptReference(providerReceiptRef)
      || !isAccountDeletionSourceManifestHash(providerReceiptHash)
      || objectLocators.has(objectLocatorHash)
      || providerReceiptRefs.has(providerReceiptRef)
    ) {
      return null;
    }

    objectLocators.add(objectLocatorHash);
    providerReceiptRefs.add(providerReceiptRef);
    receiptRefs.push({
      objectLocatorHash,
      objectVersionHash,
      providerReceiptRef,
      providerReceiptHash,
    });
  }

  return receiptRefs;
};

const OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS = [
  'request_id',
  'status',
  'reason_code',
  'delete_count',
  'anonymize_count',
  'separate_count',
  'retain_count',
  'db_readback_passed',
  'storage_readback_passed',
  'session_readback_passed',
  'auth_readback_passed',
  'storage_receipt_refs',
  'auth_receipt_ref',
  'source_manifest_hash',
  'idempotency_key_binding_sha256',
] as const;
const OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS_WITHOUT_IDEMPOTENCY_BINDING =
  OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS.filter(
    (key) => key !== 'idempotency_key_binding_sha256',
  );
type AccountDeletionOwnerStatus =
  | Readonly<{
    status: 'applied';
    reasonCode: 'APPLIED';
    counts: AccountDeletionCounts;
    receipt: AccountDeletionReceipt;
  }>
  | Readonly<{
    status: 'in_progress' | 'partial' | 'failed';
    reasonCode: string;
    counts: AccountDeletionCounts;
  }>;
const ownerStatusFromRow = (
  row: RpcRow,
  query: AccountDeletionStatusQuery,
  idempotencyKeyBinding: string | null,
): AccountDeletionOwnerStatus | null => {
  if (
    Object.keys(row).length !== (
      idempotencyKeyBinding === null && !Object.hasOwn(row, 'idempotency_key_binding_sha256')
        ? OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS_WITHOUT_IDEMPOTENCY_BINDING.length
        : OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS.length
    )
    || !hasOnlyKeys(
      row,
      idempotencyKeyBinding === null && !Object.hasOwn(row, 'idempotency_key_binding_sha256')
        ? OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS_WITHOUT_IDEMPOTENCY_BINDING
        : OWNER_ACCOUNT_DELETION_STATUS_ROW_KEYS,
    )
    || row.request_id !== query.requestId
    || row.source_manifest_hash !== query.sourceManifestHash
    || !countsFromRow(row)
    || typeof row.reason_code !== 'string'
    || !Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, row.reason_code)
    || typeof row.db_readback_passed !== 'boolean'
    || typeof row.storage_readback_passed !== 'boolean'
    || typeof row.session_readback_passed !== 'boolean'
    || typeof row.auth_readback_passed !== 'boolean'
    || (idempotencyKeyBinding !== null && (
      typeof row.idempotency_key_binding_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(row.idempotency_key_binding_sha256)
      || row.idempotency_key_binding_sha256 !== idempotencyKeyBinding
    ))
  ) {
    return null;
  }

  const counts = countsFromRow(row);
  if (!counts) return null;

  if (row.status === 'applied') {
    if (row.reason_code !== 'APPLIED') return null;
    const receipt = parseAccountDeletionReceipt({
      requestId: row.request_id,
      status: row.status,
      reasonCode: row.reason_code,
      sourceManifestHash: row.source_manifest_hash,
      counts,
      readback: {
        database: row.db_readback_passed,
        storage: row.storage_readback_passed,
        sessions: row.session_readback_passed,
        auth: row.auth_readback_passed,
      },
      storageReceiptRefs: storageReceiptRefsFromRow(row.storage_receipt_refs),
      authReceiptRef: row.auth_receipt_ref,
    });
    return receipt
      && receipt.requestId === query.requestId
      && receipt.sourceManifestHash === query.sourceManifestHash
      ? { status: 'applied', reasonCode: 'APPLIED', counts, receipt }
      : null;
  }

  if (
    (row.status !== 'applying' && row.status !== 'partial' && row.status !== 'failed')
    || row.auth_readback_passed
    || row.auth_receipt_ref !== null
  ) {
    return null;
  }

  return {
    status: row.status === 'partial' || row.status === 'failed'
      ? row.status
      : 'in_progress',
    reasonCode: row.reason_code,
    counts,
  };
};

const ACCOUNT_DELETION_PREVIEW_ROW_KEYS = [
  'request_id',
  'preview_hash',
  'preview_expires_at',
  'policy_version',
  'status',
  'reason_code',
  'delete_count',
  'anonymize_count',
  'separate_count',
  'retain_count',
  'source_manifest_hash',
] as const;
const previewFromRow = (row: RpcRow) => {
  if (
    Object.keys(row).length !== ACCOUNT_DELETION_PREVIEW_ROW_KEYS.length
    || !hasOnlyKeys(row, ACCOUNT_DELETION_PREVIEW_ROW_KEYS)
    || row.status !== 'previewed'
    || row.reason_code !== 'PREVIEW_READY'
  ) {
    return null;
  }

  return parseAccountDeletionPreview({
    requestId: row.request_id,
    previewHash: row.preview_hash,
    expiresAt: row.preview_expires_at,
    policyVersion: row.policy_version,
    sourceManifestHash: row.source_manifest_hash,
    counts: countsFromRow(row),
  });
};
const isAccountDeletionPreviewRequest = (
  value: unknown,
): value is Readonly<{ targetUserId: string }> =>
  isRecord(value)
  && Object.keys(value).length === 1
  && hasOnlyKeys(value, ['targetUserId'])
  && isAccountDeletionRequestId(value.targetUserId);
const previewAccountDeletion = async (request: NextRequest) => {
  if (!isTrustedSameOriginMutation(request)) {
    return failureResponse('INVALID_APPLY_REQUEST', 403);
  }

  const body = await request.json().catch(() => null);
  if (!isAccountDeletionPreviewRequest(body)) {
    return failureResponse('INVALID_APPLY_REQUEST', 400);
  }

  const bearerToken = bearerTokenFromAuthorization(request.headers.get('Authorization'));
  if (!bearerToken) return noStoreJson({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const supabase = createSupabaseServiceRoleClient();
    const [
      { data: { user }, error: userError },
      { data: claims, error: claimsError },
    ] = await Promise.all([
      supabase.auth.getUser(bearerToken),
      supabase.auth.getClaims(bearerToken),
    ]);
    if (
      userError
      || claimsError
      || !user
      || claims?.claims.sub !== user.id
      || body.targetUserId !== user.id
      || typeof user.last_sign_in_at !== 'string'
    ) {
      return noStoreJson({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const result = await supabase.rpc('preview_account_deletion', {
      p_actor_user_id: user.id,
      p_target_user_id: user.id,
      p_reauthenticated_at: user.last_sign_in_at,
    });
    const preview = result.error ? null : previewFromRow(asSingleRow(result.data) ?? {});
    return preview
      ? noStoreJson({ preview })
      : failureResponse('REAUTH_REQUIRED', 409);
  } catch {
    return serverFailureResponse();
  }
};

const deleteAccount = async (request: NextRequest) => {
  if (!isTrustedSameOriginMutation(request)) {
    return failureResponse('INVALID_APPLY_REQUEST', 403);
  }

  const body = parseAccountDeletionApplyRequest(await request.json().catch(() => null));
  if (!body) return failureResponse('INVALID_APPLY_REQUEST', 400);

  const bearerToken = bearerTokenFromAuthorization(request.headers.get('Authorization'));
  if (!bearerToken) return noStoreJson({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {

    const supabaseAdmin = createSupabaseServiceRoleClient();
    const [
      { data: { user }, error: userError },
      { data: claims, error: claimsError },
    ] = await Promise.all([
      supabaseAdmin.auth.getUser(bearerToken),
      supabaseAdmin.auth.getClaims(bearerToken),
    ]);
    if (userError || claimsError || !user || claims?.claims.sub !== user.id) {
      return noStoreJson({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (body.userId !== user.id) {
      return failureResponse('ACTOR_NOT_ALLOWED', 403);
    }

    const supabase = createBearerClient(bearerToken);
    const statusQuery = {
      requestId: body.requestId,
      previewHash: body.previewHash,
      sourceManifestHash: body.sourceManifestHash,
    };
    const idempotencyKeyBinding = idempotencyKeyBindingSha256(body.idempotencyKey);
    const replayReadbackResult = await supabase.rpc('read_current_account_deletion_status', {
      p_request_id: body.requestId,
      p_preview_hash: body.previewHash,
      p_source_manifest_hash: body.sourceManifestHash,
    });
    if (replayReadbackResult.error) return serverFailureResponse();

    const replayReadback = asSingleRow(replayReadbackResult.data);
    if (!replayReadback && (!Array.isArray(replayReadbackResult.data) || replayReadbackResult.data.length !== 0)) {
      return serverFailureResponse();
    }

    if (replayReadback) {
      const replayStatus = ownerStatusFromRow(
        replayReadback,
        statusQuery,
        idempotencyKeyBinding,
      );
      if (!replayStatus) return serverFailureResponse();

      if (
        replayStatus.status === 'in_progress'
        && replayReadback.reason_code === 'DB_READBACK_PASSED'
        && replayReadback.db_readback_passed === true
        && replayReadback.storage_readback_passed === false
        && replayReadback.session_readback_passed === false
        && replayReadback.auth_readback_passed === false
      ) {
        return noStoreJson({ status: 'accepted', begin: replayStatus }, { status: 202 });
      }

      if (
        replayReadback.db_readback_passed
        || replayReadback.storage_readback_passed
        || replayReadback.session_readback_passed
        || replayReadback.auth_readback_passed
        || replayStatus.status !== 'in_progress'
        || replayReadback.reason_code !== 'APPLY_STARTED'
      ) {
        return serverFailureResponse();
      }
    }

    const result = await supabase.rpc('begin_account_deletion_apply_with_reauth', {
      p_proof_id: body.proofId,
      p_actor_user_id: user.id,
      p_target_user_id: body.userId,
      p_request_id: body.requestId,
      p_preview_hash: body.previewHash,
      p_confirmation_text: body.confirmationText,
      p_idempotency_key: body.idempotencyKey,
      p_source_manifest_hash: body.sourceManifestHash,
    });
    const begin = asSingleRow(result.data);
    if (result.error) {
      const reasonCode = rpcFailureReasonCode(result.error);
      return reasonCode ? failureResponse(reasonCode) : serverFailureResponse();
    }
    if (!begin || begin.reason_code !== 'APPLY_STARTED') return serverFailureResponse();

    const beginStatus = ownerStatusFromRow(begin, statusQuery, null);
    if (!beginStatus || beginStatus.status !== 'in_progress') return serverFailureResponse();

    const cleanupResult = await supabaseAdmin.rpc('apply_account_deletion_database_cleanup', {
      p_actor_user_id: user.id,
      p_target_user_id: body.userId,
      p_request_id: body.requestId,
      p_preview_hash: body.previewHash,
      p_idempotency_key: body.idempotencyKey,
      p_source_manifest_hash: body.sourceManifestHash,
    });
    const cleanup = asSingleRow(cleanupResult.data);
    if (cleanupResult.error || !isAccountDeletionDatabaseCleanupRow(cleanup, body)) {
      return serverFailureResponse();
    }

    const readbackResult = await supabase.rpc('read_current_account_deletion_status', {
      p_request_id: body.requestId,
      p_preview_hash: body.previewHash,
      p_source_manifest_hash: body.sourceManifestHash,
    });
    const readback = asSingleRow(readbackResult.data);
    if (readbackResult.error || !readback) return serverFailureResponse();

    const status = ownerStatusFromRow(readback, statusQuery, idempotencyKeyBinding);
    if (!status || status.status !== 'in_progress' || !readback.db_readback_passed) {
      return serverFailureResponse();
    }

    return noStoreJson({ status: 'accepted', begin: status }, { status: 202 });
  } catch {
    return serverFailureResponse();
  }
};

export async function POST(request: NextRequest) {
  return previewAccountDeletion(request);
}

export async function GET(request: NextRequest) {
  if (!hasEmptyGetBody(request)) {
    return failureResponse('INVALID_APPLY_REQUEST', 400);
  }

  const query = isAccountDeletionStatusQuery(request);
  if (!query) return failureResponse('INVALID_APPLY_REQUEST', 400);

  let result: Readonly<{ data: unknown; error: unknown }>;
  try {
    result = await readCurrentAccountDeletionStatus(query);
  } catch {
    return serverFailureResponse();
  }

  const row = asSingleRow(result.data);
  if (result.error || !row) return failureResponse('PREVIEW_NOT_FOUND', 404);

  const status = ownerStatusFromRow(row, query, null);
  if (!status) return serverFailureResponse();

  if (status.status === 'applied') {
    return noStoreJson(status);
  }

  return noStoreJson(
    status,
    { status: status.status === 'in_progress' ? 202 : 409 },
  );
}
export const DELETE = deleteAccount;
