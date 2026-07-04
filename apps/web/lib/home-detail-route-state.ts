import type { FilterState } from '@/components/filters/filter-state';
import type { Restaurant, Region } from '@/types/restaurant';

export const HOME_DETAIL_HISTORY_STATE_KIND = 'tzudong.home.detail.v1';
export const HOME_LIST_HISTORY_STATE_KIND = 'tzudong.home.list.v1';
export const HOME_RESTORE_SNAPSHOT_VERSION = 1;
export const HOME_RESTORE_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
export const HOME_RESTORE_SNAPSHOT_MAX_BYTES = 8 * 1024;

const HOME_RESTORE_SNAPSHOT_STORAGE_PREFIX = 'tzudong:home-restore:';

export type HomeMapMode = 'domestic' | 'overseas';

export type HomeDetailHistoryState = {
  kind: typeof HOME_DETAIL_HISTORY_STATE_KIND;
  restaurantId: string;
  mapMode: HomeMapMode;
  restoreKey: string;
  createdAt: number;
};

export type HomeListHistoryState = {
  kind: typeof HOME_LIST_HISTORY_STATE_KIND;
  restaurantId: string;
  mapMode: HomeMapMode;
  restoreKey: string;
  createdAt: number;
};

export type HomeRestoreCompactRestaurant = Pick<Restaurant, 'id' | 'name'> &
  Partial<Pick<Restaurant, 'lat' | 'lng' | 'road_address' | 'jibun_address' | 'categories'>>;

export type HomeRestoreSnapshotV1 = {
  version: typeof HOME_RESTORE_SNAPSHOT_VERSION;
  createdAt: number;
  mapMode: HomeMapMode;
  selectedRestaurantId: string | null;
  panelRestaurantId: string | null;
  searchedRestaurantId: string | null;
  searchedRestaurant?: HomeRestoreCompactRestaurant | null;
  filters: Pick<FilterState, 'categories' | 'featuredTheme'>;
  selectedRegion: Region | null;
  selectedCountry: string | null;
  activePanel: 'map' | 'detail' | 'control';
  activeRightPanel: 'mypage' | 'adminReviews' | 'announcement' | null;
  isPanelCollapsed: boolean;
  isAnnouncementSheetOpen: boolean;
  contextualRestaurantIds: string[];
};

export type HomeRestoreFailureReason =
  | 'unavailable'
  | 'missing'
  | 'invalid-json'
  | 'invalid-shape'
  | 'expired'
  | 'oversize';

export function createHomeRestoreKey(now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${now.toString(36)}-${random}`;
}

export function resolveHomeMapModeParam(value: string | null | undefined): HomeMapMode | null {
  if (value === 'domestic' || value === 'overseas') return value;
  return null;
}

export function resolveHomeDetailRestaurantParam(searchParams: URLSearchParams): string | null {
  return searchParams.get('restaurant') || searchParams.get('r');
}

export function resolveHomeDetailMapModeParam(searchParams: URLSearchParams): HomeMapMode | null {
  return resolveHomeMapModeParam(searchParams.get('mapMode')) ?? resolveHomeMapModeParam(searchParams.get('mode'));
}

export function buildHomeDetailUrl(input: {
  restaurantId: string;
  mapMode: HomeMapMode;
  restoreKey: string;
  focusZoom?: number | null;
}): string {
  const searchParams = new URLSearchParams();
  searchParams.set('restaurant', input.restaurantId);
  searchParams.set('mapMode', input.mapMode);
  searchParams.set('restore', input.restoreKey);
  if (typeof input.focusZoom === 'number' && Number.isFinite(input.focusZoom)) {
    searchParams.set('z', String(input.focusZoom));
  }
  return `/?${searchParams.toString()}`;
}

export function buildHomeDetailState(input: {
  restaurantId: string;
  mapMode: HomeMapMode;
  restoreKey: string;
  createdAt?: number;
}): HomeDetailHistoryState {
  return {
    kind: HOME_DETAIL_HISTORY_STATE_KIND,
    restaurantId: input.restaurantId,
    mapMode: input.mapMode,
    restoreKey: input.restoreKey,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function buildHomeListState(input: {
  restaurantId: string;
  mapMode: HomeMapMode;
  restoreKey: string;
  createdAt?: number;
}): HomeListHistoryState {
  return {
    kind: HOME_LIST_HISTORY_STATE_KIND,
    restaurantId: input.restaurantId,
    mapMode: input.mapMode,
    restoreKey: input.restoreKey,
    createdAt: input.createdAt ?? Date.now(),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function isHomeDetailHistoryState(value: unknown): value is HomeDetailHistoryState {
  return (
    isRecord(value) &&
    value.kind === HOME_DETAIL_HISTORY_STATE_KIND &&
    typeof value.restaurantId === 'string' &&
    resolveHomeMapModeParam(value.mapMode as string | null) !== null &&
    typeof value.restoreKey === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  );
}

export function isHomeListHistoryState(value: unknown): value is HomeListHistoryState {
  return (
    isRecord(value) &&
    value.kind === HOME_LIST_HISTORY_STATE_KIND &&
    typeof value.restaurantId === 'string' &&
    resolveHomeMapModeParam(value.mapMode as string | null) !== null &&
    typeof value.restoreKey === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  );
}

function storageKey(restoreKey: string): string {
  return `${HOME_RESTORE_SNAPSHOT_STORAGE_PREFIX}${restoreKey}`;
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return new Blob([value]).size;
}

function isCompactRestaurant(value: unknown): value is HomeRestoreCompactRestaurant {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.lat === undefined || value.lat === null || typeof value.lat === 'number') &&
    (value.lng === undefined || value.lng === null || typeof value.lng === 'number')
  );
}

export function isHomeRestoreSnapshotV1(value: unknown): value is HomeRestoreSnapshotV1 {
  if (!isRecord(value)) return false;
  if (value.version !== HOME_RESTORE_SNAPSHOT_VERSION) return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (resolveHomeMapModeParam(value.mapMode as string | null) === null) return false;
  if (value.selectedRestaurantId !== null && typeof value.selectedRestaurantId !== 'string') return false;
  if (value.panelRestaurantId !== null && typeof value.panelRestaurantId !== 'string') return false;
  if (value.searchedRestaurantId !== null && typeof value.searchedRestaurantId !== 'string') return false;
  if (value.searchedRestaurant !== undefined && value.searchedRestaurant !== null && !isCompactRestaurant(value.searchedRestaurant)) return false;
  if (!isRecord(value.filters) || !isStringArray(value.filters.categories)) return false;
  if (value.selectedRegion !== null && typeof value.selectedRegion !== 'string') return false;
  if (value.selectedCountry !== null && typeof value.selectedCountry !== 'string') return false;
  if (value.activePanel !== 'map' && value.activePanel !== 'detail' && value.activePanel !== 'control') return false;
  if (
    value.activeRightPanel !== null &&
    value.activeRightPanel !== 'mypage' &&
    value.activeRightPanel !== 'adminReviews' &&
    value.activeRightPanel !== 'announcement'
  ) return false;
  if (typeof value.isPanelCollapsed !== 'boolean') return false;
  if (typeof value.isAnnouncementSheetOpen !== 'boolean') return false;
  if (!isStringArray(value.contextualRestaurantIds)) return false;
  return true;
}

export function writeHomeRestoreSnapshot(restoreKey: string, snapshot: HomeRestoreSnapshotV1): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;

  const json = JSON.stringify(snapshot);
  if (utf8ByteLength(json) > HOME_RESTORE_SNAPSHOT_MAX_BYTES) return false;

  try {
    storage.setItem(storageKey(restoreKey), json);
    return true;
  } catch {
    return false;
  }
}

export function readHomeRestoreSnapshot(
  restoreKey: string,
  now = Date.now(),
): { snapshot: HomeRestoreSnapshotV1 | null; reason?: HomeRestoreFailureReason } {
  const storage = getSessionStorage();
  if (!storage) return { snapshot: null, reason: 'unavailable' };

  const raw = storage.getItem(storageKey(restoreKey));
  if (!raw) return { snapshot: null, reason: 'missing' };
  if (utf8ByteLength(raw) > HOME_RESTORE_SNAPSHOT_MAX_BYTES) return { snapshot: null, reason: 'oversize' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { snapshot: null, reason: 'invalid-json' };
  }

  if (!isHomeRestoreSnapshotV1(parsed)) return { snapshot: null, reason: 'invalid-shape' };
  if (now - parsed.createdAt > HOME_RESTORE_SNAPSHOT_TTL_MS) return { snapshot: null, reason: 'expired' };

  return { snapshot: parsed };
}


export function dispatchHomeRestoreEvent(
  type: 'home.restore.succeeded' | 'home.restore.failed',
  detail: { restoreKey: string; reason?: string },
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}
