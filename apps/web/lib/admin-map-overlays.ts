import { createHash, randomUUID } from 'node:crypto';

import type { Json, Tables } from '@/integrations/supabase/types';

export const ADMIN_MAP_OVERLAY_TYPES = ['trend', 'seasonal'] as const;
export const ADMIN_MAP_OVERLAY_ROUTE_ACTIONS = ['upsert', 'deactivate'] as const;
export const ADMIN_MAP_OVERLAY_RPC_ACTIONS = ['upsert_overlay', 'deactivate_overlay'] as const;
export const ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT = '오버레이 적용';
export const ADMIN_MAP_OVERLAY_PREVIEW_TTL_MS = 10 * 60 * 1000;

export const ADMIN_MAP_OVERLAY_LIMIT_DEFAULT = 200;
export const ADMIN_MAP_OVERLAY_LIMIT_MAX = 500;
export const ADMIN_MAP_OVERLAY_RESTAURANT_IDS_MAX = 100;
const ADMIN_MAP_OVERLAY_RESTAURANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_MAP_OVERLAY_RESTAURANT_ID_LENGTH = 36;

export type AdminMapOverlayType = (typeof ADMIN_MAP_OVERLAY_TYPES)[number];
export type AdminMapOverlayRouteAction = (typeof ADMIN_MAP_OVERLAY_ROUTE_ACTIONS)[number];
export type AdminMapOverlayRpcAction = (typeof ADMIN_MAP_OVERLAY_RPC_ACTIONS)[number];

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
export type NormalizedAdminMapOverlayPreviewRequest = {
  action: AdminMapOverlayRouteAction;
  restaurantId: string;
  overlayType: AdminMapOverlayType;
  label: string | null;
  description: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  evidence: Json;
  reason: string;
};

export type AdminMapOverlayPayloadHashInput = {
  normalized: NormalizedAdminMapOverlayPreviewRequest;
  rpcAction: AdminMapOverlayRpcAction;
  previewHash: string;
  confirmationText: string;
};

export type AdminMapOverlayRequestMetadata = {
  requestId: string;
  ipHash: string | null;
  userAgentHash: string | null;
};


const ADMIN_MAP_OVERLAY_TYPE_SET = new Set<string>(ADMIN_MAP_OVERLAY_TYPES);
const ADMIN_MAP_OVERLAY_ROUTE_ACTION_SET = new Set<string>(ADMIN_MAP_OVERLAY_ROUTE_ACTIONS);
const ADMIN_MAP_OVERLAY_LABEL_MIN_LENGTH = 1;
const ADMIN_MAP_OVERLAY_LABEL_MAX_LENGTH = 80;
const ADMIN_MAP_OVERLAY_DESCRIPTION_MAX_LENGTH = 500;
const ADMIN_MAP_OVERLAY_REASON_MIN_LENGTH = 3;
const ADMIN_MAP_OVERLAY_REASON_MAX_LENGTH = 500;


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
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function normalizeOptionalText(value: unknown, maxLength: number, errorCode: string): string | null {
  if (value === undefined || value === null) return null;
  const normalized = readString(value);
  if (normalized === null) throw new Error(errorCode);
  if (normalized.length > maxLength) throw new Error(errorCode);
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: unknown, minLength: number, maxLength: number, errorCode: string): string {
  const normalized = readString(value);
  if (normalized === null || normalized.length < minLength || normalized.length > maxLength) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalTimestamp(value: unknown, errorCode: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(errorCode);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(errorCode);
  return parsed.toISOString();
}

function normalizeJsonValue(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid-json');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }
  if (isPlainRecord(value)) {
    const normalized: { [key: string]: Json | undefined } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) normalized[key] = normalizeJsonValue(item);
    }
    return normalized;
  }
  throw new Error('invalid-json');
}

function normalizeEvidence(value: unknown): Json {
  if (!isPlainRecord(value)) throw new Error('invalid-evidence');
  return normalizeJsonValue(value);
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid-json');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = toCanonicalJsonValue(item);
      return normalized === undefined ? null : normalized;
    });
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = toCanonicalJsonValue(record[key]);
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  }
  throw new Error('invalid-json');
}

export function buildCanonicalJsonSha256(value: unknown): string {
  const canonicalValue = toCanonicalJsonValue(value);
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue))
    .digest('hex')
    .toLowerCase();
}

export function mapAdminMapOverlayRouteActionToRpcAction(action: AdminMapOverlayRouteAction): AdminMapOverlayRpcAction {
  if (action === 'upsert') return 'upsert_overlay';
  if (action === 'deactivate') return 'deactivate_overlay';
  throw new Error('invalid-overlay-action');
}

export function normalizeAdminMapOverlayPreviewRequest(body: unknown): NormalizedAdminMapOverlayPreviewRequest {
  if (!isPlainRecord(body)) throw new Error('invalid-request');

  const action = readString(body.action);
  if (!action || !ADMIN_MAP_OVERLAY_ROUTE_ACTION_SET.has(action)) {
    throw new Error('invalid-overlay-action');
  }

  const routeAction = action as AdminMapOverlayRouteAction;

  const restaurantId = readString(body.restaurantId ?? body.restaurant_id);
  if (
    !restaurantId ||
    restaurantId.length !== ADMIN_MAP_OVERLAY_RESTAURANT_ID_LENGTH ||
    !ADMIN_MAP_OVERLAY_RESTAURANT_ID_PATTERN.test(restaurantId)
  ) {
    throw new Error('invalid-restaurant-id');
  }

  const overlayType = readString(body.overlayType ?? body.overlay_type);
  if (!overlayType || !ADMIN_MAP_OVERLAY_TYPE_SET.has(overlayType)) {
    throw new Error('invalid-overlay-type');
  }

  const reason = normalizeRequiredText(
    body.reason,
    ADMIN_MAP_OVERLAY_REASON_MIN_LENGTH,
    ADMIN_MAP_OVERLAY_REASON_MAX_LENGTH,
    'invalid-reason',
  );
  const evidence = normalizeEvidence(body.evidence);

  const activeFrom = normalizeOptionalTimestamp(body.activeFrom ?? body.active_from, 'invalid-active-window');
  const activeUntil = normalizeOptionalTimestamp(body.activeUntil ?? body.active_until, 'invalid-active-window');
  if (activeFrom && activeUntil && new Date(activeFrom).getTime() > new Date(activeUntil).getTime()) {
    throw new Error('invalid-active-window');
  }

  if (routeAction === 'deactivate') {
    return {
      action: routeAction,
      restaurantId,
      overlayType: overlayType as AdminMapOverlayType,
      label: normalizeOptionalText(body.label, ADMIN_MAP_OVERLAY_LABEL_MAX_LENGTH, 'invalid-label'),
      description: normalizeOptionalText(body.description, ADMIN_MAP_OVERLAY_DESCRIPTION_MAX_LENGTH, 'invalid-description'),
      activeFrom,
      activeUntil,
      evidence,
      reason,
    };
  }

  const label = normalizeRequiredText(
    body.label,
    ADMIN_MAP_OVERLAY_LABEL_MIN_LENGTH,
    ADMIN_MAP_OVERLAY_LABEL_MAX_LENGTH,
    'invalid-label',
  );

  return {
    action: routeAction,
    restaurantId,
    overlayType: overlayType as AdminMapOverlayType,
    label,
    description: normalizeOptionalText(body.description, ADMIN_MAP_OVERLAY_DESCRIPTION_MAX_LENGTH, 'invalid-description'),
    activeFrom,
    activeUntil,
    evidence,
    reason,
  };
}

export function buildAdminMapOverlayPreviewHash(normalized: NormalizedAdminMapOverlayPreviewRequest): string {
  return buildCanonicalJsonSha256({
    action: normalized.action,
    restaurantId: normalized.restaurantId,
    overlayType: normalized.overlayType,
    label: normalized.label,
    description: normalized.description,
    activeFrom: normalized.activeFrom,
    activeUntil: normalized.activeUntil,
    evidence: normalized.evidence,
    reason: normalized.reason,
  });
}

export function buildAdminMapOverlayPayloadHash(input: AdminMapOverlayPayloadHashInput): string {
  return buildCanonicalJsonSha256({
    action: input.rpcAction,
    previewHash: input.previewHash,
    confirmationText: input.confirmationText,
    restaurantId: input.normalized.restaurantId,
    overlayType: input.normalized.overlayType,
    label: input.normalized.label,
    description: input.normalized.description,
    activeFrom: input.normalized.activeFrom,
    activeUntil: input.normalized.activeUntil,
    evidence: input.normalized.evidence,
    reason: input.normalized.reason,
  });
}

export function buildAdminMapOverlayRequestMetadata(headers: Headers): AdminMapOverlayRequestMetadata {
  const requestId = headers.get('x-request-id')?.trim() || randomUUID();
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = headers.get('user-agent')?.trim() ?? null;

  return {
    requestId,
    ipHash: forwardedFor ? buildCanonicalJsonSha256({ ip: forwardedFor }) : null,
    userAgentHash: userAgent ? buildCanonicalJsonSha256({ userAgent }) : null,
  };
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
