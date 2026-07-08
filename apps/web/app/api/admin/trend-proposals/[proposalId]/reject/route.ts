import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { buildAdminMapOverlayRequestMetadata } from '@/lib/admin-map-overlays';
import {
  buildTrendProposalReviewRequestHash,
  normalizeTrendProposalReviewRequest,
} from '@/lib/admin/trend-proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TrendProposalRouteContext = {
  params: Promise<{ proposalId: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRpcErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'trend_proposal_review_failed';
  const rawMessage = 'message' in error ? String((error as Record<string, unknown>).message) : '';
  const knownCodes = [
    'invalid_trend_proposal_review_request',
    'trend_proposal_review_reason_required',
    'trend_proposal_not_found',
    'trend_proposal_review_idempotency_conflict',
    'trend_proposal_hash_stale',
    'trend_proposal_not_pending',
  ];
  return knownCodes.find((code) => rawMessage.includes(code)) ?? 'trend_proposal_review_failed';
}

function statusForRpcErrorCode(errorCode: string): 400 | 404 | 409 | 502 {
  if (errorCode === 'trend_proposal_not_found') return 404;
  if (
    errorCode === 'trend_proposal_review_idempotency_conflict' ||
    errorCode === 'trend_proposal_hash_stale' ||
    errorCode === 'trend_proposal_not_pending'
  ) return 409;
  if (errorCode === 'trend_proposal_review_failed') return 502;
  return 400;
}

export async function POST(request: NextRequest, context: TrendProposalRouteContext) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  const { proposalId } = await context.params;
  if (!UUID_PATTERN.test(proposalId)) {
    return noStoreJson({ ok: false, error: 'trend_proposal_not_found' }, { status: 404 });
  }

  let normalized: ReturnType<typeof normalizeTrendProposalReviewRequest>;
  try {
    normalized = normalizeTrendProposalReviewRequest(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_trend_proposal_review_request';
    return noStoreJson({ ok: false, error: message === 'trend_proposal_review_reason_required' ? message : 'invalid_trend_proposal_review_request' }, { status: 400 });
  }

  const requestHash = buildTrendProposalReviewRequestHash({ proposalId, ...normalized });

  try {
    const supabase = createSupabaseServiceRoleClient();
    const requestMetadata = {
      ...buildAdminMapOverlayRequestMetadata(request.headers),
      route: '/api/admin/trend-proposals/[proposalId]/reject',
      proposalId,
      transition: normalized.transition,
      expectedProposalHash: normalized.expectedProposalHash,
      requestHash,
    };
    const { data, error } = await supabase.rpc(
      'review_admin_restaurant_map_overlay_proposal' as never,
      {
        p_actor_user_id: admin.userId,
        p_proposal_id: proposalId,
        p_transition: normalized.transition,
        p_reason: normalized.reason,
        p_expected_proposal_hash: normalized.expectedProposalHash,
        p_correlation_id: normalized.correlationId,
        p_idempotency_key: normalized.idempotencyKey,
        p_request_hash: requestHash,
        p_request_metadata: requestMetadata,
      } as never,
    );

    if (error) {
      const errorCode = readRpcErrorCode(error);
      return noStoreJson({ ok: false, error: errorCode }, { status: statusForRpcErrorCode(errorCode) });
    }

    return noStoreJson(data && typeof data === 'object' && !Array.isArray(data) ? data : { ok: false, error: 'trend_proposal_review_failed' }, data && typeof data === 'object' && !Array.isArray(data) ? undefined : { status: 502 });
  } catch {
    return noStoreJson({ ok: false, error: 'trend_proposal_review_failed' }, { status: 502 });
  }
}
