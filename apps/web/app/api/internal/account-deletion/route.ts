import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  ACCOUNT_DELETION_CLEANUP_READBACK_RESERVE_MS,
  ACCOUNT_DELETION_EXTERNAL_PHASES,
  type AccountDeletionExternalPhase,
  type AccountDeletionRpcArgs,
  type AccountDeletionRpcClient,
  type AccountDeletionRpcName,
  type AccountDeletionRpcResponse,
  type AccountDeletionStorageDeleteProvider,
  type AccountDeletionStorageProofVerifier,
  runAccountDeletionExternalWorker,
} from '@/lib/privacy/account-deletion-worker';
import { BOUNDED_JSON_REQUEST_ERROR, readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/integrations/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_BODY_BYTES = 2_048;
const MAX_VERIFIER_RESPONSE_BYTES = 1_024;
const MIN_DEADLINE_MS = ACCOUNT_DELETION_CLEANUP_READBACK_RESERVE_MS + 1_500;
const MAX_DEADLINE_MS = 25_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const RECEIPT_REF_RE = /^[A-Za-z0-9._:-]{8,256}$/;
const REQUEST_KEYS = ['actorUserId', 'targetUserId', 'requestId', 'previewHash', 'idempotencyKey', 'sourceManifestHash', 'phase', 'deadlineMs'] as const;
const CLAIM_NEXT_REQUEST_KEYS = ['deadlineMs', 'mode'] as const;

type WorkerRequest = {
  actorUserId: string;
  targetUserId: string;
  requestId: string;
  previewHash: string;
  idempotencyKey: string;
  sourceManifestHash: string;
  phase: AccountDeletionExternalPhase;
  deadlineMs: number;
};
type ClaimNextRequest = {
  mode: 'claim_next';
  deadlineMs: number;
};
type DispatchRequest = WorkerRequest | ClaimNextRequest;
type ClaimedWorkerRequest = WorkerRequest & { attemptToken: string };
type AccountDeletionClaimNextArgs =
  Database['public']['Functions']['claim_next_account_deletion_external_job']['Args'];
type AccountDeletionClaimNextReturns =
  Database['public']['Functions']['claim_next_account_deletion_external_job']['Returns'];
type AccountDeletionServiceRoleClient = ReturnType<typeof createSupabaseServiceRoleClient>;
type AccountDeletionRpcRequest = {
  [Name in AccountDeletionRpcName]: Readonly<{
    name: Name;
    args: AccountDeletionRpcArgs<Name>;
  }>;
}[AccountDeletionRpcName];
type AccountDeletionRpcDispatchResult = {
  [Name in AccountDeletionRpcName]: Readonly<{
    name: Name;
    response: AccountDeletionRpcResponse<Name>;
  }>;
}[AccountDeletionRpcName];

function accountDeletionRpcRequest<Name extends AccountDeletionRpcName>(
  name: Name,
  args: AccountDeletionRpcArgs<Name>,
): AccountDeletionRpcRequest {
  switch (name) {
    case 'claim_account_deletion_external_job':
      return {
        name: 'claim_account_deletion_external_job',
        args: args as AccountDeletionRpcArgs<'claim_account_deletion_external_job'>,
      };
    case 'read_account_deletion_external_job':
      return {
        name: 'read_account_deletion_external_job',
        args: args as AccountDeletionRpcArgs<'read_account_deletion_external_job'>,
      };
    case 'prepare_account_deletion_external_egress':
      return {
        name: 'prepare_account_deletion_external_egress',
        args: args as AccountDeletionRpcArgs<'prepare_account_deletion_external_egress'>,
      };
    case 'run_account_deletion_session_family_cleanup':
      return {
        name: 'run_account_deletion_session_family_cleanup',
        args: args as AccountDeletionRpcArgs<'run_account_deletion_session_family_cleanup'>,
      };
    case 'get_account_deletion_storage_work':
      return {
        name: 'get_account_deletion_storage_work',
        args: args as AccountDeletionRpcArgs<'get_account_deletion_storage_work'>,
      };
    case 'record_account_deletion_external_provider_proof':
      return {
        name: 'record_account_deletion_external_provider_proof',
        args: args as AccountDeletionRpcArgs<'record_account_deletion_external_provider_proof'>,
      };
    case 'reconcile_account_deletion_storage_job':
      return {
        name: 'reconcile_account_deletion_storage_job',
        args: args as AccountDeletionRpcArgs<'reconcile_account_deletion_storage_job'>,
      };
    case 'reconcile_account_deletion_auth_job':
      return {
        name: 'reconcile_account_deletion_auth_job',
        args: args as AccountDeletionRpcArgs<'reconcile_account_deletion_auth_job'>,
      };
  }
  throw new Error('Unsupported account deletion RPC.');
}

async function dispatchAccountDeletionRpc(
  supabase: AccountDeletionServiceRoleClient,
  request: AccountDeletionRpcRequest,
): Promise<AccountDeletionRpcDispatchResult> {
  switch (request.name) {
    case 'claim_account_deletion_external_job': {
      const response = await supabase.rpc('claim_account_deletion_external_job', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'read_account_deletion_external_job': {
      const response = await supabase.rpc('read_account_deletion_external_job', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'prepare_account_deletion_external_egress': {
      const response = await supabase.rpc('prepare_account_deletion_external_egress', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'run_account_deletion_session_family_cleanup': {
      const response = await supabase.rpc('run_account_deletion_session_family_cleanup', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'get_account_deletion_storage_work': {
      const response = await supabase.rpc('get_account_deletion_storage_work', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'record_account_deletion_external_provider_proof': {
      const response = await supabase.rpc('record_account_deletion_external_provider_proof', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'reconcile_account_deletion_storage_job': {
      const response = await supabase.rpc('reconcile_account_deletion_storage_job', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
    case 'reconcile_account_deletion_auth_job': {
      const response = await supabase.rpc('reconcile_account_deletion_auth_job', request.args);
      return {
        name: request.name,
        response: { data: response.data, error: response.error },
      };
    }
  }
  throw new Error('Unsupported account deletion RPC.');
}

const accountDeletionWorkerRpc = (
  supabase: AccountDeletionServiceRoleClient,
): AccountDeletionRpcClient => ({
  async rpc<Name extends AccountDeletionRpcName>(
    name: Name,
    args: AccountDeletionRpcArgs<Name>,
  ): Promise<AccountDeletionRpcResponse<Name>> {
    const result = await dispatchAccountDeletionRpc(
      supabase,
      accountDeletionRpcRequest(name, args),
    );
    if (result.name !== name) {
      throw new Error('Account deletion RPC dispatch mismatch');
    }

    return result.response as AccountDeletionRpcResponse<Name>;
  },
});

function noStore(extra: Record<string, string> = {}): HeadersInit {
  return { 'Cache-Control': 'no-store, private, max-age=0', Pragma: 'no-cache', Vary: 'X-Account-Deletion-Worker-Capability', ...extra };
}
function diagnostic(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: noStore() });
}
function present(request: NextRequest, header: string): boolean {
  return (request.headers.get(header)?.trim().length ?? 0) !== 0;
}
function serverOnlyRequest(request: NextRequest): boolean {
  return !['cookie', 'authorization', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'].some((header) => present(request, header));
}
function validWorkerCapability(request: NextRequest): boolean {
  const expected = process.env.ACCOUNT_DELETION_WORKER_CAPABILITY;
  const supplied = request.headers.get('x-account-deletion-worker-capability');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expectedBytes.byteLength >= 32 && suppliedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(expectedBytes, suppliedBytes);
}
async function deadlineBound<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('deadline exceeded');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
async function boundedText(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}
function parseRequest(candidate: unknown): DispatchRequest | null {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (exactKeys(record, CLAIM_NEXT_REQUEST_KEYS)) {
    const deadlineMs = record.deadlineMs as number;
    return record.mode === 'claim_next'
      && Number.isInteger(deadlineMs)
      && deadlineMs >= MIN_DEADLINE_MS
      && deadlineMs <= MAX_DEADLINE_MS
      ? { mode: 'claim_next', deadlineMs }
      : null;
  }
  if (!exactKeys(record, REQUEST_KEYS)) return null;
  const value: WorkerRequest = {
    actorUserId: typeof record.actorUserId === 'string' ? record.actorUserId : '',
    targetUserId: typeof record.targetUserId === 'string' ? record.targetUserId : '',
    requestId: typeof record.requestId === 'string' ? record.requestId : '',
    previewHash: typeof record.previewHash === 'string' ? record.previewHash : '',
    idempotencyKey: typeof record.idempotencyKey === 'string' ? record.idempotencyKey : '',
    sourceManifestHash: typeof record.sourceManifestHash === 'string' ? record.sourceManifestHash : '',
    phase: record.phase as AccountDeletionExternalPhase,
    deadlineMs: record.deadlineMs as number,
  };
  return UUID_RE.test(value.actorUserId) && UUID_RE.test(value.targetUserId) && UUID_RE.test(value.requestId) && HASH_RE.test(value.previewHash) && HASH_RE.test(value.sourceManifestHash) && IDEMPOTENCY_RE.test(value.idempotencyKey) && ACCOUNT_DELETION_EXTERNAL_PHASES.includes(value.phase) && Number.isInteger(value.deadlineMs) && value.deadlineMs >= MIN_DEADLINE_MS && value.deadlineMs <= MAX_DEADLINE_MS ? value : null;
}
function row(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return row(value[0]);
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}
function text(value: Record<string, unknown> | null, key: string): string {
  return typeof value?.[key] === 'string' ? value[key] as string : '';
}
async function claimNext(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  deadlineMs: number,
): Promise<ClaimedWorkerRequest | 'empty' | null> {
  try {
    const args = {} satisfies AccountDeletionClaimNextArgs;
    const response: Readonly<{
      data: AccountDeletionClaimNextReturns | null;
      error: unknown | null;
    }> = await supabase.rpc('claim_next_account_deletion_external_job', args);
    if (response.error) return null;
    const claimed = row(response.data);
    if (!claimed) return 'empty';
    const worker: ClaimedWorkerRequest = {
      actorUserId: text(claimed, 'actor_user_id'),
      targetUserId: text(claimed, 'target_user_id'),
      requestId: text(claimed, 'request_id'),
      previewHash: text(claimed, 'preview_hash'),
      idempotencyKey: text(claimed, 'idempotency_key'),
      sourceManifestHash: text(claimed, 'source_manifest_hash'),
      phase: text(claimed, 'phase') as AccountDeletionExternalPhase,
      attemptToken: text(claimed, 'attempt_token'),
      deadlineMs,
    };
    return UUID_RE.test(worker.actorUserId)
      && UUID_RE.test(worker.targetUserId)
      && UUID_RE.test(worker.requestId)
      && HASH_RE.test(worker.previewHash)
      && HASH_RE.test(worker.sourceManifestHash)
      && IDEMPOTENCY_RE.test(worker.idempotencyKey)
      && ACCOUNT_DELETION_EXTERNAL_PHASES.includes(worker.phase)
      && UUID_RE.test(worker.attemptToken)
      ? worker
      : null;
  } catch {
    return null;
  }
}
function emptyQueueResponse(): NextResponse {
  return NextResponse.json(
    { status: 'empty', code: 'account_deletion_queue_empty', counts: { workItems: 0, providerProofs: 0 } },
    { headers: noStore() },
  );
}
function validProviderCapability(value: string | undefined): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32;
}
function storageProofVerifier(): AccountDeletionStorageProofVerifier | null {
  const endpoint = process.env.ACCOUNT_DELETION_STORAGE_PROOF_VERIFIER_URL;
  const capability = process.env.ACCOUNT_DELETION_STORAGE_PROOF_VERIFIER_CAPABILITY;
  if (!endpoint || !validProviderCapability(capability)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return {
    async verifyStorageDeletion(input) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Account-Deletion-Proof-Verifier-Capability': capability, 'Cache-Control': 'no-store' },
          body: JSON.stringify({
            providerIdempotencyKey: input.providerIdempotencyKey,
            objectId: input.objectId,
            objectVersion: input.objectVersion,
            objectLocatorHash: input.objectLocatorHash,
            objectVersionHash: input.objectVersionHash,
          }),
          cache: 'no-store',
          redirect: 'error',
          signal: input.signal,
        });
        if (!response.ok) return null;
        const body = await boundedText(response.body, MAX_VERIFIER_RESPONSE_BYTES);
        if (!body) return null;
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
        const record = parsed as Record<string, unknown>;
        const providerReceiptRef = typeof record.providerReceiptRef === 'string' ? record.providerReceiptRef : '';
        const providerReceiptHash = typeof record.providerReceiptHash === 'string' ? record.providerReceiptHash : '';
        return RECEIPT_REF_RE.test(providerReceiptRef) && HASH_RE.test(providerReceiptHash) ? { providerReceiptRef, providerReceiptHash } : null;
      } catch {
        return null;
      }
    },
  };
}

function storageDeleteProvider(): AccountDeletionStorageDeleteProvider | null {
  const endpoint = process.env.ACCOUNT_DELETION_STORAGE_DELETE_ADAPTER_URL;
  const capability = process.env.ACCOUNT_DELETION_STORAGE_DELETE_ADAPTER_CAPABILITY;
  if (!endpoint || !validProviderCapability(capability)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // Supabase Storage's SDK cannot condition deletion on object identity/version.
  // This owner-authorized adapter must enforce both predicates at the provider boundary.
  return {
    async deleteObject(input) {
      if (input.signal.aborted) throw new Error('deadline exceeded');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Account-Deletion-Storage-Delete-Adapter-Capability': capability, 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          providerIdempotencyKey: input.providerIdempotencyKey,
          bucketId: input.bucketId,
          objectName: input.objectName,
          objectId: input.objectId,
          objectVersion: input.objectVersion,
          objectLocatorHash: input.objectLocatorHash,
          objectVersionHash: input.objectVersionHash,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: input.signal,
      });
      if (!response.ok) throw new Error('storage deletion adapter failed');
      const body = await boundedText(response.body, MAX_VERIFIER_RESPONSE_BYTES);
      if (!body) throw new Error('storage deletion adapter receipt missing');
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('storage deletion adapter receipt invalid');
      }
      const receipt = parsed as Record<string, unknown>;
      if (receipt.conditionalDelete !== true
        || receipt.deletedObjectId !== input.objectId
        || receipt.deletedObjectVersion !== input.objectVersion) {
        throw new Error('storage deletion adapter binding mismatch');
      }
    },
  };
}
function workerResponse(result: Awaited<ReturnType<typeof runAccountDeletionExternalWorker>>): NextResponse {
  const retry = result.status === 'partial' || result.status === 'retry';
  const status = result.status === 'completed' ? 200 : result.status === 'busy' ? 409 : result.status === 'held' ? 423 : 503;
  return NextResponse.json({ status: result.status, phase: result.phase, requestHash: result.requestHash, counts: result.counts }, { status, headers: noStore(retry ? { 'Retry-After': '5' } : {}) });
}

export async function POST(request: NextRequest) {
  if (!serverOnlyRequest(request) || !validWorkerCapability(request)) return diagnostic(401, 'account_deletion_worker_unauthorized');

  const body = await readBoundedJsonRequest(request, MAX_BODY_BYTES);
  if (!body.ok) {
    const status = body.code === BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType
      ? 415
      : body.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge
        ? 413
        : 400;
    return diagnostic(status, 'account_deletion_worker_invalid_request');
  }
  const parsed = parseRequest(body.value);
  if (!parsed) return diagnostic(400, 'account_deletion_worker_invalid_request');

  let supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch {
    return diagnostic(503, 'account_deletion_worker_unavailable');
  }

  const workerDependencies = {
    rpc: accountDeletionWorkerRpc(supabase),
    storage: storageDeleteProvider(),
    auth: {
      async deleteUser(input: { targetUserId: string; signal: AbortSignal }) {
        if (input.signal.aborted) throw new Error('deadline exceeded');
        const response = await deadlineBound(
          supabase.auth.admin.deleteUser(input.targetUserId),
          input.signal,
        );
        if (response.error) throw new Error('auth deletion failed');
      },
    },
    storageProofVerifier: storageProofVerifier(),
  };
  if ('mode' in parsed) {
    const claimed = await claimNext(supabase, parsed.deadlineMs);
    if (claimed === null) return diagnostic(503, 'account_deletion_worker_unavailable');
    if (claimed === 'empty') return emptyQueueResponse();
    return workerResponse(await runAccountDeletionExternalWorker(workerDependencies, {
      binding: {
        actorUserId: claimed.actorUserId,
        targetUserId: claimed.targetUserId,
        requestId: claimed.requestId,
        previewHash: claimed.previewHash,
        idempotencyKey: claimed.idempotencyKey,
        sourceManifestHash: claimed.sourceManifestHash,
      },
      phase: claimed.phase,
      attemptToken: claimed.attemptToken,
      deadlineAt: Date.now() + claimed.deadlineMs,
    }));
  }
  return workerResponse(await runAccountDeletionExternalWorker(workerDependencies, {
    binding: {
      actorUserId: parsed.actorUserId,
      targetUserId: parsed.targetUserId,
      requestId: parsed.requestId,
      previewHash: parsed.previewHash,
      idempotencyKey: parsed.idempotencyKey,
      sourceManifestHash: parsed.sourceManifestHash,
    },
    phase: parsed.phase,
    deadlineAt: Date.now() + parsed.deadlineMs,
  }));
}
