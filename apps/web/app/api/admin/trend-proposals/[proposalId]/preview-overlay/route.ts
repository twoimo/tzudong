import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildTrendProposalOverlayPreviewPayload,
  buildTrendProposalPreviewConfirmation,
  normalizeTrendProposalPreviewRequest,
  type TrendProposalRowInput,
} from '@/lib/admin/trend-proposals';
import {
  mapAdminRestaurantMapOverlayRow,
  type AdminRestaurantMapOverlayRow,
} from '@/lib/admin-map-overlays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TrendProposalRouteContext = {
  params: Promise<{ proposalId: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROPOSAL_SELECT = 'id, run_id, restaurant_id, overlay_type, proposal_status, label, description, active_from, active_until, score, score_breakdown, evidence, proposal_hash, supersedes_proposal_id, reviewed_by_admin_id, reviewed_at, review_reason, overlay_audit_id, created_at, updated_at';
const OVERLAY_SELECT = 'restaurant_id, overlay_type, label, description, active_from, active_until, evidence, is_active, created_at, updated_at';

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mapProposalRow(value: unknown): TrendProposalRowInput | null {
  const row = readRowObject(value);
  if (!row) return null;
  if (row.overlay_type !== 'trend' && row.overlay_type !== 'seasonal') return null;
  if (!['pending', 'approved', 'rejected', 'superseded', 'expired'].includes(String(row.proposal_status))) return null;
  return row as unknown as TrendProposalRowInput;
}

function sanitizePreviewAfter(
  normalized: ReturnType<typeof buildTrendProposalOverlayPreviewPayload>,
  before: AdminRestaurantMapOverlayRow | null,
) {
  return {
    restaurantId: normalized.restaurantId,
    overlayType: normalized.overlayType,
    label: normalized.label,
    description: normalized.description,
    activeFrom: normalized.activeFrom,
    activeUntil: normalized.activeUntil,
    evidence: normalized.evidence,
    isActive: true,
    updatedAt: before?.updated_at ?? null,
  };
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

  let previewRequest: ReturnType<typeof normalizeTrendProposalPreviewRequest>;
  try {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    previewRequest = normalizeTrendProposalPreviewRequest(body);
  } catch {
    return noStoreJson({ ok: false, error: 'invalid_trend_proposal_preview_request' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data: proposalData, error: proposalError } = await supabase
      .from('admin_restaurant_map_overlay_proposals')
      .select(PROPOSAL_SELECT)
      .eq('id', proposalId)
      .maybeSingle();

    if (proposalError) return noStoreJson({ ok: false, error: 'trend_proposal_preview_failed' }, { status: 502 });
    const proposal = mapProposalRow(proposalData);
    if (!proposal) return noStoreJson({ ok: false, error: 'trend_proposal_not_found' }, { status: 404 });
    if (proposal.proposal_status !== 'pending') {
      return noStoreJson({ ok: false, error: 'trend_proposal_not_pending' }, { status: 409 });
    }

    const normalizedOverlayPayload = buildTrendProposalOverlayPreviewPayload(proposal, previewRequest.edits);
    const { data: overlayData, error: overlayError } = await supabase
      .from('admin_restaurant_map_overlays')
      .select(OVERLAY_SELECT)
      .eq('restaurant_id', normalizedOverlayPayload.restaurantId)
      .eq('overlay_type', normalizedOverlayPayload.overlayType)
      .maybeSingle()
      .returns<AdminRestaurantMapOverlayRow>();

    if (overlayError) return noStoreJson({ ok: false, error: 'trend_proposal_preview_failed' }, { status: 502 });

    return noStoreJson({
      ok: true,
      proposal: {
        id: proposal.id,
        proposalHash: proposal.proposal_hash,
        proposalStatus: proposal.proposal_status,
      },
      normalizedOverlayPayload,
      before: overlayData ? mapAdminRestaurantMapOverlayRow(overlayData) : null,
      after: sanitizePreviewAfter(normalizedOverlayPayload, overlayData ?? null),
      warnings: [],
      confirmation: buildTrendProposalPreviewConfirmation({
        proposalId,
        normalized: normalizedOverlayPayload,
      }),
    });
  } catch {
    return noStoreJson({ ok: false, error: 'trend_proposal_preview_failed' }, { status: 502 });
  }
}
