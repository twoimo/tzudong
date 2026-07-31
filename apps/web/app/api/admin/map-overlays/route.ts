import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  isAdminMapOverlayActiveAt,
  parseAdminMapOverlayQuery,
  type AdminMapOverlaysResponse,
  type AdminRestaurantMapOverlayRow,
} from '@/lib/admin-map-overlays';
import type { Json } from '@/integrations/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
type SelectedAdminMapOverlayRow = Pick<
  AdminRestaurantMapOverlayRow,
  'restaurant_id' | 'overlay_type' | 'label' | 'description' | 'active_from' | 'active_until' | 'evidence' | 'is_active' | 'created_at' | 'updated_at'
>;
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJson);
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => entry === undefined || isJson(entry));
}

function isSelectedAdminMapOverlayRow(value: unknown): value is SelectedAdminMapOverlayRow {
  if (!isRecord(value)) return false;

  const row = value;
  return typeof row.restaurant_id === 'string'
    && (row.overlay_type === 'trend' || row.overlay_type === 'seasonal')
    && typeof row.label === 'string'
    && (row.description === null || typeof row.description === 'string')
    && (row.active_from === null || typeof row.active_from === 'string')
    && (row.active_until === null || typeof row.active_until === 'string')
    && isJson(row.evidence)
    && typeof row.is_active === 'boolean'
    && typeof row.created_at === 'string'
    && typeof row.updated_at === 'string';
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

    const rows = Array.isArray(data) ? data.filter(isSelectedAdminMapOverlayRow) : [];
    const overlays = rows
      .filter((row) => isAdminMapOverlayActiveAt(row, queryOptions.activeAt))
      .map((row) => ({
        restaurantId: row.restaurant_id,
        overlayType: row.overlay_type,
        label: row.label,
        description: row.description,
        activeFrom: row.active_from,
        activeUntil: row.active_until,
        evidence: row.evidence,
        isActive: row.is_active,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
      }));

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
