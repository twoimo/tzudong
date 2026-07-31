import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
  buildAdminMapOverlayRequestMetadata,
  mapAdminMapOverlayRouteActionToRpcAction,
  normalizeAdminMapOverlayPreviewRequest,
} from '@/lib/admin-map-overlays';
import {
  buildTrendProposalPreviewHash,
  buildTrendProposalPreviewPayloadHash,
} from '@/lib/admin/trend-proposals';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TrendProposalRouteContext = {
  params: Promise<{ proposalId: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_TREND_PROPOSAL_APPROVAL_REQUEST_BYTES = 64 * 1024;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isUuid(value: string | null) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function isSha256(value: string | null) {
  return Boolean(value && SHA256_PATTERN.test(value));
}

function isValidIdempotencyKey(value: string | null) {
  return Boolean(value && value.length >= 8 && value.length <= 128);
}

function readRpcErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'trend_proposal_approval_failed';
  const rawMessage = 'message' in error ? String((error as Record<string, unknown>).message) : '';
  const knownCodes = [
    'invalid_trend_proposal_approval_request',
    'trend_proposal_confirmation_required',
    'trend_proposal_not_found',
    'trend_proposal_idempotency_conflict',
    'trend_proposal_hash_stale',
    'trend_proposal_not_pending',
    'trend_proposal_preview_stale',
  ];
  return knownCodes.find((code) => rawMessage.includes(code)) ?? 'trend_proposal_approval_failed';
}

function statusForRpcErrorCode(errorCode: string): 400 | 404 | 409 | 502 {
  if (errorCode === 'trend_proposal_not_found') return 404;
  if (
    errorCode === 'trend_proposal_idempotency_conflict' ||
    errorCode === 'trend_proposal_hash_stale' ||
    errorCode === 'trend_proposal_not_pending' ||
    errorCode === 'trend_proposal_preview_stale'
  ) return 409;
  if (errorCode === 'trend_proposal_approval_failed') return 502;
  return 400;
}

export async function POST(request: NextRequest, context: TrendProposalRouteContext) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ ok: false, error: 'Forbidden' }, { status: 403 });
  }


  const { proposalId } = await context.params;
  if (!UUID_PATTERN.test(proposalId)) {
    return noStoreJson({ ok: false, error: 'trend_proposal_not_found' }, { status: 404 });
  }

  const requestBody = await readBoundedJsonRequest(request, MAX_TREND_PROPOSAL_APPROVAL_REQUEST_BYTES);
  if (!requestBody.ok) {
    return noStoreJson({ ok: false, error: 'invalid_trend_proposal_approval_request' }, { status: 400 });
  }

  const body = readRecord(requestBody.value);
  if (!body) {
    return noStoreJson({ ok: false, error: 'invalid_trend_proposal_approval_request' }, { status: 400 });
  }

  let normalized: ReturnType<typeof normalizeAdminMapOverlayPreviewRequest>;
  try {
    normalized = normalizeAdminMapOverlayPreviewRequest(
      body.normalizedOverlayPayload ?? body.normalized ?? body.overlayPayload,
    );
  } catch {
    return noStoreJson({ ok: false, error: 'invalid_trend_proposal_approval_request' }, { status: 400 });
  }

  const confirmationText = readOptionalString(body.confirmationText);
  const expectedProposalHash = readOptionalString(body.expectedProposalHash ?? body.expected_proposal_hash);
  const previewHash = readOptionalString(body.previewHash);
  const suppliedPayloadHash = readOptionalString(body.payloadHash);
  const correlationId = readOptionalString(body.correlationId ?? body.correlation_id);
  const idempotencyKey = readOptionalString(body.idempotencyKey ?? body.idempotency_key);
  const previewExpiresAt = readOptionalString(body.previewExpiresAt ?? body.expiresAt);

  if (confirmationText !== ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT) {
    return noStoreJson({ ok: false, error: 'trend_proposal_confirmation_required' }, { status: 400 });
  }
  if (!isSha256(expectedProposalHash) || !isSha256(previewHash) || !isSha256(suppliedPayloadHash) || !isUuid(correlationId) || !isValidIdempotencyKey(idempotencyKey)) {
    return noStoreJson({ ok: false, error: 'invalid_trend_proposal_approval_request' }, { status: 400 });
  }

  const expectedPreviewHash = buildTrendProposalPreviewHash(normalized);
  if (previewHash !== expectedPreviewHash) {
    return noStoreJson({ ok: false, error: 'trend_proposal_preview_stale' }, { status: 409 });
  }

  if (previewExpiresAt) {
    const previewExpiresAtTime = new Date(previewExpiresAt).getTime();
    if (!Number.isFinite(previewExpiresAtTime) || previewExpiresAtTime <= Date.now()) {
      return noStoreJson({ ok: false, error: 'trend_proposal_preview_stale' }, { status: 409 });
    }
  }

  const payloadHash = buildTrendProposalPreviewPayloadHash({ proposalId, normalized, previewHash });
  if (suppliedPayloadHash !== payloadHash) {
    return noStoreJson({ ok: false, error: 'trend_proposal_preview_stale' }, { status: 409 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const routeMetadata = buildAdminMapOverlayRequestMetadata(request.headers);
    const routeAction = normalized.action;
    const rpcAction = mapAdminMapOverlayRouteActionToRpcAction(routeAction);
    const requestMetadata = {
      route: '/api/admin/trend-proposals/[proposalId]/approve',
      proposalId,
      expectedProposalHash,
      previewHash,
      payloadHash,
      payloadVersion: 1,
      overlayType: normalized.overlayType,
      restaurantId: normalized.restaurantId,
      routeAction,
      rpcAction: 'approve_proposal_overlay',
      correlationId,
      idempotencyKey,
      actorUserId: admin.userId,
      requestId: routeMetadata.requestId,
      ipHash: routeMetadata.ipHash,
      userAgentHash: routeMetadata.userAgentHash,
      overlayRpcAction: rpcAction,
    };

    const { data, error } = await supabase.rpc(
      'approve_admin_restaurant_map_overlay_proposal' as never,
      {
        p_actor_user_id: admin.userId,
        p_proposal_id: proposalId,
        p_expected_proposal_hash: expectedProposalHash,
        p_confirmation_text: confirmationText,
        p_required_confirmation_text: ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
        p_reason: normalized.reason,
        p_overlay_payload: normalized,
        p_preview_hash: previewHash,
        p_payload_hash: payloadHash,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey,
        p_request_metadata: requestMetadata,
      } as never,
    );

    if (error) {
      const errorCode = readRpcErrorCode(error);
      return noStoreJson({ ok: false, error: errorCode }, { status: statusForRpcErrorCode(errorCode) });
    }

    return noStoreJson(data && typeof data === 'object' && !Array.isArray(data) ? data : { ok: false, error: 'trend_proposal_approval_failed' }, data && typeof data === 'object' && !Array.isArray(data) ? undefined : { status: 502 });
  } catch {
    return noStoreJson({ ok: false, error: 'trend_proposal_approval_failed' }, { status: 502 });
  }
}
