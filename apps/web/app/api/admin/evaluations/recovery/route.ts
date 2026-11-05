import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { isRecordMutationAdmitted } from '@/lib/admin/record-action-admission';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { z } from 'zod';
import {
  RECOVERY_ERROR_CODES, RecoveryContextSchema, RecoveryRequestSchema, RecoveryStatusSchema, parseRecoveryJob,
  type RecoveryErrorCode,
} from '@/lib/admin/evaluation-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RpcResult = { data: unknown; error: { message?: string } | null };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
const headers = { 'Cache-Control': 'private, no-store' };
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const fixedCode = (error: { message?: string } | null): RecoveryErrorCode => {
  if (error?.message === 'REVIEW_AUTOMATION_OPERATOR_INVALID') return 'EVIDENCE_RECOVERY_FORBIDDEN';
  return RECOVERY_ERROR_CODES.includes(error?.message as RecoveryErrorCode) ? error!.message as RecoveryErrorCode : 'EVIDENCE_RECOVERY_UNAVAILABLE';
};
function failed(code: RecoveryErrorCode) {
  const status = code === 'EVIDENCE_RECOVERY_FORBIDDEN' ? 403 : code === 'EVIDENCE_RECOVERY_NOT_FOUND' ? 404
    : ['EVIDENCE_RECOVERY_INVALID_PAYLOAD', 'EVIDENCE_RECOVERY_CONFIRMATION_REQUIRED', 'EVIDENCE_RECOVERY_PRIVACY_UNSAFE'].includes(code) ? 400
      : ['EVIDENCE_RECOVERY_UNAVAILABLE', 'EVIDENCE_RECOVERY_NOT_ADMITTED'].includes(code) ? 503 : 409;
  return respond({ error: code }, status);
}
function rpcClient(): Rpc {
  const client = createSupabaseServiceRoleClient();
  return client.rpc.bind(client) as unknown as Rpc;
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const id = z.uuid().safeParse(params.get('restaurantId'));
  if (!id.success || [...params.keys()].some(key => key !== 'restaurantId') || params.getAll('restaurantId').length !== 1) return failed('EVIDENCE_RECOVERY_INVALID_PAYLOAD');
  try {
    const rpc = rpcClient();
    const result = await rpc('restaurant_evidence_recovery_status', { p_actor: auth.userId, p_restaurant_id: id.data });
    if (result.error) return failed(fixedCode(result.error));
    const status = RecoveryStatusSchema.parse(result.data);
    if (status.restaurantId !== id.data || status.jobs.some(job => job.restaurantId !== id.data)) return failed('EVIDENCE_RECOVERY_UNAVAILABLE');
    try { for (const job of status.jobs) if (job.proposal) assertPrivacySafe(job.proposal, { locationClass: 'business', maxEntries: 1000 }); }
    catch { return failed('EVIDENCE_RECOVERY_PRIVACY_UNSAFE'); }
    const binding = await rpc('restaurant_evidence_recovery_context', { p_actor: auth.userId, p_restaurant_id: id.data });
    if (binding.error) return respond({ ...status, context: null, contextError: fixedCode(binding.error) });
    const context = RecoveryContextSchema.parse(binding.data);
    if (context.restaurantId !== id.data) return failed('EVIDENCE_RECOVERY_UNAVAILABLE');
    return respond({ ...status, context, contextError: null });
  } catch { return failed('EVIDENCE_RECOVERY_UNAVAILABLE'); }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isTrustedSameOriginMutation(request)) return respond({ error: 'INVALID_ORIGIN' }, 403);
  const json = await readBoundedJsonRequest(request, 4096);
  const parsed = json.ok ? RecoveryRequestSchema.safeParse(json.value) : null;
  if (!parsed?.success) return failed('EVIDENCE_RECOVERY_INVALID_PAYLOAD');
  const input = parsed.data;
  if (input.phase !== 'read' && !isRecordMutationAdmitted()) return failed('EVIDENCE_RECOVERY_NOT_ADMITTED');
  try {
    const rpc = rpcClient();
    if (input.phase === 'preview_apply' || input.phase === 'apply') {
      const draft = await rpc('restaurant_evidence_recovery_status', { p_actor: auth.userId, p_restaurant_id: input.restaurantId });
      if (draft.error) return failed(fixedCode(draft.error));
      const status = RecoveryStatusSchema.parse(draft.data);
      if (status.restaurantId !== input.restaurantId) return failed('EVIDENCE_RECOVERY_UNAVAILABLE');
      const job = status.jobs.find(job => job.jobId === input.jobId && job.restaurantId === input.restaurantId);
      const appliedReadback = input.phase === 'apply' && job?.state === 'applied' && job.applyOperationId === input.operationId;
      if (!appliedReadback) {
        if (!job || job.state !== 'draft' || !job.proposal) return failed('EVIDENCE_RECOVERY_DRAFT_REQUIRED');
        try { assertPrivacySafe(job.proposal, { locationClass: 'business', maxEntries: 1000 }); }
        catch { return failed('EVIDENCE_RECOVERY_PRIVACY_UNSAFE'); }
      }
    }
    const result = await rpc('restaurant_evidence_recovery_admin', {
      p_actor: auth.userId, p_phase: input.phase, p_operation_id: input.operationId,
      p_job_id: input.jobId, p_restaurant_id: input.restaurantId, p_policy_version: input.policyVersion ?? null,
      p_row_sha256: input.rowSha256 ?? null, p_input_sha256: input.inputSha256 ?? null,
      p_preview_hash: input.previewHash ?? null, p_confirmation: input.confirmation ?? null,
    });
    if (result.error) return failed(fixedCode(result.error));
    const job = parseRecoveryJob(result.data, input);
    if (input.phase !== 'read') {
      const preview = input.phase.startsWith('preview_');
      const action = input.phase === 'preview_request' || input.phase === 'request' ? 'restaurant.evidence_recovery.request'
        : input.phase === 'preview_retire' || input.phase === 'retire' ? 'restaurant.evidence_recovery.retire' : 'restaurant.evidence_recovery.apply';
      if (!job.receipt || job.receipt.action !== action || job.receipt.state !== (preview ? 'preview' : 'applied')
        || (input.previewHash && job.receipt.previewHash !== input.previewHash)
        || String(job.policyVersion) !== String(input.policyVersion) || job.rowSha256 !== input.rowSha256 || job.inputSha256 !== input.inputSha256
        || (input.phase === 'apply' && job.state !== 'applied')
        || (input.phase === 'preview_apply' && job.state !== 'draft')
        || (input.phase === 'preview_retire' && job.state !== 'draft')
        || (input.phase === 'retire' && (job.state !== 'failed' || !['source_changed', 'policy_changed'].includes(job.reason)))
        || (input.phase === 'preview_request' && job.state !== 'preview')
        || (preview ? job.receipt.auditId !== null : job.receipt.auditId === null)) return failed('EVIDENCE_RECOVERY_UNAVAILABLE');
    }
    return respond(job);
  } catch { return failed('EVIDENCE_RECOVERY_UNAVAILABLE'); }
}
