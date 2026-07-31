import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
  ADMIN_MAP_OVERLAY_PREVIEW_TTL_MS,
  buildAdminMapOverlayPreviewHash,
  mapAdminRestaurantMapOverlayRow,
  normalizeAdminMapOverlayPreviewRequest,
  type AdminRestaurantMapOverlayRow,
} from '@/lib/admin-map-overlays';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_MAP_OVERLAY_PREVIEW_REQUEST_BYTES = 64 * 1024;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function sanitizePreviewAfter(
  normalized: ReturnType<typeof normalizeAdminMapOverlayPreviewRequest>,
  before: AdminRestaurantMapOverlayRow | null,
) {
  if (normalized.action === 'deactivate' && before) {
    return {
      ...mapAdminRestaurantMapOverlayRow(before),
      isActive: false,
    };
  }

  return {
    restaurantId: normalized.restaurantId,
    overlayType: normalized.overlayType,
    label: normalized.label,
    description: normalized.description,
    activeFrom: normalized.activeFrom,
    activeUntil: normalized.activeUntil,
    evidence: normalized.evidence,
    isActive: normalized.action === 'upsert',
    updatedAt: before?.updated_at ?? null,
  };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ error: 'Forbidden' }, { status: 403 });
  }

  const requestBody = await readBoundedJsonRequest(request, MAX_MAP_OVERLAY_PREVIEW_REQUEST_BYTES);
  if (!requestBody.ok) {
    return noStoreJson({ error: 'Invalid map overlay request' }, { status: 400 });
  }

  let normalized: ReturnType<typeof normalizeAdminMapOverlayPreviewRequest>;
  try {
    normalized = normalizeAdminMapOverlayPreviewRequest(requestBody.value);
  } catch {
    return noStoreJson({ error: 'Invalid map overlay request' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_restaurant_map_overlays')
      .select('restaurant_id, overlay_type, label, description, active_from, active_until, evidence, is_active, created_at, updated_at')
      .eq('restaurant_id', normalized.restaurantId)
      .eq('overlay_type', normalized.overlayType)
      .maybeSingle()
      .returns<AdminRestaurantMapOverlayRow>();

    if (error) {
      return noStoreJson({ error: 'Map overlay preview unavailable' }, { status: 502 });
    }

    const previewHash = buildAdminMapOverlayPreviewHash(normalized);

    return noStoreJson({
      ok: true,
      normalized,
      before: data ? mapAdminRestaurantMapOverlayRow(data) : null,
      after: sanitizePreviewAfter(normalized, data ?? null),
      warnings: [],
      confirmation: {
        requiredText: ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
        previewHash,
        expiresAt: new Date(Date.now() + ADMIN_MAP_OVERLAY_PREVIEW_TTL_MS).toISOString(),
      },
    });
  } catch {
    return noStoreJson({ error: 'Map overlay preview unavailable' }, { status: 502 });
  }
}
