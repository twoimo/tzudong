import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';

import { POST } from '../app/api/internal/account-deletion/route';
import {
  runAccountDeletionExternalWorker,
  type AccountDeletionRpcArgs,
  type AccountDeletionRpcClient,
  type AccountDeletionRpcName,
  type AccountDeletionRpcResponse,
  type AccountDeletionRpcReturns,
  type AccountDeletionWorkerDependencies,
} from '../lib/privacy/account-deletion-worker';
const scheduler = await import('../scripts/run-account-deletion-worker.mjs');

const actorUserId = '11111111-1111-4111-8111-111111111111';
const targetUserId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const attemptToken = '44444444-4444-4444-8444-444444444444';
const previewHash = 'a'.repeat(64);
const sourceManifestHash = 'b'.repeat(64);
const receiptHash = 'c'.repeat(64);
const locatorHash = 'd'.repeat(64);
const versionHash = 'e'.repeat(64);
const objectId = '66666666-6666-4666-8666-666666666666';
const objectVersion = '77777777-7777-4777-8777-777777777777';
const secondObjectId = '88888888-8888-4888-8888-888888888888';
const secondObjectVersion = '99999999-9999-4999-8999-999999999999';
const idempotencyKey = 'account-delete-worker-001';

const futureLease = () => new Date(Date.now() + 120_000).toISOString();
const secondAttemptToken = '55555555-5555-4555-8555-555555555555';
const pastLease = () => new Date(Date.now() - 1_000).toISOString();

type Queue = Record<string, unknown[]>;
const secondLocatorHash = 'f'.repeat(64);
const secondVersionHash = '1'.repeat(64);
function fixture(queue: Queue, verifier: AccountDeletionWorkerDependencies['storageProofVerifier'] | undefined = undefined) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const events: string[] = [];
  const providers = { storage: 0, auth: 0 };
  const verifiers = { storage: 0 };
  const rpc: AccountDeletionRpcClient = {
    async rpc<Name extends AccountDeletionRpcName>(
      name: Name,
      args: AccountDeletionRpcArgs<Name>,
    ): Promise<AccountDeletionRpcResponse<Name>> {
      events.push(`rpc:${name}`);
      calls.push({ name, args });
      return {
        data: (queue[name]?.shift() ?? null) as AccountDeletionRpcReturns<Name> | null,
        error: null,
      };
    },
  };
  const dependencies: AccountDeletionWorkerDependencies = {
    rpc,
    storage: {
      async deleteObject() {
        events.push('storage:delete');
        providers.storage += 1;
      },
    },
    auth: {
      async deleteUser() {
        events.push('auth:delete');
        providers.auth += 1;
      },
    },
    storageProofVerifier: verifier === undefined ? {
      async verifyStorageDeletion() {
        events.push('storage:verify');
        verifiers.storage += 1;
        return { providerReceiptRef: 'provider-receipt-001', providerReceiptHash: receiptHash };
      },
    } : verifier,
  };
  return { dependencies, calls, events, providers, verifiers };
}
function claim(lease = futureLease(), token = attemptToken) {
  return { claim_status: 'claimed', attempt_token: token, lease_expires_at: lease, job_state: 'leased', checkpoint_state: 'pending' };
}
function storageWork(
  workMode: 'delete_then_verify' | 'verify_absence_only',
  objectLocatorHash = locatorHash,
  objectVersionHash = versionHash,
  objectName = 'private/raw-path-never-returned',
  capturedObjectId = objectLocatorHash === secondLocatorHash ? secondObjectId : objectId,
  capturedObjectVersion = objectVersionHash === secondVersionHash ? secondObjectVersion : objectVersion,
) {
  return {
    work_state: workMode,
    work_mode: workMode,
    bucket_id: workMode === 'delete_then_verify' ? 'private-upload' : null,
    object_name: workMode === 'delete_then_verify' ? objectName : null,
    object_id: capturedObjectId,
    object_version: capturedObjectVersion,
    object_locator_hash: objectLocatorHash,
    object_version_hash: objectVersionHash,
    provider_idempotency_key: `storage-delete-${objectLocatorHash.slice(0, 12)}`,
    source_manifest_hash: sourceManifestHash,
  };
}
async function run(
  dependencies: AccountDeletionWorkerDependencies,
  phase: 'session' | 'storage' | 'auth',
  suppliedAttemptToken?: string,
  deadlineAt = Date.now() + 60_000,
) {
  return runAccountDeletionExternalWorker(dependencies, {
    binding: { actorUserId, targetUserId, requestId, previewHash, idempotencyKey, sourceManifestHash },
    phase,
    deadlineAt,
    attemptToken: suppliedAttemptToken,
  });
}

describe('durable account-deletion worker recovery', () => {
  test('resumes the database-owned session phase without provider egress', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'egress_unknown', attempt_state: 'egress_unknown' }],
      run_account_deletion_session_family_cleanup: [{ job_state: 'completed' }],
    });
    expect((await run(f.dependencies, 'session')).status).toBe('completed');
    expect(f.providers).toEqual({ storage: 0, auth: 0 });
  });
  test('starts a fresh session revocation through its atomic durable cleanup boundary', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      run_account_deletion_session_family_cleanup: [{ job_state: 'completed' }],
    });
    expect((await run(f.dependencies, 'session')).status).toBe('completed');
    expect(f.events).toEqual([
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
      'rpc:run_account_deletion_session_family_cleanup',
    ]);
  });

  test('pre-egress deadline exhaustion retries each phase without prepare or cleanup', async () => {
    for (const phase of ['session', 'storage', 'auth'] as const) {
      const f = fixture({
        claim_account_deletion_external_job: [claim()],
        read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      });
      expect((await run(f.dependencies, phase, undefined, Date.now() + 100)).status).toBe('retry');
      expect(f.providers).toEqual({ storage: 0, auth: 0 });
      expect(f.calls.map((call) => call.name)).toEqual([
        'claim_account_deletion_external_job',
        'read_account_deletion_external_job',
      ]);
    }
  });

  test('storage removal response loss reconciles and never duplicates provider deletion', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'egress_unknown', attempt_state: 'egress_unknown' }],
      reconcile_account_deletion_storage_job: [{ job_state: 'reconciling', expected_work_count: 1, provider_proof_count: 0 }],
    });
    const outcome = await run(f.dependencies, 'storage');
    expect(outcome.status).toBe('partial');
    expect(f.providers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).not.toContain('prepare_account_deletion_external_egress');
  });

  test('proof/finalizer response loss uses authoritative storage readback rather than egress', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'egress_unknown', provider_proof_count: 1 }],
      reconcile_account_deletion_storage_job: [{ job_state: 'completed', storage_readback_passed: true, expected_work_count: 1, provider_proof_count: 1 }],
    });
    expect((await run(f.dependencies, 'storage')).status).toBe('completed');
    expect(f.providers.storage).toBe(0);
  });

  test('Auth deletion response loss reconciles authoritative absence before retry', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'egress_unknown', authoritative_absent: true }],
      reconcile_account_deletion_auth_job: [{ job_state: 'completed' }],
    });
    expect((await run(f.dependencies, 'auth')).status).toBe('completed');
    expect(f.providers.auth).toBe(0);
  });

  test('a competing worker is busy and an activated hold is held, never success', async () => {
    const busy = fixture({ claim_account_deletion_external_job: [{ claim_status: 'busy', job_state: 'leased' }] });
    expect((await run(busy.dependencies, 'auth')).status).toBe('busy');
    expect(busy.providers).toEqual({ storage: 0, auth: 0 });
    const held = fixture({ claim_account_deletion_external_job: [{ ...claim(), job_state: 'blocked', checkpoint_state: 'blocked' }] });
    expect((await run(held.dependencies, 'storage')).status).toBe('held');
    expect(held.providers).toEqual({ storage: 0, auth: 0 });
  });

  test('an expired pre-egress lease returns retry so SQL can release it for a fresh claim', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim(pastLease())],
    });
    expect((await run(f.dependencies, 'storage')).status).toBe('retry');
    expect(f.providers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).toEqual(['claim_account_deletion_external_job']);
  });

  test('a verifier-unavailable reconciliation remains retryable without deletion or fabricated proof', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [{
        claim_status: 'replayed',
        attempt_token: attemptToken,
        job_state: 'reconciliation_required',
        checkpoint_state: 'verify_absence_only',
      }],
      read_account_deletion_external_job: [{ job_state: 'reconciliation_required', attempt_state: 'reconciliation_required' }],
    }, null);
    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect(f.providers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).not.toContain('prepare_account_deletion_external_egress');
    expect(f.calls.map((call) => call.name)).not.toContain('record_account_deletion_external_provider_proof');
  });

  test('captures work, prepares, deletes, verifies, proves, and finalizes in that order without returning raw storage paths', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'active' }],
      reconcile_account_deletion_storage_job: [
        { job_state: 'completed', storage_readback_passed: true, expected_work_count: 1, provider_proof_count: 1 },
      ],
      prepare_account_deletion_external_egress: [{ job_state: 'egress_unknown', egress_state: 'egress_unknown', lease_expires_at: futureLease() }],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
      record_account_deletion_external_provider_proof: [{
        provider_receipt_ref: 'provider-receipt-001',
        proof_hash: receiptHash,
        source_manifest_hash: sourceManifestHash,
      }],
    });
    const outcome = await run(f.dependencies, 'storage');
    expect(outcome.status).toBe('completed');
    expect(f.providers.storage).toBe(1);
    expect(f.events).toEqual([
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
      'rpc:get_account_deletion_storage_work',
      'rpc:prepare_account_deletion_external_egress',
      'storage:delete',
      'storage:verify',
      'rpc:record_account_deletion_external_provider_proof',
      'rpc:reconcile_account_deletion_storage_job',
    ]);
    expect(JSON.stringify(outcome)).not.toContain('private/raw-path-never-returned');
    for (const call of f.calls) {
      expect(call.args.p_actor_user_id).toBe(actorUserId);
      expect(call.args.p_target_user_id).toBe(targetUserId);
      expect(call.args.p_request_id).toBe(requestId);
      expect(call.args.p_preview_hash).toBe(previewHash);
      expect(call.args.p_idempotency_key).toBe(idempotencyKey);
      expect(call.args.p_source_manifest_hash).toBe(sourceManifestHash);
    }
  });
  test('refuses a replacement between captured work and delete egress', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
      prepare_account_deletion_external_egress: [{ job_state: 'egress_unknown', egress_state: 'egress_unknown', lease_expires_at: futureLease() }],
      reconcile_account_deletion_storage_job: [{ job_state: 'reconciliation_required', expected_work_count: 1, provider_proof_count: 0 }],
    });
    let replacementDeleted = false;
    f.dependencies.storage = {
      async deleteObject(input) {
        expect(input.objectId).toBe(objectId);
        expect(input.objectVersion).toBe(objectVersion);
        const replacement = { objectId: secondObjectId, objectVersion: secondObjectVersion };
        if (input.objectId !== replacement.objectId || input.objectVersion !== replacement.objectVersion) {
          throw new Error('conditional delete refused replacement');
        }
        replacementDeleted = true;
      },
    };

    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect(replacementDeleted).toBeFalse();
    expect(f.verifiers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).not.toContain('record_account_deletion_external_provider_proof');
  });
  test('keeps a delayed provider effect verifier-only and fences hold activation after lease expiry', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
      prepare_account_deletion_external_egress: [{ job_state: 'egress_unknown', egress_state: 'egress_unknown', lease_expires_at: futureLease() }],
      reconcile_account_deletion_storage_job: [{ job_state: 'reconciliation_required', expected_work_count: 1, provider_proof_count: 0 }],
    });
    let abortObserved = false;
    f.dependencies.storage = {
      async deleteObject({ signal }) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            abortObserved = true;
            reject(new Error('provider deadline elapsed'));
          }, { once: true });
        });
      },
    };

    expect((await run(f.dependencies, 'storage', undefined, Date.now() + 1_900)).status).toBe('partial');
    expect(abortObserved).toBeTrue();
    expect(f.providers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).not.toContain('record_account_deletion_external_provider_proof');

    const migration = await readFile(new URL('../../../backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql', import.meta.url), 'utf8');
    const holdFenceStart = migration.lastIndexOf('CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_hold_subject_lock()');
    const holdFence = migration.slice(holdFenceStart, migration.indexOf('$function$;', holdFenceStart));
    expect(holdFence).toContain("attempt.state IN ('leased', 'egress_unknown', 'reconciliation_required')");
    expect(holdFence).not.toContain('attempt.lease_expires_at >');
  });
  test('serializes owner-wide storage writes through storage reconciliation and final Auth completion', async () => {
    const migration = await readFile(new URL('../../../backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql', import.meta.url), 'utf8');
    const sqlTest = await readFile(new URL('../../../backend/supabase/tests/g014_account_deletion_state_machine.sql', import.meta.url), 'utf8');
    const fenceStart = migration.lastIndexOf('CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()');
    const fence = migration.slice(fenceStart, migration.indexOf('$function$;', fenceStart));
    const finalizerStart = migration.lastIndexOf('CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_complete_external_job_phase(');
    const finalizer = migration.slice(finalizerStart, migration.indexOf('$function$;', finalizerStart));
    const authBranchStart = finalizer.indexOf("ELSIF p_phase = 'auth' THEN");
    const authBranch = finalizer.slice(
      authBranchStart,
      finalizer.indexOf('UPDATE public.account_deletion_request_items', authBranchStart),
    );

    expect(fenceStart).toBeGreaterThan(0);
    expect(migration).toContain(
      'CREATE POLICY g014_account_deletion_owner_fence_read\n  ON public.account_deletion_requests\n  FOR SELECT TO privacy_workflow_owner USING (true);',
    );
    expect(fence).toContain('v_new_owner_id text := NEW.owner_id::text');
    expect(fence).toContain('v_old_owner_id := OLD.owner_id::text');
    expect(fence).toContain("request_row.status IN ('previewed', 'applying', 'partial')");
    expect(fence).toContain('PERFORM privacy_retention.g014_account_deletion_lock_target(v_owner_uuid);');
    expect(fence).toContain('IF v_lifecycle_seen OR EXISTS (');
    expect(fence.indexOf('PERFORM privacy_retention.g014_account_deletion_lock_target(v_owner_uuid);'))
      .toBeLessThan(fence.indexOf('IF v_lifecycle_seen OR EXISTS ('));
    expect(fence).toContain('account_deletion_storage_owner_write_fenced');
    expect(fence).toContain('account_deletion_storage_object_write_fenced');

    expect(finalizerStart).toBeGreaterThan(0);
    expect(authBranch).toContain('SELECT NOT EXISTS (');
    expect(authBranch).toContain('FROM storage.objects');
    expect(authBranch).toContain('WHERE owner_id::text = v_request.target_user_id::text');
    expect(authBranch).toContain('account_deletion_auth_storage_authoritative_absence_failed');
    const storageWorkStart = migration.lastIndexOf('CREATE OR REPLACE FUNCTION public.get_account_deletion_storage_work(');
    const storageWork = migration.slice(storageWorkStart, migration.indexOf('$function$;', storageWorkStart));
    const verifierWorkStart = storageWork.indexOf("IF v_mode = 'verify_absence_only' THEN");
    const verifierWork = storageWork.slice(verifierWorkStart, storageWork.indexOf('RETURN;', verifierWorkStart));
    const capturedTableStart = migration.indexOf('CREATE TABLE privacy_retention.account_deletion_storage_objects (');
    const capturedTable = migration.slice(capturedTableStart, migration.indexOf(');', capturedTableStart) + 2);

    expect(capturedTable).toContain('object_locator_hash text NOT NULL');
    expect(capturedTable).toContain('object_version_hash text NOT NULL');
    expect(capturedTable).toContain('object_id uuid NOT NULL');
    expect(capturedTable).toContain('object_version text NOT NULL');
    expect(capturedTable).not.toContain('bucket_id text');
    expect(capturedTable).not.toContain('object_name text');
    expect(storageWorkStart).toBeGreaterThan(0);
    expect(verifierWork).toContain('NULL::text');
    expect(verifierWork).not.toContain('object_row.bucket_id');
    expect(verifierWork).not.toContain('object_row.name');

    const reconcileInsert = sqlTest.indexOf('uncaptured-during-storage-reconcile.bin');
    const firstStorageProof = sqlTest.indexOf('g014-storage-recovery-proof-0001');
    const finalStorageProof = sqlTest.indexOf('g014-storage-recovery-proof-0002');
    const betweenPhasesInsert = sqlTest.indexOf('uncaptured-between-storage-and-auth.bin');
    const storageCompletion = sqlTest.indexOf('storage phase completed without both object proofs and absence');
    const recoveryAuthClaim = sqlTest.indexOf(
      'SELECT * INTO v_auth_claim FROM public.claim_account_deletion_external_job(',
      betweenPhasesInsert,
    );
    expect(reconcileInsert).toBeGreaterThan(0);
    expect(reconcileInsert).toBeLessThan(firstStorageProof);
    expect(betweenPhasesInsert).toBeGreaterThan(0);
    expect(storageCompletion).toBeGreaterThan(firstStorageProof);
    expect(finalStorageProof).toBeGreaterThan(firstStorageProof);
    expect(finalStorageProof).toBeLessThan(storageCompletion);
    expect(storageCompletion).toBeLessThan(betweenPhasesInsert);
    expect(betweenPhasesInsert).toBeLessThan(recoveryAuthClaim);
  });
  test('fails closed before prepare when no owner-authorized conditional deletion adapter is configured', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
    });
    f.dependencies.storage = null;

    expect((await run(f.dependencies, 'storage')).status).toBe('retry');
    expect(f.providers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).toEqual([
      'claim_account_deletion_external_job',
      'read_account_deletion_external_job',
      'get_account_deletion_storage_work',
    ]);
  });
  test('does not delete captured storage work when durable prepare fails', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
      prepare_account_deletion_external_egress: [null],
    });
    expect((await run(f.dependencies, 'storage')).status).toBe('retry');
    expect(f.providers.storage).toBe(0);
    expect(f.verifiers.storage).toBe(0);
    expect(f.events).toEqual([
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
      'rpc:get_account_deletion_storage_work',
      'rpc:prepare_account_deletion_external_egress',
    ]);
  });

  test('recovers a lost prepare response tokenlessly as verifier-only work without a second delete', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [
        claim(),
        {
          claim_status: 'replayed',
          attempt_token: attemptToken,
          job_state: 'egress_unknown',
          checkpoint_state: 'verify_absence_only',
        },
      ],
      read_account_deletion_external_job: [
        { job_state: 'leased', attempt_state: 'leased' },
        { job_state: 'egress_unknown', attempt_state: 'egress_unknown' },
      ],
      get_account_deletion_storage_work: [
        [storageWork('delete_then_verify')],
        [storageWork('verify_absence_only')],
      ],
      prepare_account_deletion_external_egress: [{ egress_state: 'egress_unknown', lease_expires_at: futureLease() }],
      record_account_deletion_external_provider_proof: [{
        provider_receipt_ref: 'provider-receipt-001',
        proof_hash: receiptHash,
        source_manifest_hash: sourceManifestHash,
      }],
      reconcile_account_deletion_storage_job: [
        { job_state: 'egress_unknown', expected_work_count: 1, provider_proof_count: 0 },
        { job_state: 'completed', expected_work_count: 1, provider_proof_count: 1 },
      ],
    });
    const deleteObject = f.dependencies.storage!.deleteObject;
    f.dependencies.storage!.deleteObject = async (input) => {
      await deleteObject(input);
      throw new Error('simulated crash after prepare');
    };

    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect((await run(f.dependencies, 'storage')).status).toBe('completed');
    expect(f.providers.storage).toBe(1);
    expect(f.verifiers.storage).toBe(1);
    expect(f.events).toEqual([
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
      'rpc:get_account_deletion_storage_work',
      'rpc:prepare_account_deletion_external_egress',
      'storage:delete',
      'rpc:reconcile_account_deletion_storage_job',
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
      'rpc:get_account_deletion_storage_work',
      'storage:verify',
      'rpc:record_account_deletion_external_provider_proof',
      'rpc:reconcile_account_deletion_storage_job',
    ]);
  });
  test('advances a two-object crash recovery one durable prepare/proof cycle at a time', async () => {
    const firstObjectName = 'private/object-one';
    const secondObjectName = 'private/object-two';
    const f = fixture({
      claim_account_deletion_external_job: [
        claim(),
        {
          claim_status: 'replayed',
          attempt_token: attemptToken,
          job_state: 'egress_unknown',
          checkpoint_state: 'verify_absence_only',
        },
        claim(futureLease(), secondAttemptToken),
      ],
      read_account_deletion_external_job: [
        { job_state: 'leased', attempt_state: 'leased' },
        { job_state: 'egress_unknown', attempt_state: 'egress_unknown' },
        { job_state: 'leased', attempt_state: 'leased' },
      ],
      get_account_deletion_storage_work: [
        [storageWork('delete_then_verify', locatorHash, versionHash, firstObjectName)],
        [storageWork('verify_absence_only', locatorHash, versionHash, firstObjectName)],
        [storageWork('delete_then_verify', secondLocatorHash, secondVersionHash, secondObjectName)],
      ],
      prepare_account_deletion_external_egress: [
        { egress_state: 'egress_unknown', lease_expires_at: futureLease() },
        { egress_state: 'egress_unknown', lease_expires_at: futureLease() },
      ],
      record_account_deletion_external_provider_proof: [
        {
          provider_receipt_ref: 'provider-receipt-001',
          proof_hash: receiptHash,
          source_manifest_hash: sourceManifestHash,
        },
        {
          provider_receipt_ref: 'provider-receipt-002',
          proof_hash: receiptHash,
          source_manifest_hash: sourceManifestHash,
        },
      ],
      reconcile_account_deletion_storage_job: [
        { job_state: 'reconciliation_required', expected_work_count: 1, provider_proof_count: 0 },
        { job_state: 'pending', expected_work_count: 1, provider_proof_count: 1 },
        { job_state: 'completed', storage_readback_passed: true, expected_work_count: 2, provider_proof_count: 2 },
      ],
    }, {
      async verifyStorageDeletion(input) {
        return {
          providerReceiptRef: input.objectLocatorHash === locatorHash
            ? 'provider-receipt-001'
            : 'provider-receipt-002',
          providerReceiptHash: receiptHash,
        };
      },
    });
    const deletedObjectNames: string[] = [];
    const deleteObject = f.dependencies.storage!.deleteObject;
    f.dependencies.storage!.deleteObject = async (input) => {
      deletedObjectNames.push(input.objectName);
      await deleteObject(input);
      if (input.objectName === firstObjectName) throw new Error('crash after object one');
    };

    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect((await run(f.dependencies, 'storage')).status).toBe('completed');

    expect(deletedObjectNames).toEqual([firstObjectName, secondObjectName]);
    expect(f.providers.storage).toBe(2);
    expect(f.calls.filter((call) => call.name === 'claim_account_deletion_external_job')
      .every((call) => call.args.p_attempt_token === null)).toBe(true);
    expect(f.calls.filter((call) => call.name === 'prepare_account_deletion_external_egress')).toHaveLength(2);
    expect(f.calls.filter((call) => call.name === 'record_account_deletion_external_provider_proof')).toHaveLength(2);
  });
  test('rejects batch-shaped storage work before durable prepare or provider egress', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased' }],
      get_account_deletion_storage_work: [[
        storageWork('delete_then_verify', locatorHash, versionHash, 'private/object-one'),
        storageWork('delete_then_verify', secondLocatorHash, secondVersionHash, 'private/object-two'),
      ]],
    });
    expect((await run(f.dependencies, 'storage')).status).toBe('retry');
    expect(f.providers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).not.toContain('prepare_account_deletion_external_egress');
  });

  test('retries without durable prepare when the verifier is unavailable, then allows a fresh claim', async () => {
    const nextAttemptToken = '55555555-5555-4555-8555-555555555555';
    const f = fixture({
      claim_account_deletion_external_job: [claim(), claim(futureLease(), nextAttemptToken)],
      read_account_deletion_external_job: [
        { job_state: 'leased', attempt_state: 'leased' },
        { job_state: 'leased', attempt_state: 'leased' },
      ],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
      prepare_account_deletion_external_egress: [{ egress_state: 'egress_unknown', lease_expires_at: futureLease() }],
      record_account_deletion_external_provider_proof: [{
        provider_receipt_ref: 'provider-receipt-001',
        proof_hash: receiptHash,
        source_manifest_hash: sourceManifestHash,
      }],
      reconcile_account_deletion_storage_job: [{ job_state: 'completed', expected_work_count: 1, provider_proof_count: 1 }],
    }, null);

    expect((await run(f.dependencies, 'storage')).status).toBe('retry');
    expect(f.events).toEqual([
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
    ]);
    f.dependencies.storageProofVerifier = {
      async verifyStorageDeletion() {
        f.events.push('storage:verify');
        f.verifiers.storage += 1;
        return { providerReceiptRef: 'provider-receipt-001', providerReceiptHash: receiptHash };
      },
    };

    expect((await run(f.dependencies, 'storage')).status).toBe('completed');
    expect(f.providers.storage).toBe(1);
    expect(f.calls.filter((call) => call.name === 'prepare_account_deletion_external_egress')).toHaveLength(1);
  });

  test('rejects delete-shaped work after an unknown outcome without provider egress', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [{
        claim_status: 'replayed',
        attempt_token: attemptToken,
        job_state: 'reconciliation_required',
        checkpoint_state: 'verify_absence_only',
      }],
      read_account_deletion_external_job: [{
        job_state: 'reconciliation_required',
        attempt_state: 'reconciliation_required',
      }],
      get_account_deletion_storage_work: [[storageWork('delete_then_verify')]],
      reconcile_account_deletion_storage_job: [{ job_state: 'reconciliation_required', expected_work_count: 1, provider_proof_count: 0 }],
    });

    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect(f.providers.storage).toBe(0);
    expect(f.verifiers.storage).toBe(0);
    expect(f.events).toEqual([
      'rpc:claim_account_deletion_external_job',
      'rpc:read_account_deletion_external_job',
      'rpc:get_account_deletion_storage_work',
      'rpc:reconcile_account_deletion_storage_job',
    ]);
  });
  test('rejects raw locator fields from verifier-only storage work', async () => {
    const rawVerifierWork = {
      ...storageWork('verify_absence_only'),
      bucket_id: 'private-upload',
      object_name: 'private/raw-verifier-path',
    };
    const f = fixture({
      claim_account_deletion_external_job: [{
        claim_status: 'replayed',
        attempt_token: attemptToken,
        job_state: 'reconciliation_required',
        checkpoint_state: 'verify_absence_only',
      }],
      read_account_deletion_external_job: [{
        job_state: 'reconciliation_required',
        attempt_state: 'reconciliation_required',
      }],
      get_account_deletion_storage_work: [[rawVerifierWork]],
      reconcile_account_deletion_storage_job: [{
        job_state: 'reconciliation_required',
        expected_work_count: 1,
        provider_proof_count: 0,
      }],
    });

    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect(f.providers.storage).toBe(0);
    expect(f.verifiers.storage).toBe(0);
    expect(f.events).not.toContain('storage:verify');
  });
  test('replays completed durable receipts for every phase without reading work or contacting a provider', async () => {
    for (const phase of ['session', 'storage', 'auth'] as const) {
      const f = fixture({
        claim_account_deletion_external_job: [{
          claim_status: 'completed',
          job_state: 'completed',
          checkpoint_state: 'authoritative_absent',
        }],
      });
      expect((await run(f.dependencies, phase)).status).toBe('completed');
      expect(f.providers).toEqual({ storage: 0, auth: 0 });
      expect(f.verifiers.storage).toBe(0);
      expect(f.calls.map((call) => call.name)).toEqual(['claim_account_deletion_external_job']);
    }
  });

  test('treats the exact authoritative_absent zero-storage prepare result as completed', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [claim()],
      read_account_deletion_external_job: [{ job_state: 'leased', attempt_state: 'leased', authoritative_absent: true }],
      get_account_deletion_storage_work: [[]],
      prepare_account_deletion_external_egress: [{ egress_state: 'authoritative_absent' }],
    });
    f.dependencies.storage = null;
    expect((await run(f.dependencies, 'storage')).status).toBe('completed');
    expect(f.providers.storage).toBe(0);
    expect(f.verifiers.storage).toBe(0);
    expect(f.calls.map((call) => call.name)).toEqual([
      'claim_account_deletion_external_job',
      'read_account_deletion_external_job',
      'get_account_deletion_storage_work',
      'prepare_account_deletion_external_egress',
    ]);
  });

  test('reconciles a crash after storage deletion through verify_absence_only without repeat delete egress', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [{
        claim_status: 'replayed',
        attempt_token: attemptToken,
        job_state: 'reconciliation_required',
        checkpoint_state: 'verify_absence_only',
      }],
      read_account_deletion_external_job: [{
        job_state: 'reconciliation_required',
        attempt_state: 'reconciliation_required',
        authoritative_absent: true,
      }],
      get_account_deletion_storage_work: [[storageWork('verify_absence_only')]],
      record_account_deletion_external_provider_proof: [{
        provider_receipt_ref: 'provider-receipt-001',
        proof_hash: receiptHash,
        source_manifest_hash: sourceManifestHash,
      }],
      reconcile_account_deletion_storage_job: [{
        status: 'completed',
        job_state: 'completed',
        expected_work_count: 1,
        provider_proof_count: 1,
      }],
    });
    expect((await run(f.dependencies, 'storage')).status).toBe('completed');
    expect(f.providers.storage).toBe(0);
    expect(f.verifiers.storage).toBe(1);
    expect(f.calls.map((call) => call.name)).not.toContain('prepare_account_deletion_external_egress');
  });

  test('retries proof persistence after a verifier crash window without repeating a delete', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [
        claim(),
        {
          claim_status: 'replayed',
          attempt_token: attemptToken,
          job_state: 'reconciliation_required',
          checkpoint_state: 'verify_absence_only',
        },
      ],
      read_account_deletion_external_job: [
        { job_state: 'leased', attempt_state: 'leased', lease_expires_at: futureLease() },
        { job_state: 'reconciliation_required', attempt_state: 'reconciliation_required', authoritative_absent: true },
      ],
      prepare_account_deletion_external_egress: [{ egress_state: 'egress_unknown', lease_expires_at: futureLease() }],
      get_account_deletion_storage_work: [
        [storageWork('delete_then_verify')],
        [storageWork('verify_absence_only')],
      ],
      record_account_deletion_external_provider_proof: [
        null,
        {
          provider_receipt_ref: 'provider-receipt-001',
          proof_hash: receiptHash,
          source_manifest_hash: sourceManifestHash,
        },
      ],
      reconcile_account_deletion_storage_job: [
        { job_state: 'egress_unknown', expected_work_count: 1, provider_proof_count: 0 },
        { status: 'completed', job_state: 'completed', expected_work_count: 1, provider_proof_count: 1 },
      ],
    });

    expect((await run(f.dependencies, 'storage')).status).toBe('partial');
    expect((await run(f.dependencies, 'storage')).status).toBe('completed');
    expect(f.providers.storage).toBe(1);
    expect(f.verifiers.storage).toBe(2);
  });

  test('concurrent claim results issue only one delete authority', async () => {
    const f = fixture({
      claim_account_deletion_external_job: [
        claim(),
        { claim_status: 'busy', job_state: 'leased', checkpoint_state: 'delete_then_verify' },
      ],
      read_account_deletion_external_job: [{ job_state: 'egress_unknown', attempt_state: 'egress_unknown' }],
      reconcile_account_deletion_storage_job: [{ job_state: 'reconciliation_required', expected_work_count: 1, provider_proof_count: 0 }],
    });
    const outcomes = await Promise.all([
      run(f.dependencies, 'storage'),
      run(f.dependencies, 'storage'),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['busy', 'partial']);
    expect(f.providers.storage).toBe(0);
    expect(f.calls.filter((call) => call.name === 'prepare_account_deletion_external_egress')).toHaveLength(0);
  });

  test('session and Auth reconciliation-only claims never invoke delete egress', async () => {
    for (const phase of ['session', 'auth'] as const) {
      const f = fixture({
        claim_account_deletion_external_job: [{
          claim_status: 'replayed',
          attempt_token: attemptToken,
          job_state: 'reconciliation_required',
          checkpoint_state: 'verify_absence_only',
        }],
        read_account_deletion_external_job: [{ job_state: 'reconciliation_required', attempt_state: 'reconciliation_required' }],
        ...(phase === 'session'
          ? { run_account_deletion_session_family_cleanup: [{ job_state: 'reconciliation_required' }] }
          : { reconcile_account_deletion_auth_job: [{ job_state: 'reconciliation_required' }] }),
      });
      expect((await run(f.dependencies, phase)).status).toBe('partial');
      expect(f.providers).toEqual({ storage: 0, auth: 0 });
      expect(f.calls.map((call) => call.name)).not.toContain('prepare_account_deletion_external_egress');
    }
  });
});

describe('internal account-deletion worker route', () => {
  const validBody = JSON.stringify({ actorUserId, targetUserId, requestId, previewHash, idempotencyKey, sourceManifestHash, phase: 'session', deadlineMs: 4_000 });
  test('rejects malformed JSON, bad capability, and browser/session requests before service-role work', async () => {
    const before = process.env.ACCOUNT_DELETION_WORKER_CAPABILITY;
    process.env.ACCOUNT_DELETION_WORKER_CAPABILITY = 'x'.repeat(32);
    try {
      const badCapability = await POST(new NextRequest('http://internal.test/api/internal/account-deletion', { method: 'POST', headers: { 'content-type': 'application/json', 'x-account-deletion-worker-capability': 'bad-capability-value-over-thirty-two' }, body: validBody }));
      expect(badCapability.status).toBe(401);
      const malformed = await POST(new NextRequest('http://internal.test/api/internal/account-deletion', { method: 'POST', headers: { 'content-type': 'application/json', 'x-account-deletion-worker-capability': 'x'.repeat(32) }, body: '{"phase":"session"}' }));
      expect(malformed.status).toBe(400);
      expect(malformed.headers.get('cache-control')).toContain('no-store');
      const duplicateMember = await POST(new NextRequest('http://internal.test/api/internal/account-deletion', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-account-deletion-worker-capability': 'x'.repeat(32) },
        body: `{"actorUserId":"${actorUserId}","actorUserId":"${actorUserId}","targetUserId":"${targetUserId}","requestId":"${requestId}","previewHash":"${previewHash}","idempotencyKey":"${idempotencyKey}","sourceManifestHash":"${sourceManifestHash}","phase":"session","deadlineMs":4000}`,
      }));
      expect(duplicateMember.status).toBe(400);
      const browser = await POST(new NextRequest('http://internal.test/api/internal/account-deletion', { method: 'POST', headers: { 'content-type': 'application/json', 'x-account-deletion-worker-capability': 'x'.repeat(32), cookie: 'sb-session=browser' }, body: validBody }));
      expect(browser.status).toBe(401);
    } finally {
      if (before === undefined) delete process.env.ACCOUNT_DELETION_WORKER_CAPABILITY;
      else process.env.ACCOUNT_DELETION_WORKER_CAPABILITY = before;
    }
  });
});
describe('account-deletion durable scheduler contract', () => {
  test('claim-next returns only immutable worker binding fields and delegates the durable winner claim', async () => {
    const migration = await readFile(new URL('../../../backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql', import.meta.url), 'utf8');
    const start = migration.lastIndexOf('CREATE OR REPLACE FUNCTION public.claim_next_account_deletion_external_job()');
    const claimNext = migration.slice(start, migration.indexOf('ALTER FUNCTION public.claim_next_account_deletion_external_job()', start));

    expect(start).toBeGreaterThan(0);
    expect(claimNext).toContain('RETURNS TABLE (');
    expect(claimNext).toContain('attempt_token uuid');
    expect(claimNext).toContain('FROM public.claim_account_deletion_external_job(');
    expect(claimNext).toContain("v_claim.claim_status IN ('claimed', 'replayed')");
    expect(claimNext).not.toContain('bucket_id');
    expect(claimNext).not.toContain('object_name');
    expect(claimNext).not.toContain('storage.objects');
    expect(claimNext).toContain('LIMIT 64');
    expect(claimNext).toContain("EXCEPTION WHEN SQLSTATE '55000' THEN");
    expect(claimNext).toContain('CONTINUE;');
  });

  test('the internal claim-next mode is capability-gated, exact-body-only, and empty-safe', async () => {
    const route = await readFile(new URL('../app/api/internal/account-deletion/route.ts', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../lib/privacy/account-deletion-worker.ts', import.meta.url), 'utf8');

    expect(route).toContain("const CLAIM_NEXT_REQUEST_KEYS = ['deadlineMs', 'mode'] as const;");
    expect(route).toContain("record.mode === 'claim_next'");
    expect(route).toContain("const args = {} satisfies AccountDeletionClaimNextArgs;");
    expect(route).toContain("data: AccountDeletionClaimNextReturns | null;");
    expect(route).toContain("supabase.rpc('claim_next_account_deletion_external_job', args)");
    expect(route).toContain("if (claimed === 'empty') return emptyQueueResponse();");
    expect(route).toContain("if (!serverOnlyRequest(request) || !validWorkerCapability(request))");
    expect(route).toContain("status: 'empty', code: 'account_deletion_queue_empty'");
    expect(route).not.toContain('ServiceClient');
    expect(route).not.toContain('as unknown as');
    expect(worker).toContain("type AccountDeletionRpcFunctions = Pick<");
    expect(worker).toContain("Database['public']['Functions']");
    expect(worker).toContain("AccountDeletionRpcFunctions[Name]['Args']");
    expect(worker).toContain("AccountDeletionRpcFunctions[Name]['Returns']");
    expect(worker).toContain('rpc: <Name extends AccountDeletionRpcName>(');
    expect(worker).not.toContain('rpc: (name: string');
    expect(worker).not.toContain('args: Record<string, unknown>');
  });

  test('the bounded CLI sends no browser binding, stops on an empty queue, and logs fixed metadata only', async () => {
    const output: string[] = [];
    const requests: Array<{ body?: string; headers?: HeadersInit }> = [];
    const summary = await scheduler.runAccountDeletionWorkerScheduler({
      argv: ['--limit', '2', '--deadline-ms', '4000'],
      env: {
        ACCOUNT_DELETION_WORKER_URL: 'https://internal.example.test/api/internal/account-deletion',
        ACCOUNT_DELETION_WORKER_CAPABILITY: 'c'.repeat(32),
      },
      fetchImpl: async (_url: URL, init: RequestInit) => {
        requests.push({ body: typeof init.body === 'string' ? init.body : undefined, headers: init.headers });
        return new Response(JSON.stringify({
          status: 'empty',
          code: 'account_deletion_queue_empty',
          counts: { workItems: 0, providerProofs: 0 },
        }), { status: 200 });
      },
      write: (line: string) => output.push(line),
    });

    expect(summary).toEqual({ attempted: 0, completed: 0, partial: 0, failed: 0, unknown: 0, empty: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toBe(JSON.stringify({ mode: 'claim_next', deadlineMs: 4000 }));
    expect(output).toEqual(['code=empty attempted=0 completed=0 partial=0 failed=0 unknown=0 empty=1\n']);
    expect(output.join('')).not.toContain('private/raw-locator-never-log');
  });

  test('the bounded CLI marks replay/partial work non-success without another batch attempt', async () => {
    const output: string[] = [];
    let calls = 0;
    const summary = await scheduler.runAccountDeletionWorkerScheduler({
      argv: ['--limit', '2'],
      env: {
        ACCOUNT_DELETION_WORKER_URL: 'https://internal.example.test/api/internal/account-deletion',
        ACCOUNT_DELETION_WORKER_CAPABILITY: 'd'.repeat(32),
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          status: 'partial',
          phase: 'storage',
          requestHash: 'a'.repeat(64),
          counts: { workItems: 1, providerProofs: 0 },
        }), { status: 503 });
      },
      write: (line: string) => output.push(line),
    });

    expect(calls).toBe(1);
    expect(summary).toEqual({ attempted: 1, completed: 0, partial: 1, failed: 0, unknown: 0, empty: 0 });
    expect(scheduler.summaryCode(summary)).toBe('partial');
    expect(output).toEqual(['code=partial attempted=1 completed=0 partial=1 failed=0 unknown=0 empty=0\n']);
    expect(output.join('')).not.toContain('a'.repeat(64));
  });
  test('the bounded CLI rejects an unexpected raw field as unknown without logging it', async () => {
    const output: string[] = [];
    const summary = await scheduler.runAccountDeletionWorkerScheduler({
      env: {
        ACCOUNT_DELETION_WORKER_URL: 'https://internal.example.test/api/internal/account-deletion',
        ACCOUNT_DELETION_WORKER_CAPABILITY: 'e'.repeat(32),
      },
      fetchImpl: async () => new Response(JSON.stringify({
        status: 'empty',
        code: 'account_deletion_queue_empty',
        counts: { workItems: 0, providerProofs: 0 },
        objectName: 'private/raw-locator-never-log',
      }), { status: 200 }),
      write: (line: string) => output.push(line),
    });

    expect(summary).toEqual({ attempted: 1, completed: 0, partial: 0, failed: 0, unknown: 1, empty: 0 });
    expect(output).toEqual(['code=unknown attempted=1 completed=0 partial=0 failed=0 unknown=1 empty=0\n']);
    expect(output.join('')).not.toContain('private/raw-locator-never-log');
  });
});
