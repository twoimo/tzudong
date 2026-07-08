import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
  buildAdminMapOverlayPayloadHash,
  buildAdminMapOverlayPreviewHash,
  buildAdminMapOverlayRequestMetadata,
  mapAdminMapOverlayRouteActionToRpcAction,
  normalizeAdminMapOverlayPreviewRequest,
} from '@/lib/admin-map-overlays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

function isValidIdempotencyKey(value: string | null) {
  return Boolean(value && value.length >= 8 && value.length <= 128);
}

function readRpcErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'overlay_apply_failed';
  const rawMessage = 'message' in error ? String((error as Record<string, unknown>).message) : '';
  const knownCodes = [
    'overlay_actor_required',
    'overlay_action_invalid',
    'overlay_restaurant_not_found',
    'overlay_type_invalid',
    'overlay_label_invalid',
    'overlay_description_invalid',
    'overlay_active_window_invalid',
    'overlay_reason_required',
    'overlay_hash_invalid',
    'overlay_idempotency_invalid',
    'overlay_not_found_for_deactivate',
    'overlay_idempotency_conflict',
  ];
  return knownCodes.find((code) => rawMessage.includes(code)) ?? 'overlay_apply_failed';
}

function statusForRpcErrorCode(errorCode: string): 400 | 404 | 409 | 502 {
  if (errorCode === 'overlay_restaurant_not_found' || errorCode === 'overlay_not_found_for_deactivate') return 404;
  if (errorCode === 'overlay_idempotency_conflict') return 409;
  if (errorCode === 'overlay_apply_failed') return 502;
  return 400;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' ? item : null;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-request');
    body = parsed as Record<string, unknown>;
  } catch {
    return noStoreJson({ error: 'invalid_overlay_apply_request' }, { status: 400 });
  }

  let normalized: ReturnType<typeof normalizeAdminMapOverlayPreviewRequest>;
  try {
    normalized = normalizeAdminMapOverlayPreviewRequest(body.normalized);
  } catch {
    return noStoreJson({ error: 'invalid_overlay_apply_request' }, { status: 400 });
  }

  const confirmationText = readOptionalString(body.confirmationText);
  const previewHash = readOptionalString(body.previewHash);
  const suppliedPayloadHash = readOptionalString(body.payloadHash);
  const correlationId = readOptionalString(body.correlationId);
  const idempotencyKey = readOptionalString(body.idempotencyKey);
  const previewExpiresAt = readOptionalString(body.previewExpiresAt ?? body.expiresAt);

  if (confirmationText !== ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT || !previewHash) {
    return noStoreJson({ error: 'overlay_confirmation_required' }, { status: 400 });
  }

  if (!isUuid(correlationId) || !isValidIdempotencyKey(idempotencyKey)) {
    return noStoreJson({ error: 'invalid_overlay_apply_request' }, { status: 400 });
  }

  const expectedPreviewHash = buildAdminMapOverlayPreviewHash(normalized);
  if (previewHash !== expectedPreviewHash) {
    return noStoreJson({ error: 'overlay_preview_stale' }, { status: 409 });
  }

  if (previewExpiresAt) {
    const previewExpiresAtTime = new Date(previewExpiresAt).getTime();
    if (!Number.isFinite(previewExpiresAtTime) || previewExpiresAtTime <= Date.now()) {
      return noStoreJson({ error: 'overlay_preview_stale' }, { status: 409 });
    }
  }

  const rpcAction = mapAdminMapOverlayRouteActionToRpcAction(normalized.action);
  const payloadHash = buildAdminMapOverlayPayloadHash({
    normalized,
    rpcAction,
    previewHash,
    confirmationText,
  });

  if (suppliedPayloadHash && suppliedPayloadHash !== payloadHash) {
    return noStoreJson({ error: 'overlay_preview_stale' }, { status: 409 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const requestMetadata = buildAdminMapOverlayRequestMetadata(request.headers);
    const { data, error } = await supabase.rpc(
      'apply_admin_restaurant_map_overlay_action' as never,
      {
        p_actor_user_id: admin.userId,
        p_action: rpcAction,
        p_restaurant_id: normalized.restaurantId,
        p_overlay_type: normalized.overlayType,
        p_label: normalized.label,
        p_description: normalized.description,
        p_active_from: normalized.activeFrom,
        p_active_until: normalized.activeUntil,
        p_evidence: normalized.evidence,
        p_reason: normalized.reason,
        p_preview_hash: previewHash,
        p_payload_hash: payloadHash,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey,
        p_request_metadata: requestMetadata,
      } as never,
    );

    if (error) {
      const errorCode = readRpcErrorCode(error);
      return noStoreJson({ error: errorCode }, { status: statusForRpcErrorCode(errorCode) });
    }

    const rpcResult = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {};
    const rpcAudit = rpcResult.audit;
    const auditId = readStringProperty(rpcAudit, 'id') ?? readStringProperty(rpcAudit, 'auditId');

    if (!auditId) {
      return noStoreJson({ error: 'overlay_apply_failed' }, { status: 502 });
    }

    return noStoreJson({
      ok: true,
      status: rpcResult.status ?? 'applied',
      replayed: rpcResult.replayed === true,
      overlay: rpcResult.overlay ?? null,
      audit: {
        domain: 'admin_restaurant_map_overlays',
        source: 'admin_restaurant_map_overlay_audit_events',
        auditId,
        correlationId,
        idempotencyKey,
        payloadHash,
      },
      readback: rpcResult.readback ?? {
        matchedPayloadHash: true,
        matchedPreviewHash: true,
        restaurantId: normalized.restaurantId,
        overlayType: normalized.overlayType,
      },
    });
  } catch {
    return noStoreJson({ error: 'overlay_apply_failed' }, { status: 502 });
  }
}
