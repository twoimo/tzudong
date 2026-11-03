import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { RECOVERY_CONFIRMATIONS } from '@/lib/admin/evaluation-recovery';

const actor = '00000000-0000-4000-8000-000000000001';
const restaurantId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const operationId = '00000000-0000-4000-8000-000000000004';
const auditId = '00000000-0000-4000-8000-000000000005';
const context = { schemaVersion: 1, restaurantId, policyVersion: 2, rowSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), videoId: 'ABCDEFGHIJK', originName: 'fixture restaurant', sourceUpdatedAt: '2026-11-03T10:00:00Z' };
const base = { schemaVersion: 1, restaurantId, policyVersion: 2, rowSha256: context.rowSha256, inputSha256: context.inputSha256, videoId: context.videoId, jobId, resultSha256: 'c'.repeat(64) };
const proposal = { evaluation_results: { visit_authenticity: { eval_value: 1, eval_basis: '00:12 public fixture evidence' } }, geocoding_success: false, categories: ['한식'] };
const binding = { restaurantId, jobId, operationId, policyVersion: 2, rowSha256: context.rowSha256, inputSha256: context.inputSha256 };
let allowed = true;
let statusResult: unknown;
let contextError: { message: string } | null;
let databaseError: { message: string } | null;
let responseWrongJob = false;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const oldHold = process.env.ADMIN_RECORD_MUTATIONS_HOLD;

function receipt(phase: string) {
  const preview = phase.startsWith('preview_');
  return { operationId, action: phase.includes('retire') ? 'restaurant.evidence_recovery.retire' : phase.includes('apply') ? 'restaurant.evidence_recovery.apply' : 'restaurant.evidence_recovery.request', state: preview ? 'preview' : 'applied', targetIds: [restaurantId], jobId, auditId: preview ? null : auditId, previewHash: 'd'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', readback: [{ id: restaurantId, kind: 'restaurant', status: 'hold', fingerprint: context.rowSha256 }], mediaCleanupPending: false, policyVersion: 2, rowSha256: context.rowSha256, inputSha256: context.inputSha256, videoId: context.videoId, ...(phase.includes('retire') ? { retirementPolicyVersion: 3 } : {}) };
}
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => allowed ? { ok: true, userId: actor } : { ok: false, response: new Response(null, { status: 403 }) } }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args });
  if (databaseError) return { data: null, error: databaseError };
  if (name === 'restaurant_evidence_recovery_status') return { data: statusResult, error: null };
  if (name === 'restaurant_evidence_recovery_context') return { data: context, error: contextError };
  const phase = String(args.p_phase);
  return { data: { ...base, jobId: responseWrongJob ? auditId : jobId, state: phase === 'preview_request' ? 'preview' : phase === 'request' ? 'queued' : phase === 'apply' ? 'applied' : phase === 'retire' ? 'failed' : 'draft', reason: phase === 'retire' ? 'policy_changed' : 'fixture', receipt: receipt(phase) }, error: null };
} }) }));
const { GET, POST } = await import('@/app/api/admin/evaluations/recovery/route');
const get = () => new Request(`http://127.0.0.1:18794/api/admin/evaluations/recovery?restaurantId=${restaurantId}`);
const post = (body: unknown, origin = 'http://127.0.0.1:18794') => new Request('http://127.0.0.1:18794/api/admin/evaluations/recovery', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  allowed = true; contextError = null; databaseError = null; responseWrongJob = false; calls.length = 0;
  process.env.ADMIN_RECORD_MUTATIONS_HOLD = 'cleared';
  statusResult = { schemaVersion: 1, restaurantId, jobs: [{ ...base, state: 'draft', reason: 'evidence_ready', receipt: null, requestOperationId: jobId, applyOperationId: null, retireOperationId: null, proposal }] };
});
afterAll(() => { if (oldHold === undefined) delete process.env.ADMIN_RECORD_MUTATIONS_HOLD; else process.env.ADMIN_RECORD_MUTATIONS_HOLD = oldHold; mock.restore(); });

describe('source-bound held evidence recovery route', () => {
  test('authorizes before reading the recovery ledger or accepting a mutation', async () => {
    allowed = false;
    expect((await GET(get())).status).toBe(403);
    expect((await POST(post({ ...binding, phase: 'preview_request' }))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('rejects malformed targets, foreign origins, and caller-supplied evaluation facts', async () => {
    expect((await GET(new Request('http://127.0.0.1:18794/api/admin/evaluations/recovery?restaurantId=invalid'))).status).toBe(400);
    expect((await POST(post({ ...binding, phase: 'preview_request' }, 'https://untrusted.test'))).status).toBe(403);
    expect((await POST(post({ ...binding, phase: 'preview_request', evaluation_results: proposal.evaluation_results }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('preserves write admission while keeping readback available', async () => {
    process.env.ADMIN_RECORD_MUTATIONS_HOLD = 'active';
    expect((await POST(post({ ...binding, phase: 'preview_request' }))).status).toBe(503);
    expect(calls).toHaveLength(0);
    expect((await POST(post({ restaurantId, jobId, operationId, phase: 'read' }))).status).toBe(200);
    expect(calls.map(x => x.name)).toEqual(['restaurant_evidence_recovery_admin']);
  });

  test('reads bounded durable jobs and exact current source independently of the active-job guard', async () => {
    contextError = { message: 'EVIDENCE_RECOVERY_WORK_OUTSTANDING' };
    const response = await GET(get());
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.context).toBeNull();
    expect(value.contextError).toBe('EVIDENCE_RECOVERY_WORK_OUTSTANDING');
    expect(value.jobs[0].jobId).toBe(jobId);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(calls).toHaveLength(2);
  });

  test('requires the exact confirmation and rejects a preview that tries to confirm', async () => {
    for (const body of [{ ...binding, phase: 'request' }, { ...binding, phase: 'request', previewHash: 'd'.repeat(64), confirmation: RECOVERY_CONFIRMATIONS.apply }, { ...binding, phase: 'preview_request', confirmation: RECOVERY_CONFIRMATIONS.request }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    const response = await POST(post({ ...binding, phase: 'request', previewHash: 'd'.repeat(64), confirmation: RECOVERY_CONFIRMATIONS.request }));
    expect(response.status).toBe(200);
    expect(calls[0].args.p_operation_id).toBe(operationId);
    expect(calls[0].args.p_row_sha256).toBe(context.rowSha256);
  });

  test('rejects diagnostics or sensitive facts before displaying or applying a draft', async () => {
    statusResult = { schemaVersion: 1, restaurantId, jobs: [{ ...base, state: 'draft', reason: 'evidence_ready', receipt: null, requestOperationId: jobId, applyOperationId: null, retireOperationId: null, proposal: { ...proposal, evaluation_results: { visit_authenticity: { eval_value: 1, eval_basis: 'private@example.com' } } } }] };
    for (const response of [await GET(get()), await POST(post({ ...binding, phase: 'preview_apply' }))]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'EVIDENCE_RECOVERY_PRIVACY_UNSAFE' });
    }
    expect(calls.some(x => x.name === 'restaurant_evidence_recovery_admin')).toBe(false);
  });

  test('a confirmed applied operation can be reconciled without a new draft or write identity', async () => {
    statusResult = { schemaVersion: 1, restaurantId, jobs: [{ ...base, state: 'applied', reason: 'evidence_applied', receipt: null, requestOperationId: jobId, applyOperationId: operationId, retireOperationId: null, proposal: null }] };
    const response = await POST(post({ ...binding, phase: 'apply', previewHash: 'd'.repeat(64), confirmation: RECOVERY_CONFIRMATIONS.apply }));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].args.p_operation_id).toBe(operationId);
  });

  test('stale source and unexpected response identity never become success', async () => {
    databaseError = { message: 'EVIDENCE_RECOVERY_STALE' };
    expect((await POST(post({ ...binding, phase: 'preview_request' }))).status).toBe(409);
    databaseError = null; responseWrongJob = true;
    expect((await POST(post({ ...binding, phase: 'preview_request' }))).status).toBe(503);
  });

  test('unknown database/provider failure returns one fixed error without replay', async () => {
    databaseError = { message: 'private-provider-body-and-token' };
    const response = await POST(post({ ...binding, phase: 'preview_request' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'EVIDENCE_RECOVERY_UNAVAILABLE' });
    expect(calls).toHaveLength(1);
  });

  test('explicit stale-draft retirement uses a separate confirmation and policy-bound receipt', async () => {
    expect((await POST(post({ ...binding, phase: 'preview_retire' }))).status).toBe(200);
    calls.length = 0;
    expect((await POST(post({ ...binding, phase: 'retire', previewHash: 'd'.repeat(64), confirmation: RECOVERY_CONFIRMATIONS.apply }))).status).toBe(400);
    expect(calls).toHaveLength(0);
    const response = await POST(post({ ...binding, phase: 'retire', previewHash: 'd'.repeat(64), confirmation: RECOVERY_CONFIRMATIONS.retire }));
    expect(response.status).toBe(200);
    const job = await response.json();
    expect(job.state).toBe('failed');
    expect(job.receipt.action).toBe('restaurant.evidence_recovery.retire');
    expect(job.receipt.retirementPolicyVersion).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_phase).toBe('retire');
  });

  test('policy and unknown retirement failures do not execute any follow-up request', async () => {
    for (const message of ['EVIDENCE_RECOVERY_POLICY_CHANGED', 'private-unknown-error']) {
      calls.length = 0; databaseError = { message };
      const response = await POST(post({ ...binding, phase: 'preview_retire' }));
      expect(response.status).toBe(message.includes('POLICY_CHANGED') ? 409 : 503);
      expect(calls).toHaveLength(1);
      expect(calls[0].args.p_phase).toBe('preview_retire');
    }
  });
});
