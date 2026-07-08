import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildAdminRouteCandidateSet,
  type AdminRouteBbox,
  type AdminRoutePlannerRestaurant,
} from '@/lib/admin-route-planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE_CANDIDATE_SELECT = 'id, name, approved_name, categories, road_address, jibun_address, lat, lng, youtube_link, youtube_meta, source_type, status, is_missing, is_not_selected';
const ROUTE_CANDIDATE_POOL_LIMIT = 500;
const ROUTE_CANDIDATE_DEFAULT_LIMIT = 7;
const ROUTE_CANDIDATE_MAX_LIMIT = 7;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function parseLimit(value: string | null) {
  if (!value) return ROUTE_CANDIDATE_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('invalid_admin_route_candidate_query');
  return Math.min(parsed, ROUTE_CANDIDATE_MAX_LIMIT);
}

function parseBbox(value: string | null): AdminRouteBbox | null {
  if (!value) return null;
  const rawParts = value.split(',').map((part) => part.trim());
  if (rawParts.length !== 4 || rawParts.some((part) => part.length === 0)) {
    throw new Error('invalid_admin_route_candidate_query');
  }
  const parts = rawParts.map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error('invalid_admin_route_candidate_query');
  }
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new Error('invalid_admin_route_candidate_query');
  }
  return { west, south, east, north };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = readRecord(item);
    return row ? [row] : [];
  }) : [];
}

function readVideoId(value: unknown): string | null {
  const meta = readRecord(value);
  const direct = meta?.videoId ?? meta?.video_id;
  return typeof direct === 'string' ? direct : null;
}

function mapRestaurantRow(row: Record<string, unknown>): AdminRoutePlannerRestaurant {
  const categories = Array.isArray(row.categories) ? row.categories : [];
  const category = categories.find((item) => typeof item === 'string') as string | undefined;
  return {
    id: typeof row.id === 'string' ? row.id : '',
    name: typeof row.approved_name === 'string' && row.approved_name.trim() ? row.approved_name : String(row.name ?? '이름 확인 필요'),
    category: category ?? null,
    address: typeof row.road_address === 'string' ? row.road_address : typeof row.jibun_address === 'string' ? row.jibun_address : null,
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
    videoId: readVideoId(row.youtube_meta),
    sourceType: typeof row.source_type === 'string' ? row.source_type : null,
    status: typeof row.status === 'string' ? row.status : null,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  let anchorRestaurantId: string | null;
  let limit: number;
  let bbox: AdminRouteBbox | null;
  try {
    anchorRestaurantId = request.nextUrl.searchParams.get('anchorRestaurantId');
    if (anchorRestaurantId && !UUID_PATTERN.test(anchorRestaurantId)) throw new Error('invalid_admin_route_candidate_query');
    limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    bbox = parseBbox(request.nextUrl.searchParams.get('bbox'));
  } catch {
    return noStoreJson({ ok: false, error: 'invalid_admin_route_candidate_query' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('restaurants')
      .select(ROUTE_CANDIDATE_SELECT)
      .eq('status', 'approved')
      .eq('is_missing', false)
      .eq('is_not_selected', false)
      .limit(ROUTE_CANDIDATE_POOL_LIMIT);

    if (error) return noStoreJson({ ok: false, error: 'admin_route_candidates_failed' }, { status: 502 });

    const candidateSet = buildAdminRouteCandidateSet({
      restaurants: readRows(data).map(mapRestaurantRow),
      anchorRestaurantId,
      bbox,
      limit,
    });

    return noStoreJson({
      ok: true,
      items: candidateSet.items,
      candidateReadback: candidateSet.readback,
      asOf: new Date().toISOString(),
    });
  } catch {
    return noStoreJson({ ok: false, error: 'admin_route_candidates_failed' }, { status: 502 });
  }
}
