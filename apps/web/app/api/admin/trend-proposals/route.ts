import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  encodeTrendProposalCursor,
  mapTrendProposalRow,
  parseTrendProposalListQuery,
  type TrendProposalConflictReadback,
} from '@/lib/admin/trend-proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROPOSAL_SELECT = 'id, run_id, restaurant_id, overlay_type, proposal_status, label, description, active_from, active_until, score, score_breakdown, evidence, proposal_hash, supersedes_proposal_id, reviewed_by_admin_id, reviewed_at, review_reason, overlay_audit_id, created_at, updated_at, restaurants(id, name, approved_name, lat, lng, status)';
const OVERLAY_CONFLICT_SELECT = 'restaurant_id, overlay_type, label, is_active, updated_at';

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rowArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = readRowObject(item);
    return row ? [row] : [];
  }) : [];
}

function overlayConflictKey(restaurantId: unknown, overlayType: unknown) {
  return `${String(restaurantId)}:${String(overlayType)}`;
}

function buildOverlayConflictMap(rows: Record<string, unknown>[]) {
  const conflicts = new Map<string, TrendProposalConflictReadback>();
  for (const row of rows) {
    const restaurantId = typeof row.restaurant_id === 'string' ? row.restaurant_id : '';
    const overlayType = row.overlay_type === 'trend' || row.overlay_type === 'seasonal' ? row.overlay_type : 'trend';
    conflicts.set(overlayConflictKey(restaurantId, overlayType), {
      hasActiveOverlay: row.is_active === true,
      overlay: {
        restaurantId,
        overlayType,
        label: typeof row.label === 'string' ? row.label : '',
        isActive: row.is_active === true,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
      },
    });
  }
  return conflicts;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  let query: ReturnType<typeof parseTrendProposalListQuery>;
  try {
    query = parseTrendProposalListQuery(request.nextUrl.searchParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_trend_proposal_query';
    return noStoreJson({ ok: false, error: message === 'invalid_trend_proposal_cursor' ? message : 'invalid_trend_proposal_query' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    let builder = supabase
      .from('admin_restaurant_map_overlay_proposals')
      .select(PROPOSAL_SELECT)
      .eq('proposal_status', query.status);

    if (query.overlayType) builder = builder.eq('overlay_type', query.overlayType);
    if (query.restaurantId) builder = builder.eq('restaurant_id', query.restaurantId);
    if (query.runId) builder = builder.eq('run_id', query.runId);
    if (query.cursor) {
      builder = builder.or(`created_at.lt.${query.cursor.createdAt},and(created_at.eq.${query.cursor.createdAt},id.lt.${query.cursor.id})`);
    }

    const { data, error } = await builder
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(query.limit + 1);

    if (error) return noStoreJson({ ok: false, error: 'trend_proposal_list_failed' }, { status: 502 });

    const rows = rowArray(data);
    const pageRows = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const restaurantIds = [...new Set(pageRows.flatMap((row) => (typeof row.restaurant_id === 'string' ? [row.restaurant_id] : [])))];
    const overlayTypes = [...new Set(pageRows.flatMap((row) => (row.overlay_type === 'trend' || row.overlay_type === 'seasonal' ? [row.overlay_type] : [])))];

    let conflictMap = new Map<string, TrendProposalConflictReadback>();
    if (restaurantIds.length > 0 && overlayTypes.length > 0) {
      const { data: overlayData, error: overlayError } = await supabase
        .from('admin_restaurant_map_overlays')
        .select(OVERLAY_CONFLICT_SELECT)
        .in('restaurant_id', restaurantIds)
        .in('overlay_type', overlayTypes)
        .eq('is_active', true);
      if (overlayError) return noStoreJson({ ok: false, error: 'trend_proposal_list_failed' }, { status: 502 });
      conflictMap = buildOverlayConflictMap(rowArray(overlayData));
    }

    const items = pageRows.map((row) => mapTrendProposalRow(
      row,
      conflictMap.get(overlayConflictKey(row.restaurant_id, row.overlay_type)) ?? { hasActiveOverlay: false, overlay: null },
    ));
    const lastItem = items[items.length - 1] ?? null;

    return noStoreJson({
      ok: true,
      items,
      pageInfo: {
        nextCursor: hasMore && lastItem ? encodeTrendProposalCursor({ createdAt: lastItem.createdAt, id: lastItem.id }) : null,
        hasMore,
      },
      asOf: new Date().toISOString(),
    });
  } catch {
    return noStoreJson({ ok: false, error: 'trend_proposal_list_failed' }, { status: 502 });
  }
}
