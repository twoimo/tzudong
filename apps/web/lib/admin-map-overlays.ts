import type { Json, Tables } from '@/integrations/supabase/types';

export const ADMIN_MAP_OVERLAY_TYPES = ['trend', 'seasonal'] as const;
export const ADMIN_MAP_OVERLAY_LIMIT_DEFAULT = 200;
export const ADMIN_MAP_OVERLAY_LIMIT_MAX = 500;
export const ADMIN_MAP_OVERLAY_RESTAURANT_IDS_MAX = 100;
const ADMIN_MAP_OVERLAY_RESTAURANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_MAP_OVERLAY_RESTAURANT_ID_LENGTH = 36;

export type AdminMapOverlayType = (typeof ADMIN_MAP_OVERLAY_TYPES)[number];
export type AdminRestaurantMapOverlayRow = Tables<'admin_restaurant_map_overlays'>;

export type AdminRestaurantMapOverlay = {
  restaurantId: string;
  overlayType: AdminMapOverlayType;
  label: string;
  description: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  evidence: Json;
  isActive: boolean;
  updatedAt: string;
  createdAt: string;
};

export type AdminMapOverlaysResponse = {
  overlays: AdminRestaurantMapOverlay[];
  meta: {
    checkedAt: string;
    source: 'admin_restaurant_map_overlays';
    cache: 'no-store';
    requestedTypes: AdminMapOverlayType[];
  };
};

export type AdminMapOverlayQueryOptions = {
  types: AdminMapOverlayType[];
  activeAt: Date | null;
  restaurantIds: string[];
  limit: number;
};

const ADMIN_MAP_OVERLAY_TYPE_SET = new Set<string>(ADMIN_MAP_OVERLAY_TYPES);

function parseCsvParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseAdminMapOverlayTypes(value: string | null): AdminMapOverlayType[] {
  const requestedTypes = parseCsvParam(value);
  if (requestedTypes.length === 0) return [...ADMIN_MAP_OVERLAY_TYPES];

  const uniqueTypes = [...new Set(requestedTypes)];
  if (uniqueTypes.some((type) => !ADMIN_MAP_OVERLAY_TYPE_SET.has(type))) {
    throw new Error('invalid-overlay-type');
  }

  return uniqueTypes as AdminMapOverlayType[];
}

export function parseAdminMapOverlayLimit(value: string | null): number {
  if (!value) return ADMIN_MAP_OVERLAY_LIMIT_DEFAULT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > ADMIN_MAP_OVERLAY_LIMIT_MAX) {
    throw new Error('invalid-limit');
  }
  return parsed;
}

export function parseAdminMapOverlayActiveAt(value: string | null): Date | null {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('invalid-active-at');
  }
  return parsed;
}

export function parseAdminMapOverlayRestaurantIds(value: string | null): string[] {
  const restaurantIds = [...new Set(parseCsvParam(value))];
  if (restaurantIds.length > ADMIN_MAP_OVERLAY_RESTAURANT_IDS_MAX) {
    throw new Error('too-many-restaurant-ids');
  }
  if (
    restaurantIds.some(
      (restaurantId) =>
        restaurantId.length !== ADMIN_MAP_OVERLAY_RESTAURANT_ID_LENGTH ||
        !ADMIN_MAP_OVERLAY_RESTAURANT_ID_PATTERN.test(restaurantId),
    )
  ) {
    throw new Error('invalid-restaurant-id');
  }
  return restaurantIds;
}

export function parseAdminMapOverlayQuery(searchParams: URLSearchParams): AdminMapOverlayQueryOptions {
  return {
    types: parseAdminMapOverlayTypes(searchParams.get('types')),
    activeAt: parseAdminMapOverlayActiveAt(searchParams.get('activeAt')),
    restaurantIds: parseAdminMapOverlayRestaurantIds(searchParams.get('restaurantIds')),
    limit: parseAdminMapOverlayLimit(searchParams.get('limit')),
  };
}

export function isAdminMapOverlayActiveAt(row: Pick<AdminRestaurantMapOverlayRow, 'active_from' | 'active_until' | 'is_active'>, activeAt: Date | null): boolean {
  if (!row.is_active) return false;
  if (!activeAt) return true;

  const activeTime = activeAt.getTime();
  const activeFrom = row.active_from ? new Date(row.active_from).getTime() : null;
  const activeUntil = row.active_until ? new Date(row.active_until).getTime() : null;

  if (activeFrom !== null && Number.isFinite(activeFrom) && activeTime < activeFrom) return false;
  if (activeUntil !== null && Number.isFinite(activeUntil) && activeTime > activeUntil) return false;
  return true;
}

export function mapAdminRestaurantMapOverlayRow(row: AdminRestaurantMapOverlayRow): AdminRestaurantMapOverlay {
  return {
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
  };
}
