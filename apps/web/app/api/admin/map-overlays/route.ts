import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  mapAdminRestaurantMapOverlayRow,
  isAdminMapOverlayActiveAt,
  parseAdminMapOverlayQuery,
  type AdminMapOverlaysResponse,
  type AdminRestaurantMapOverlayRow,
} from '@/lib/admin-map-overlays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  let queryOptions;
  try {
    queryOptions = parseAdminMapOverlayQuery(request.nextUrl.searchParams);
  } catch {
    return noStoreJson({ error: 'Invalid map overlay query' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const activeAtIso = queryOptions.activeAt?.toISOString();
    let query = supabase
      .from('admin_restaurant_map_overlays')
      .select('restaurant_id, overlay_type, label, description, active_from, active_until, evidence, is_active, created_at, updated_at')
      .eq('is_active', true)
      .in('overlay_type', queryOptions.types);

    if (activeAtIso) {
      query = query
        .or(`active_from.is.null,active_from.lte.${activeAtIso}`)
        .or(`active_until.is.null,active_until.gte.${activeAtIso}`);
    }

    if (queryOptions.restaurantIds.length > 0) {
      query = query.in('restaurant_id', queryOptions.restaurantIds);
    }

    query = query
      .order('updated_at', { ascending: false })
      .limit(queryOptions.limit);

    const { data, error } = await query.returns<AdminRestaurantMapOverlayRow[]>();
    if (error) {
      return noStoreJson({ error: 'Map overlays unavailable' }, { status: 502 });
    }

    const overlays = (data ?? [])
      .filter((row) => isAdminMapOverlayActiveAt(row, queryOptions.activeAt))
      .map(mapAdminRestaurantMapOverlayRow);

    const body: AdminMapOverlaysResponse = {
      overlays,
      meta: {
        checkedAt: new Date().toISOString(),
        source: 'admin_restaurant_map_overlays',
        cache: 'no-store',
        requestedTypes: queryOptions.types,
      },
    };

    return noStoreJson(body);
  } catch {
    return noStoreJson({ error: 'Map overlays unavailable' }, { status: 502 });
  }
}
