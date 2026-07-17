import { createHash, timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  MAX_PRIVACY_RETENTION_BATCH_SIZE,
  MAX_PRIVACY_RETENTION_RUNTIME_MS,
  PrivacyRetentionRunnerError,
  applyRetentionRun,
  previewRetentionRun,
  type PrivacyRetentionProvider,
  type PrivacyRetentionProviderProof,
  type PrivacyRetentionRpcClient,
} from '@/lib/privacy/retention-runner';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { Json } from '@/integrations/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 1024;
const CAPABILITY_HEADER = 'x-privacy-retention-capability';
const PROVIDER_CAPABILITY_HEADER = 'x-privacy-retention-provider-capability';
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const;

type RetentionRequest =
  | Readonly<{
      action: 'preview';
      classCode: string;
      asOf: string;
      batchSize?: number;
    }>
  | Readonly<{
      action: 'apply';
      operationId: string;
      previewHash: string;
      confirmationText: string;
      idempotencyKey: string;
      adapterVersion: string;
      sourceMappingVersion: string;
      batchSize?: number;
    }>;
type ParsedJsonBody =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 };

const PREVIEW_REQUEST_KEYS = ['action', 'classCode', 'asOf'] as const;
const PREVIEW_REQUEST_WITH_BATCH_KEYS = ['action', 'classCode', 'asOf', 'batchSize'] as const;
const APPLY_REQUEST_KEYS = ['action', 'operationId', 'previewHash', 'confirmationText', 'idempotencyKey', 'adapterVersion', 'sourceMappingVersion'] as const;
const APPLY_REQUEST_WITH_BATCH_KEYS = ['action', 'operationId', 'previewHash', 'confirmationText', 'idempotencyKey', 'adapterVersion', 'sourceMappingVersion', 'batchSize'] as const;

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    headers.set(name, value);
  }
  return NextResponse.json(body, { ...init, headers });
};

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** Compares fixed-length digests so no capability value is exposed by timing. */
const hasValidRetentionCapability = (candidate: string | null, expected: string | undefined): boolean => {
  if (!candidate || !expected || expected.length < 32) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
};

const isBrowserOrSessionRequest = (request: NextRequest): boolean => {
  const fetchMode = request.headers.get('sec-fetch-mode');
  return Boolean(
    request.headers.get('authorization')
    || request.headers.get('cookie')
    || request.headers.get('origin')
    || request.headers.get('referer')
    || request.headers.get('sec-fetch-site')
    || request.headers.get('sec-fetch-dest')
    || request.headers.get('sec-fetch-user'),
  ) || (fetchMode !== null && fetchMode !== 'cors');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const readBoundedJsonBody = async (request: NextRequest): Promise<ParsedJsonBody> => {
  const contentLength = request.headers.get('content-length');
  if (
    contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    return { ok: false, status: 413 };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400 };
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413 };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
};
const providerUrl = (value: string | undefined): URL | null => {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
};

const readBoundedProviderResponse = async (response: Response): Promise<unknown | null> => {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES)
  ) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
};

const privateProvider = (): PrivacyRetentionProvider | null => {
  const deleteUrl = providerUrl(process.env.PRIVACY_RETENTION_PROVIDER_DELETE_URL);
  const verifierUrl = providerUrl(process.env.PRIVACY_RETENTION_PROVIDER_VERIFIER_URL);
  const deleteCapability = process.env.PRIVACY_RETENTION_PROVIDER_DELETE_CAPABILITY;
  const verifierCapability = process.env.PRIVACY_RETENTION_PROVIDER_VERIFIER_CAPABILITY;
  const verifierRef = process.env.PRIVACY_RETENTION_PROVIDER_VERIFIER_REF;
  if (
    !deleteUrl
    || !verifierUrl
    || deleteUrl.href === verifierUrl.href
    || !deleteCapability
    || deleteCapability.length < 32
    || !verifierCapability
    || verifierCapability.length < 32
    || !verifierRef
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(verifierRef)
  ) {
    return null;
  }
  if (timingSafeEqual(digest(deleteCapability), digest(verifierCapability))) {
    return null;
  }

  const post = async (
    url: URL,
    capability: string,
    body: Record<string, string>,
  ): Promise<Response> => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [PROVIDER_CAPABILITY_HEADER]: capability,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new PrivacyRetentionRunnerError('privacy_retention_provider_unavailable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PrivacyRetentionRunnerError('privacy_retention_provider_unavailable');
    }
    return response;
  };

  return {
    verifierRef,
    deleteExactVersion: async ({
      bucketName,
      objectName,
      objectVersionHash,
      providerEffectToken,
      leaseExpiresAt,
    }) => {
      const response = await post(deleteUrl, deleteCapability, {
        bucketName,
        objectName,
        objectVersionHash,
        providerEffectToken,
        leaseExpiresAt,
      });
      await response.body?.cancel();
    },
    verifyAbsent: async ({
      objectLocatorHash,
      objectVersionHash,
      providerEffectToken,
    }): Promise<PrivacyRetentionProviderProof | null> => {
      const response = await post(verifierUrl, verifierCapability, {
        objectLocatorHash,
        objectVersionHash,
        providerEffectToken,
      });
      const value = await readBoundedProviderResponse(response);
      if (
        !isRecord(value)
        || !hasExactKeys(value, ['providerReceiptRef', 'providerReceiptHash', 'providerAbsenceHash'])
        || typeof value.providerReceiptRef !== 'string'
        || typeof value.providerReceiptHash !== 'string'
        || typeof value.providerAbsenceHash !== 'string'
      ) {
        return null;
      }
      return {
        providerReceiptRef: value.providerReceiptRef,
        providerReceiptHash: value.providerReceiptHash,
        providerAbsenceHash: value.providerAbsenceHash,
      };
    },
  };
};


const boundedBatchSize = (value: unknown): number => {
  if (value === undefined) return MAX_PRIVACY_RETENTION_BATCH_SIZE;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PRIVACY_RETENTION_BATCH_SIZE) {
    throw new PrivacyRetentionRunnerError('privacy_retention_batch_invalid');
  }
  return value;
};

const readRequest = async (request: NextRequest): Promise<RetentionRequest> => {
  const parsed = await readBoundedJsonBody(request);
  if (!parsed.ok) {
    throw new PrivacyRetentionRunnerError(
      parsed.status === 413 ? 'privacy_retention_request_too_large' : 'privacy_retention_request_invalid',
    );
  }

  const value = parsed.value;
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw new PrivacyRetentionRunnerError('privacy_retention_request_invalid');
  }

  if (
    value.action === 'preview'
    && hasExactKeys(
      value,
      Object.prototype.hasOwnProperty.call(value, 'batchSize')
        ? PREVIEW_REQUEST_WITH_BATCH_KEYS
        : PREVIEW_REQUEST_KEYS,
    )
    && typeof value.classCode === 'string'
    && typeof value.asOf === 'string'
  ) {
    return {
      action: 'preview',
      classCode: value.classCode,
      asOf: value.asOf,
      batchSize: boundedBatchSize(value.batchSize),
    };
  }

  if (
    value.action === 'apply'
    && hasExactKeys(
      value,
      Object.prototype.hasOwnProperty.call(value, 'batchSize')
        ? APPLY_REQUEST_WITH_BATCH_KEYS
        : APPLY_REQUEST_KEYS,
    )
    && typeof value.operationId === 'string'
    && typeof value.previewHash === 'string'
    && typeof value.confirmationText === 'string'
    && typeof value.idempotencyKey === 'string'
    && typeof value.adapterVersion === 'string'
    && typeof value.sourceMappingVersion === 'string'
  ) {
    return {
      action: 'apply',
      operationId: value.operationId,
      previewHash: value.previewHash,
      confirmationText: value.confirmationText,
      idempotencyKey: value.idempotencyKey,
      adapterVersion: value.adapterVersion,
      sourceMappingVersion: value.sourceMappingVersion,
      batchSize: boundedBatchSize(value.batchSize),
    };
  }

  throw new PrivacyRetentionRunnerError('privacy_retention_request_invalid');
};

const withRuntimeLimit = async <T,>(operation: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new PrivacyRetentionRunnerError('privacy_retention_timeout')), MAX_PRIVACY_RETENTION_RUNTIME_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const isJsonValue = (value: unknown): value is Json => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  return Array.isArray(value)
    ? value.every(isJsonValue)
    : isRecord(value) && Object.values(value).every(isJsonValue);
};

const stringRpcArgument = (args: Record<string, unknown>, name: string): string | undefined => {
  const value = args[name];
  return typeof value === 'string' ? value : undefined;
};

const numberRpcArgument = (args: Record<string, unknown>, name: string): number | undefined => {
  const value = args[name];
  return typeof value === 'number' ? value : undefined;
};

const invalidRetentionRpcRequest = () => Promise.resolve({
  data: null,
  error: new Error('Unsupported privacy retention RPC request'),
});

const retentionRpcClient = (): PrivacyRetentionRpcClient => {
  const client = createSupabaseServiceRoleClient();
  return {
    async rpc(functionName, args) {
      switch (functionName) {
        case 'preview_privacy_retention_run': {
          const classCode = stringRpcArgument(args, 'p_class_code');
          const asOf = stringRpcArgument(args, 'p_as_of');
          const batchSize = numberRpcArgument(args, 'p_batch_size');
          const maxDurationMs = args.p_max_duration_ms;
          if (
            classCode === undefined
            || asOf === undefined
            || batchSize === undefined
            || (maxDurationMs !== undefined && typeof maxDurationMs !== 'number')
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('preview_privacy_retention_run', {
            p_class_code: classCode,
            p_as_of: asOf,
            p_batch_size: batchSize,
            ...(typeof maxDurationMs === 'number' ? { p_max_duration_ms: maxDurationMs } : {}),
          });
        }
        case 'confirm_privacy_retention_run': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const confirmationText = stringRpcArgument(args, 'p_confirmation_text');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          if (
            runId === undefined
            || previewHash === undefined
            || confirmationText === undefined
            || idempotencyKey === undefined
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('confirm_privacy_retention_run', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_confirmation_text: confirmationText,
            p_idempotency_key: idempotencyKey,
          });
        }
        case 'apply_privacy_retention_run': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          const maxDurationMs = args.p_max_duration_ms;
          if (
            runId === undefined
            || previewHash === undefined
            || idempotencyKey === undefined
            || (maxDurationMs !== undefined && typeof maxDurationMs !== 'number')
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('apply_privacy_retention_run', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_idempotency_key: idempotencyKey,
            ...(typeof maxDurationMs === 'number' ? { p_max_duration_ms: maxDurationMs } : {}),
          });
        }
        case 'claim_privacy_retention_storage_items': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          const limit = numberRpcArgument(args, 'p_limit');
          if (
            runId === undefined
            || previewHash === undefined
            || idempotencyKey === undefined
            || limit === undefined
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('claim_privacy_retention_storage_items', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_idempotency_key: idempotencyKey,
            p_limit: limit,
          });
        }
        case 'resolve_privacy_retention_provider_effect': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          const workItemId = stringRpcArgument(args, 'p_work_item_id');
          const claimToken = stringRpcArgument(args, 'p_claim_token');
          const claimHash = stringRpcArgument(args, 'p_claim_hash');
          const objectLocatorHash = stringRpcArgument(args, 'p_object_locator_hash');
          const objectVersionHash = stringRpcArgument(args, 'p_object_version_hash');
          const adapterVersion = stringRpcArgument(args, 'p_adapter_version');
          const sourceMappingVersion = stringRpcArgument(args, 'p_source_mapping_version');
          const providerVerifierRef = stringRpcArgument(args, 'p_provider_verifier_ref');
          if (
            runId === undefined
            || previewHash === undefined
            || idempotencyKey === undefined
            || workItemId === undefined
            || claimToken === undefined
            || claimHash === undefined
            || objectLocatorHash === undefined
            || objectVersionHash === undefined
            || adapterVersion === undefined
            || sourceMappingVersion === undefined
            || providerVerifierRef === undefined
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('resolve_privacy_retention_provider_effect', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_idempotency_key: idempotencyKey,
            p_work_item_id: workItemId,
            p_claim_token: claimToken,
            p_claim_hash: claimHash,
            p_object_locator_hash: objectLocatorHash,
            p_object_version_hash: objectVersionHash,
            p_adapter_version: adapterVersion,
            p_source_mapping_version: sourceMappingVersion,
            p_provider_verifier_ref: providerVerifierRef,
          });
        }
        case 'get_privacy_retention_provider_reconciliation_work': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          const providerVerifierRef = stringRpcArgument(args, 'p_provider_verifier_ref');
          const limit = numberRpcArgument(args, 'p_limit');
          if (
            runId === undefined
            || previewHash === undefined
            || idempotencyKey === undefined
            || providerVerifierRef === undefined
            || limit === undefined
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('get_privacy_retention_provider_reconciliation_work', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_idempotency_key: idempotencyKey,
            p_provider_verifier_ref: providerVerifierRef,
            p_limit: limit,
          });
        }
        case 'record_privacy_retention_storage_provider_receipts': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          const receipts = args.p_receipts;
          if (
            runId === undefined
            || previewHash === undefined
            || idempotencyKey === undefined
            || !isJsonValue(receipts)
          ) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('record_privacy_retention_storage_provider_receipts', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_idempotency_key: idempotencyKey,
            p_receipts: receipts,
          });
        }
        case 'finalize_privacy_retention_run': {
          const runId = stringRpcArgument(args, 'p_run_id');
          const previewHash = stringRpcArgument(args, 'p_preview_hash');
          const idempotencyKey = stringRpcArgument(args, 'p_idempotency_key');
          if (runId === undefined || previewHash === undefined || idempotencyKey === undefined) {
            return invalidRetentionRpcRequest();
          }
          return client.rpc('finalize_privacy_retention_run', {
            p_run_id: runId,
            p_preview_hash: previewHash,
            p_idempotency_key: idempotencyKey,
          });
        }
        default:
          return invalidRetentionRpcRequest();
      }
    },
  };
};

const safeError = (error: unknown): string => error instanceof PrivacyRetentionRunnerError
  ? error.code
  : 'privacy_retention_operation_failed';

/** Server/scheduler-only control plane. It never accepts browser/session auth. */
export async function POST(request: NextRequest) {
  if (isBrowserOrSessionRequest(request)) {
    return json({ ok: false, error: 'privacy_retention_browser_auth_rejected' }, { status: 401 });
  }
  if (!hasValidRetentionCapability(
    request.headers.get(CAPABILITY_HEADER),
    process.env.PRIVACY_RETENTION_INTERNAL_CAPABILITY,
  )) {
    return json({ ok: false, error: 'privacy_retention_capability_rejected' }, { status: 401 });
  }

  try {
    const body = await readRequest(request);
    const client = retentionRpcClient();

    if (body.action === 'preview') {
      const preview = await withRuntimeLimit(previewRetentionRun(client, {
        classCode: body.classCode,
        asOf: body.asOf,
        batchSize: body.batchSize ?? MAX_PRIVACY_RETENTION_BATCH_SIZE,
      }));
      return json({ ok: true, preview });
    }

    const provider = privateProvider();
    if (!provider) {
      throw new PrivacyRetentionRunnerError('privacy_retention_provider_unavailable');
    }
    const receipt = await withRuntimeLimit(applyRetentionRun(client, {
      operationId: body.operationId,
      previewHash: body.previewHash,
      confirmationText: body.confirmationText,
      idempotencyKey: body.idempotencyKey,
      adapterVersion: body.adapterVersion,
      sourceMappingVersion: body.sourceMappingVersion,
      batchSize: body.batchSize ?? MAX_PRIVACY_RETENTION_BATCH_SIZE,
    }, { provider }));
    return json({ ok: true, receipt });
  } catch (error) {
    const code = safeError(error);
    const status = code === 'privacy_retention_timeout'
      ? 504
      : code === 'privacy_retention_request_too_large' ? 413 : 400;
    return json({ ok: false, error: code }, { status });
  }
}
