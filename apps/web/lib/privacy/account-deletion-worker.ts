import { createHash } from 'node:crypto';
import type { Database } from '@/integrations/supabase/types';

if (typeof window !== 'undefined') {
  throw new Error('Account deletion worker is server-only.');
}

export const ACCOUNT_DELETION_EXTERNAL_PHASES = ['session', 'storage', 'auth'] as const;
export type AccountDeletionExternalPhase = (typeof ACCOUNT_DELETION_EXTERNAL_PHASES)[number];
export const ACCOUNT_DELETION_STORAGE_WORK_MODES = ['delete_then_verify', 'verify_absence_only'] as const;
export type AccountDeletionStorageWorkMode = (typeof ACCOUNT_DELETION_STORAGE_WORK_MODES)[number];

export type AccountDeletionWorkerBinding = {
  actorUserId: string;
  targetUserId: string;
  requestId: string;
  previewHash: string;
  idempotencyKey: string;
  sourceManifestHash: string;
};

type AccountDeletionRpcFunctions = Pick<
  Database['public']['Functions'],
  | 'claim_account_deletion_external_job'
  | 'read_account_deletion_external_job'
  | 'prepare_account_deletion_external_egress'
  | 'run_account_deletion_session_family_cleanup'
  | 'get_account_deletion_storage_work'
  | 'record_account_deletion_external_provider_proof'
  | 'reconcile_account_deletion_storage_job'
  | 'reconcile_account_deletion_auth_job'
>;
export type AccountDeletionRpcName = Extract<keyof AccountDeletionRpcFunctions, string>;
export type AccountDeletionRpcArgs<Name extends AccountDeletionRpcName> =
  AccountDeletionRpcFunctions[Name]['Args'];
export type AccountDeletionRpcReturns<Name extends AccountDeletionRpcName> =
  AccountDeletionRpcFunctions[Name]['Returns'];
export type AccountDeletionRpcResponse<Name extends AccountDeletionRpcName> = Readonly<{
  data: AccountDeletionRpcReturns<Name> | null;
  error: unknown | null;
}>;
type AccountDeletionRpcBindingArgs = Pick<
  AccountDeletionRpcArgs<'claim_account_deletion_external_job'>,
  | 'p_actor_user_id'
  | 'p_target_user_id'
  | 'p_request_id'
  | 'p_preview_hash'
  | 'p_idempotency_key'
  | 'p_source_manifest_hash'
>;
export type AccountDeletionRpcClient = {
  rpc: <Name extends AccountDeletionRpcName>(
    name: Name,
    args: AccountDeletionRpcArgs<Name>,
  ) => Promise<AccountDeletionRpcResponse<Name>>;
};

export type AccountDeletionStorageDeleteProvider = {
  deleteObject: (input: {
    bucketId: string;
    objectName: string;
    objectId: string;
    objectVersion: string;
    objectLocatorHash: string;
    objectVersionHash: string;
    providerIdempotencyKey: string;
    signal: AbortSignal;
  }) => Promise<void>;
};

export type AccountDeletionStorageProofVerifier = {
  verifyStorageDeletion: (input: {
    providerIdempotencyKey: string;
    objectId: string;
    objectVersion: string;
    objectLocatorHash: string;
    objectVersionHash: string;
    signal: AbortSignal;
  }) => Promise<{ providerReceiptRef: string; providerReceiptHash: string } | null>;
};

export type AccountDeletionAuthDeleteProvider = {
  deleteUser: (input: { targetUserId: string; signal: AbortSignal }) => Promise<void>;
};

export type AccountDeletionWorkerDependencies = {
  rpc: AccountDeletionRpcClient;
  storage: AccountDeletionStorageDeleteProvider | null;
  auth: AccountDeletionAuthDeleteProvider;
  storageProofVerifier: AccountDeletionStorageProofVerifier | null;
  now?: () => number;
};

export type AccountDeletionWorkerInput = {
  binding: AccountDeletionWorkerBinding;
  phase: AccountDeletionExternalPhase;
  deadlineAt: number;
  attemptToken?: string | null;
};

export type AccountDeletionWorkerResult = {
  status: 'completed' | 'partial' | 'busy' | 'held' | 'retry';
  phase: AccountDeletionExternalPhase;
  requestHash: string;
  counts: { workItems: number; providerProofs: number };
};

type Row = Record<string, unknown>;
type Context = {
  dependencies: AccountDeletionWorkerDependencies;
  input: AccountDeletionWorkerInput;
  attemptToken: string;
  reconciliationOnly: boolean;
  now: () => number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const RECEIPT_REF_RE = /^[A-Za-z0-9._:-]{8,256}$/;
const STORAGE_VERSION_RE = /^[A-Za-z0-9._:-]{1,256}$/;
const MIN_EGRESS_WINDOW_MS = 250;
export const ACCOUNT_DELETION_CLEANUP_READBACK_RESERVE_MS = 1_500;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : isRow(value) ? [value] : [];
}
function first(value: unknown): Row | null {
  return rows(value)[0] ?? null;
}
function text(row: Row | null, key: string): string {
  return typeof row?.[key] === 'string' ? row[key] as string : '';
}
function bool(row: Row | null, key: string): boolean {
  return row?.[key] === true;
}
function count(row: Row | null, key: string): number {
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.trunc(value), 10_000) : 0;
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function outcome(input: AccountDeletionWorkerInput, status: AccountDeletionWorkerResult['status'], counts: Partial<AccountDeletionWorkerResult['counts']> = {}): AccountDeletionWorkerResult {
  return {
    status,
    phase: input.phase,
    requestHash: hash(input.binding.requestId),
    counts: { workItems: counts.workItems ?? 0, providerProofs: counts.providerProofs ?? 0 },
  };
}
function bindingArgs(binding: AccountDeletionWorkerBinding): AccountDeletionRpcBindingArgs {
  return {
    p_actor_user_id: binding.actorUserId,
    p_target_user_id: binding.targetUserId,
    p_request_id: binding.requestId,
    p_preview_hash: binding.previewHash,
    p_idempotency_key: binding.idempotencyKey,
    p_source_manifest_hash: binding.sourceManifestHash,
  };
}
function validate(input: AccountDeletionWorkerInput): void {
  const { binding } = input;
  if (!UUID_RE.test(binding.actorUserId) || !UUID_RE.test(binding.targetUserId) || !UUID_RE.test(binding.requestId) || !HASH_RE.test(binding.previewHash) || !HASH_RE.test(binding.sourceManifestHash) || !IDEMPOTENCY_RE.test(binding.idempotencyKey) || !ACCOUNT_DELETION_EXTERNAL_PHASES.includes(input.phase) || !Number.isFinite(input.deadlineAt) || (input.attemptToken !== undefined && input.attemptToken !== null && !UUID_RE.test(input.attemptToken))) {
    throw new Error('Invalid account deletion worker input.');
  }
}
async function rpc<Name extends AccountDeletionRpcName>(
  client: AccountDeletionRpcClient,
  name: Name,
  args: AccountDeletionRpcArgs<Name>,
): Promise<Row[] | null> {
  try {
    const response = await client.rpc(name, args);
    return response.error ? null : rows(response.data);
  } catch {
    return null;
  }
}
function completed(row: Row | null): boolean {
  return text(row, 'job_state') === 'completed' || text(row, 'status') === 'completed';
}
function held(row: Row | null): boolean {
  return text(row, 'job_state') === 'blocked' || text(row, 'checkpoint_state') === 'blocked' || bool(row, 'hold_active');
}
function unknownEgress(row: Row | null): boolean {
  return ['job_state', 'checkpoint_state', 'attempt_state', 'egress_state'].some((key) => ['egress_unknown', 'reconciling', 'reconciliation_required', 'verify_absence_only'].includes(text(row, key)));
}
function expired(row: Row | null, now: () => number): boolean {
  const lease = Date.parse(text(row, 'lease_expires_at'));
  return Number.isFinite(lease) && lease <= now();
}
function canVerify(context: Context): boolean {
  return context.input.deadlineAt - context.now()
    > ACCOUNT_DELETION_CLEANUP_READBACK_RESERVE_MS + MIN_EGRESS_WINDOW_MS;
}
function canEgress(context: Context, lease: Row | null): boolean {
  if (!canVerify(context)) return false;
  const leaseAt = Date.parse(text(lease, 'lease_expires_at'));
  return !Number.isFinite(leaseAt)
    || leaseAt - context.now()
      > ACCOUNT_DELETION_CLEANUP_READBACK_RESERVE_MS + MIN_EGRESS_WINDOW_MS;
}
function deadlineSignal(context: Context): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, context.input.deadlineAt - context.now() - ACCOUNT_DELETION_CLEANUP_READBACK_RESERVE_MS));
  return { signal: controller.signal, cancel: () => clearTimeout(timeout) };
}
async function read(context: Context): Promise<Row | null> {
  const response = await rpc(context.dependencies.rpc, 'read_account_deletion_external_job', { ...bindingArgs(context.input.binding), p_phase: context.input.phase, p_attempt_token: context.attemptToken });
  return response ? first(response) : null;
}
async function prepare(context: Context): Promise<Row | null> {
  const response = await rpc(context.dependencies.rpc, 'prepare_account_deletion_external_egress', { ...bindingArgs(context.input.binding), p_phase: context.input.phase, p_attempt_token: context.attemptToken });
  return response ? first(response) : null;
}
async function reconcile(context: Context): Promise<{ row: Row | null; counts: AccountDeletionWorkerResult['counts'] }> {
  const name = context.input.phase === 'session' ? 'run_account_deletion_session_family_cleanup' : context.input.phase === 'storage' ? 'reconcile_account_deletion_storage_job' : 'reconcile_account_deletion_auth_job';
  const response = await rpc(context.dependencies.rpc, name, { ...bindingArgs(context.input.binding), p_attempt_token: context.attemptToken });
  const row = response ? first(response) : null;
  return { row, counts: { workItems: count(row, 'expected_work_count'), providerProofs: count(row, 'provider_proof_count') } };
}
function reconciled(context: Context, value: { row: Row | null; counts: AccountDeletionWorkerResult['counts'] }): AccountDeletionWorkerResult {
  return completed(value.row) ? outcome(context.input, 'completed', value.counts) : held(value.row) ? outcome(context.input, 'held', value.counts) : outcome(context.input, 'partial', value.counts);
}
async function reconcileOnly(context: Context): Promise<AccountDeletionWorkerResult> {
  return reconciled(context, await reconcile(context));
}
function storageWorkMode(row: Row, expectedMode: AccountDeletionStorageWorkMode): AccountDeletionStorageWorkMode | null {
  const mode = text(row, 'work_mode');
  if (mode !== expectedMode
    || text(row, 'work_state') !== expectedMode
    || !UUID_RE.test(text(row, 'object_id'))
    || !STORAGE_VERSION_RE.test(text(row, 'object_version'))
    || !HASH_RE.test(text(row, 'object_locator_hash'))
    || !HASH_RE.test(text(row, 'object_version_hash'))
    || !IDEMPOTENCY_RE.test(text(row, 'provider_idempotency_key'))) {
    return null;
  }
  if (mode === 'delete_then_verify' && (text(row, 'bucket_id').length === 0 || text(row, 'object_name').length === 0)) {
    return null;
  }
  if (mode === 'verify_absence_only' && (text(row, 'bucket_id').length !== 0 || text(row, 'object_name').length !== 0)) {
    return null;
  }
  return mode as AccountDeletionStorageWorkMode;
}

async function getStorageWork(context: Context, expectedMode: AccountDeletionStorageWorkMode): Promise<Row[] | null> {
  const response = await rpc(context.dependencies.rpc, 'get_account_deletion_storage_work', {
    ...bindingArgs(context.input.binding),
    p_attempt_token: context.attemptToken,
  });
  return response && response.every((item) => text(item, 'source_manifest_hash') === context.input.binding.sourceManifestHash
    && storageWorkMode(item, expectedMode) === expectedMode)
    ? response
    : null;
}
async function recordProof(context: Context, work: Row, proof: { providerReceiptRef: string; providerReceiptHash: string }): Promise<boolean> {
  if (!RECEIPT_REF_RE.test(proof.providerReceiptRef) || !HASH_RE.test(proof.providerReceiptHash)) return false;
  const response = await rpc(context.dependencies.rpc, 'record_account_deletion_external_provider_proof', {
    ...bindingArgs(context.input.binding),
    p_phase: 'storage',
    p_attempt_token: context.attemptToken,
    p_provider_receipt_ref: proof.providerReceiptRef,
    p_provider_receipt_hash: proof.providerReceiptHash,
    p_object_locator_hash: text(work, 'object_locator_hash'),
    p_object_version_hash: text(work, 'object_version_hash'),
  });
  const recorded = response ? first(response) : null;
  return text(recorded, 'provider_receipt_ref') === proof.providerReceiptRef
    && HASH_RE.test(text(recorded, 'proof_hash'))
    && text(recorded, 'source_manifest_hash') === context.input.binding.sourceManifestHash;
}
async function session(context: Context): Promise<AccountDeletionWorkerResult> {
  const current = await read(context);
  if (!current) return outcome(context.input, 'retry');
  if (completed(current)) return outcome(context.input, 'completed');
  if (held(current)) return outcome(context.input, 'held');
  if (context.reconciliationOnly || unknownEgress(current)) return reconcileOnly(context);
  if (expired(current, context.now) || !canEgress(context, current)) return outcome(context.input, 'retry');

  // This RPC atomically records the durable unknown-outcome checkpoint before
  // revoking the session family. Once prepared, its replay is verifier-only.
  return reconcileOnly(context);
}

async function storage(context: Context): Promise<AccountDeletionWorkerResult> {
  const current = await read(context);
  if (!current) return outcome(context.input, 'retry');
  if (completed(current)) return outcome(context.input, 'completed');
  if (held(current)) return outcome(context.input, 'held');

  const reconciliationOnly = context.reconciliationOnly || unknownEgress(current);
  if (!reconciliationOnly && expired(current, context.now)) return outcome(context.input, 'retry');

  const verifier = context.dependencies.storageProofVerifier;
  const storageProvider = context.dependencies.storage;
  let lease = current;
  let work: Row[];
  if (!reconciliationOnly) {
    if (!canEgress(context, current) || !verifier) return outcome(context.input, 'retry');
    // Capture and validate the exact delete authority while the attempt is still
    // leased. Once prepare succeeds, this is the only work allowed to egress.
    const deleteWork = await getStorageWork(context, 'delete_then_verify');
    if (!deleteWork || deleteWork.length > 1 || (deleteWork.length === 1 && !storageProvider)) {
      return outcome(context.input, 'retry');
    }

    const prepared = await prepare(context);
    if (!prepared) return outcome(context.input, 'retry');
    if (completed(prepared) || text(prepared, 'egress_state') === 'authoritative_absent') {
      return outcome(context.input, 'completed');
    }
    if (held(prepared)) return outcome(context.input, 'held');
    if (!unknownEgress(prepared)) return outcome(context.input, 'partial');
    lease = prepared;
    work = deleteWork;
  } else {
    if (!verifier) return outcome(context.input, 'partial');

    // A durable unknown outcome has no delete authority. Fetch only the
    // captured verifier inputs and reject every delete-shaped work receipt.
    const verificationWork = await getStorageWork(context, 'verify_absence_only');
    if (!verificationWork || verificationWork.length !== 1) return reconcileOnly(context);
    work = verificationWork;
  }

  let providerProofs = 0;
  for (const item of work) {
    if (!(reconciliationOnly ? canVerify(context) : canEgress(context, lease))) {
      const final = await reconcile(context);
      return reconciled(context, { row: final.row, counts: { workItems: work.length, providerProofs: Math.max(providerProofs, final.counts.providerProofs) } });
    }

    const deadline = deadlineSignal(context);
    try {
      if (!reconciliationOnly) {
        if (!storageProvider) return outcome(context.input, 'retry', { workItems: work.length, providerProofs });
        await storageProvider.deleteObject({
          bucketId: text(item, 'bucket_id'),
          objectName: text(item, 'object_name'),
          objectId: text(item, 'object_id'),
          objectVersion: text(item, 'object_version'),
          objectLocatorHash: text(item, 'object_locator_hash'),
          objectVersionHash: text(item, 'object_version_hash'),
          providerIdempotencyKey: text(item, 'provider_idempotency_key'),
          signal: deadline.signal,
        });
      }
      const proof = await verifier.verifyStorageDeletion({
        providerIdempotencyKey: text(item, 'provider_idempotency_key'),
        objectId: text(item, 'object_id'),
        objectVersion: text(item, 'object_version'),
        objectLocatorHash: text(item, 'object_locator_hash'),
        objectVersionHash: text(item, 'object_version_hash'),
        signal: deadline.signal,
      });
      if (!proof || !(await recordProof(context, item, proof))) {
        const final = await reconcile(context);
        return reconciled(context, { row: final.row, counts: { workItems: work.length, providerProofs: Math.max(providerProofs, final.counts.providerProofs) } });
      }
      providerProofs += 1;
    } catch {
      const final = await reconcile(context);
      return reconciled(context, { row: final.row, counts: { workItems: work.length, providerProofs: Math.max(providerProofs, final.counts.providerProofs) } });
    } finally {
      deadline.cancel();
    }
  }

  const final = await reconcile(context);
  return reconciled(context, { row: final.row, counts: { workItems: work.length, providerProofs: Math.max(providerProofs, final.counts.providerProofs) } });
}
async function auth(context: Context): Promise<AccountDeletionWorkerResult> {
  const current = await read(context);
  if (!current) return outcome(context.input, 'retry');
  if (completed(current)) return outcome(context.input, 'completed');
  if (held(current)) return outcome(context.input, 'held');
  if (context.reconciliationOnly || bool(current, 'authoritative_absent') || unknownEgress(current)) return reconcileOnly(context);
  if (expired(current, context.now) || !canEgress(context, current)) return outcome(context.input, 'retry');

  // read() plus prepare() perform the authoritative Auth absence preflight before
  // the irreversible Admin call; never trust a provider response as completion.
  const prepared = await prepare(context);
  if (!prepared) return outcome(context.input, 'retry');
  if (completed(prepared)) return outcome(context.input, 'completed');
  if (held(prepared)) return outcome(context.input, 'held');
  if (!unknownEgress(prepared)) return outcome(context.input, 'partial');

  const deadline = deadlineSignal(context);
  try {
    await context.dependencies.auth.deleteUser({ targetUserId: context.input.binding.targetUserId, signal: deadline.signal });
  } catch {
    // The prepared checkpoint is durable unknown-outcome; never retry this call here.
  } finally {
    deadline.cancel();
  }
  return reconcileOnly(context);
}

export async function runAccountDeletionExternalWorker(dependencies: AccountDeletionWorkerDependencies, input: AccountDeletionWorkerInput): Promise<AccountDeletionWorkerResult> {
  validate(input);
  const now = dependencies.now ?? Date.now;
  const claimResponse = await rpc(dependencies.rpc, 'claim_account_deletion_external_job', { ...bindingArgs(input.binding), p_phase: input.phase, p_attempt_token: input.attemptToken ?? null });
  const claim = claimResponse ? first(claimResponse) : null;
  if (!claim) return outcome(input, 'retry');
  if (text(claim, 'claim_status') === 'busy') return outcome(input, 'busy');
  if (held(claim)) return outcome(input, 'held');
  if (text(claim, 'claim_status') === 'completed' || completed(claim)) return outcome(input, 'completed');
  const attemptToken = text(claim, 'attempt_token');
  if (!['claimed', 'replayed'].includes(text(claim, 'claim_status')) || !UUID_RE.test(attemptToken)) return outcome(input, 'retry');
  const reconciliationOnly = text(claim, 'checkpoint_state') === 'verify_absence_only' || unknownEgress(claim);
  const context: Context = { dependencies, input, attemptToken, reconciliationOnly, now };
  if (expired(claim, now) && !reconciliationOnly) return outcome(input, 'retry');
  if (input.phase === 'session') return session(context);
  return input.phase === 'storage' ? storage(context) : auth(context);
}
