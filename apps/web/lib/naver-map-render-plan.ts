import type { Restaurant } from '@/types/restaurant';
import type Supercluster from 'supercluster';
import { isCluster, type ClusterProperties, type RegionalCluster, type SeoulDistrictCluster } from '@/lib/clustering';
import { getPrimaryCategory, isRestaurantInViewport, type ExtendedBounds } from '@/lib/naver-map-view-helpers';
import { getTzuyangVisitCount } from '@/lib/restaurant-visit-count';

const formatCoordForSignature = (value: number | string | null | undefined): string => {
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(6);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed).toFixed(6);
    }
    return 'na';
};

const toRestaurantRenderToken = (restaurant: Restaurant, prefix = 'restaurant'): string =>
    `${prefix}-${restaurant.id}:${formatCoordForSignature(restaurant.lat)}:${formatCoordForSignature(restaurant.lng)}:${getPrimaryCategory(restaurant)}:${getTzuyangVisitCount(restaurant)}`;

type RestaurantWithRenderableCoordinates = Restaurant & { lat: number; lng: number };

export function hasNaverMarkerCoordinates<T extends { lat?: unknown; lng?: unknown }>(
    restaurant: T | null | undefined,
): restaurant is T & { lat: number; lng: number } {
    if (!restaurant) return false;
    return typeof restaurant.lat === 'number' && Number.isFinite(restaurant.lat)
        && typeof restaurant.lng === 'number' && Number.isFinite(restaurant.lng);
}

function normalizeFiniteCoordinate(value: unknown) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = Number(trimmed);
    return Number.isFinite(normalized) ? normalized : null;
}

export function normalizeNaverMarkerCoordinates<T extends { lat?: unknown; lng?: unknown }>(
    restaurant: T | null | undefined,
): (T & { lat: number; lng: number }) | null {
    if (!restaurant) return null;
    const lat = normalizeFiniteCoordinate(restaurant.lat);
    const lng = normalizeFiniteCoordinate(restaurant.lng);
    if (lat === null || lng === null) return null;
    if (hasNaverMarkerCoordinates(restaurant)) return restaurant;
    return { ...restaurant, lat, lng };
}

export function deriveClusterRenderPlan(
    currentZoom: number,
    hasSelectedRegion: boolean,
    effectiveMaxZoom: number,
    seoulDistrictClusters: SeoulDistrictCluster[],
    seoulDistrictClustersFiltered: SeoulDistrictCluster[],
) {
    const shouldCluster = !hasSelectedRegion && currentZoom <= effectiveMaxZoom;
    const shouldUseRegionalCluster = shouldCluster && currentZoom <= 8;
    const shouldUseSeoulDistrictFull = !shouldUseRegionalCluster && currentZoom >= 9 && currentZoom <= 10;
    const shouldUseSeoulDistrictFiltered = !shouldUseRegionalCluster && currentZoom >= 11 && currentZoom <= 12;
    const shouldUseSeoulDistrictCluster = shouldUseSeoulDistrictFull || shouldUseSeoulDistrictFiltered;
    const seoulClustersToRender = shouldUseSeoulDistrictFull
        ? seoulDistrictClusters
        : (shouldUseSeoulDistrictFiltered ? seoulDistrictClustersFiltered : []);

    return {
        shouldCluster,
        shouldUseRegionalCluster,
        shouldUseSeoulDistrictCluster,
        nextIsRegionalClusterMode: shouldUseRegionalCluster,
        nextIsSeoulDistrictMode: shouldUseSeoulDistrictCluster,
        nextIsClusterMode: shouldUseRegionalCluster ? true : (shouldUseSeoulDistrictCluster ? false : shouldCluster),
        shouldUseSeoulDistrictFiltered,
        seoulClustersToRender,
    };
}

const VIEWPORT_CELL_DEGREES = 0.05;
const viewportIndexCache = new WeakMap<readonly Restaurant[], {
    buckets: Map<number, Restaurant[]>;
    always: Restaurant[];
    byId: Map<string, Restaurant>;
    order: Map<string, number>;
}>();
let lastViewportExaminationCount = 0;
let lastVisibleSource: Restaurant[] | null = null;
let lastVisibleResult: Restaurant[] = [];
let lastVisibleIds: Set<string> | null = null;
const visibleRestaurantScratchIds: string[] = [];

function reuseVisibleRestaurantResult(source: Restaurant[], included: Set<string>, build: () => Restaurant[]) {
    if (
        lastVisibleSource === source &&
        lastVisibleResult.length === included.size &&
        lastVisibleResult.every((restaurant) => included.has(restaurant.id))
    ) {
        return lastVisibleResult;
    }

    const result = build();
    lastVisibleSource = source;
    lastVisibleResult = result;
    lastVisibleIds = included;
    return result;
}

export function getLastViewportExaminationCount() {
    return lastViewportExaminationCount;
}

const VIEWPORT_CELL_LNG_STRIDE = 100000;

function viewportCellKey(lat: number, lng: number) {
    return Math.floor(lat / VIEWPORT_CELL_DEGREES) * VIEWPORT_CELL_LNG_STRIDE
        + Math.floor(lng / VIEWPORT_CELL_DEGREES);
}

function viewportCellIndexKey(latCell: number, lngCell: number) {
    return latCell * VIEWPORT_CELL_LNG_STRIDE + lngCell;
}

function getViewportIndex(restaurants: readonly Restaurant[]) {
    const cached = viewportIndexCache.get(restaurants);
    if (cached) return cached;

    const buckets = new Map<number, Restaurant[]>();
    const always: Restaurant[] = [];
    const byId = new Map<string, Restaurant>();
    const order = new Map<string, number>();
    restaurants.forEach((restaurant, index) => {
        byId.set(restaurant.id, restaurant);
        order.set(restaurant.id, index);
        if (!restaurant.lat || !restaurant.lng) {
            always.push(restaurant);
            return;
        }
        const key = viewportCellKey(restaurant.lat, restaurant.lng);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(restaurant);
        else buckets.set(key, [restaurant]);
    });
    const built = { buckets, always, byId, order };
    viewportIndexCache.set(restaurants, built);
    return built;
}

export function getVisibleRestaurantsForRender(
    restaurantsForSwipe: Restaurant[],
    selectedRestaurantId: string | null,
    extendedBounds: ExtendedBounds | null,
    viewportFilterEnabled: boolean,
) {
    if (!viewportFilterEnabled || !extendedBounds) {
        lastViewportExaminationCount = restaurantsForSwipe.length;
        return viewportFilterEnabled
            ? restaurantsForSwipe.filter((restaurant) =>
                (selectedRestaurantId != null && restaurant.id === selectedRestaurantId) ||
                isRestaurantInViewport(restaurant, extendedBounds))
            : restaurantsForSwipe;
    }

    const latStart = Math.floor(extendedBounds.south / VIEWPORT_CELL_DEGREES);
    const latEnd = Math.floor(extendedBounds.north / VIEWPORT_CELL_DEGREES);
    const lngStart = Math.floor(extendedBounds.west / VIEWPORT_CELL_DEGREES);
    const lngEnd = Math.floor(extendedBounds.east / VIEWPORT_CELL_DEGREES);
    const cellCount = (latEnd - latStart + 1) * (lngEnd - lngStart + 1);
    if (cellCount > restaurantsForSwipe.length) {
        lastViewportExaminationCount = restaurantsForSwipe.length;
        return restaurantsForSwipe.filter((restaurant) =>
            (selectedRestaurantId != null && restaurant.id === selectedRestaurantId) ||
            isRestaurantInViewport(restaurant, extendedBounds));
    }

    const index = getViewportIndex(restaurantsForSwipe);
    const scratchIds = visibleRestaurantScratchIds;
    scratchIds.length = 0;
    let examined = 0;
    let selectedCounted = false;
    let same = lastVisibleSource === restaurantsForSwipe && lastVisibleIds !== null;
    const rememberId = (id: string) => {
        scratchIds.push(id);
        if (id === selectedRestaurantId) selectedCounted = true;
        if (same && !lastVisibleIds?.has(id)) same = false;
    };
    const always = index.always;
    for (let indexInAlways = 0; indexInAlways < always.length; indexInAlways += 1) {
        examined += 1;
        rememberId(always[indexInAlways].id);
    }
    const south = extendedBounds.south;
    const north = extendedBounds.north;
    const west = extendedBounds.west;
    const east = extendedBounds.east;
    for (let latCell = latStart; latCell <= latEnd; latCell += 1) {
        for (let lngCell = lngStart; lngCell <= lngEnd; lngCell += 1) {
            const bucket = index.buckets.get(viewportCellIndexKey(latCell, lngCell));
            if (!bucket) continue;
            for (let indexInBucket = 0; indexInBucket < bucket.length; indexInBucket += 1) {
                const restaurant = bucket[indexInBucket];
                examined += 1;
                if (
                    restaurant.lat >= south &&
                    restaurant.lat <= north &&
                    restaurant.lng >= west &&
                    restaurant.lng <= east
                ) {
                    rememberId(restaurant.id);
                }
            }
        }
    }
    if (
        selectedRestaurantId != null &&
        !selectedCounted &&
        index.byId.has(selectedRestaurantId)
    ) {
        examined += 1;
        countId(selectedRestaurantId);
    }
    lastViewportExaminationCount = examined;
    if (same && lastVisibleIds && scratchIds.length === lastVisibleIds.size) {
        return lastVisibleResult;
    }

    const included = new Set(scratchIds);
    return reuseVisibleRestaurantResult(restaurantsForSwipe, included, () => scratchIds
        .map((id) => index.byId.get(id))
        .filter((restaurant): restaurant is Restaurant => restaurant !== undefined)
        .sort((left, right) => (index.order.get(left.id) ?? 0) - (index.order.get(right.id) ?? 0)));
}

const visibleIdSetCache = new WeakMap<Restaurant[], Set<string>>();

export function getVisibleRestaurantIdSet(restaurants: Restaurant[]) {
    const cached = visibleIdSetCache.get(restaurants);
    if (cached) return cached;

    const ids = new Set<string>();
    for (let index = 0; index < restaurants.length; index += 1) {
        ids.add(restaurants[index].id);
    }
    visibleIdSetCache.set(restaurants, ids);
    return ids;
}

export function getRestaurantsWithRenderableCoordinates(restaurants: Restaurant[]) {
    for (let index = 0; index < restaurants.length; index += 1) {
        if (normalizeNaverMarkerCoordinates(restaurants[index]) !== restaurants[index]) {
            const next: Restaurant[] = [];
            for (const restaurant of restaurants) {
                const normalizedRestaurant = normalizeNaverMarkerCoordinates(restaurant);
                if (normalizedRestaurant) next.push(normalizedRestaurant);
            }
            return next;
        }
    }
    return restaurants;
}

export function getSeoulIndividualRestaurantsForRender({
    displayRestaurants,
    seoulIndividualIds,
}: {
    displayRestaurants: Restaurant[];
    seoulIndividualIds: string[];
}) {
    if (seoulIndividualIds.length === 0 || displayRestaurants.length === 0) {
        return [];
    }

    const seoulIndividualSet = new Set(seoulIndividualIds);

    return displayRestaurants.flatMap((restaurant): RestaurantWithRenderableCoordinates[] => {
        if (!seoulIndividualSet.has(restaurant.id)) return [];
        const normalizedRestaurant = normalizeNaverMarkerCoordinates(restaurant);
        return normalizedRestaurant ? [normalizedRestaurant] : [];
    });
}

let lastRenderTargetIds: string[] | null = null;
const lastRenderTargetKey = {
    searchedId: '',
    selectedId: '',
    clusterMode: false,
    regionalMode: false,
    seoulMode: false,
    displayRestaurants: null as Restaurant[] | null,
    displayRestaurantIds: null as Set<string> | null,
    clusters: null as unknown,
    regionalClusters: null as RegionalCluster[] | null,
    seoulClustersToRender: null as SeoulDistrictCluster[] | null,
    seoulIndividualIds: null as string[] | null,
    restaurantById: null as Map<string, Restaurant> | null,
    mergedRestaurantById: null as Map<string, Restaurant> | null,
};

export function buildRenderTargetIdsForSignature({
    activeSearchedRestaurant,
    selectedRestaurant,
    clusters,
    displayRestaurantIds,
    displayRestaurants,
    mergedRestaurantById,
    nextIsClusterMode,
    nextIsRegionalClusterMode,
    nextIsSeoulDistrictMode,
    regionalClusters,
    restaurantById,
    seoulClustersToRender,
    seoulIndividualIds,
}: {
    activeSearchedRestaurant: Restaurant | null;
    selectedRestaurant?: Restaurant | null;
    clusters: Array<Supercluster.ClusterFeature<ClusterProperties> | Supercluster.PointFeature<ClusterProperties>>;
    displayRestaurantIds: Set<string>;
    displayRestaurants: Restaurant[];
    mergedRestaurantById: Map<string, Restaurant>;
    nextIsClusterMode: boolean;
    nextIsRegionalClusterMode: boolean;
    nextIsSeoulDistrictMode: boolean;
    regionalClusters: RegionalCluster[];
    restaurantById: Map<string, Restaurant>;
    seoulClustersToRender: SeoulDistrictCluster[];
    seoulIndividualIds: string[];
}) {
    const searchedId = activeSearchedRestaurant?.id ?? '';
    const selectedId = selectedRestaurant?.id ?? '';
    if (
        lastRenderTargetIds &&
        lastRenderTargetKey.searchedId === searchedId &&
        lastRenderTargetKey.selectedId === selectedId &&
        lastRenderTargetKey.clusterMode === nextIsClusterMode &&
        lastRenderTargetKey.regionalMode === nextIsRegionalClusterMode &&
        lastRenderTargetKey.seoulMode === nextIsSeoulDistrictMode &&
        lastRenderTargetKey.displayRestaurants === displayRestaurants &&
        lastRenderTargetKey.displayRestaurantIds === displayRestaurantIds &&
        lastRenderTargetKey.clusters === clusters &&
        lastRenderTargetKey.regionalClusters === regionalClusters &&
        lastRenderTargetKey.seoulClustersToRender === seoulClustersToRender &&
        lastRenderTargetKey.seoulIndividualIds === seoulIndividualIds &&
        lastRenderTargetKey.restaurantById === restaurantById &&
        lastRenderTargetKey.mergedRestaurantById === mergedRestaurantById
    ) {
        return lastRenderTargetIds;
    }

    const renderTargetIdsForSignature: string[] = displayRestaurants.map((restaurant) =>
        toRestaurantRenderToken(restaurant)
    );

    if (activeSearchedRestaurant && !displayRestaurantIds.has(activeSearchedRestaurant.id)) {
        renderTargetIdsForSignature.push(toRestaurantRenderToken(activeSearchedRestaurant, 'searched'));
    }

    if (
        selectedRestaurant &&
        !displayRestaurantIds.has(selectedRestaurant.id) &&
        selectedRestaurant.id !== activeSearchedRestaurant?.id
    ) {
        renderTargetIdsForSignature.push(toRestaurantRenderToken(selectedRestaurant, 'selected'));
    }

    if (nextIsRegionalClusterMode) {
        regionalClusters.forEach((cluster) => {
            const categoriesSignature = [...new Set(cluster.categories)].sort().join('|');
            renderTargetIdsForSignature.push(
                `regional-${cluster.region}:${cluster.count}:${formatCoordForSignature(cluster.center.lat)}:${formatCoordForSignature(cluster.center.lng)}:${categoriesSignature}`
            );
        });
    } else if (nextIsClusterMode || nextIsSeoulDistrictMode) {
        seoulClustersToRender.forEach((cluster) => {
            const categoriesSignature = [...new Set(cluster.categories)].sort().join('|');
            renderTargetIdsForSignature.push(
                `seoul-dist-${cluster.region}:${cluster.count}:${formatCoordForSignature(cluster.center.lat)}:${formatCoordForSignature(cluster.center.lng)}:${categoriesSignature}`
            );
        });

        seoulIndividualIds.forEach((restaurantId) => {
            const restaurant = restaurantById.get(restaurantId) ?? mergedRestaurantById.get(restaurantId);
            if (restaurant) {
                renderTargetIdsForSignature.push(toRestaurantRenderToken(restaurant, 'seoul-individual'));
            } else {
                renderTargetIdsForSignature.push(`seoul-individual-${restaurantId}`);
            }
        });

        clusters.forEach((feature) => {
            const [lng, lat] = feature.geometry.coordinates;
            if (isCluster(feature)) {
                renderTargetIdsForSignature.push(
                    `cluster-${feature.properties.cluster_id}:${feature.properties.point_count || 0}:${formatCoordForSignature(lat)}:${formatCoordForSignature(lng)}`
                );
                return;
            }

            const restaurantId = feature.properties.restaurantId;
            const restaurant = restaurantById.get(restaurantId) ?? mergedRestaurantById.get(restaurantId);
            if (restaurant) {
                renderTargetIdsForSignature.push(toRestaurantRenderToken(restaurant, 'cluster-restaurant'));
                return;
            }

            renderTargetIdsForSignature.push(
                `cluster-restaurant-${restaurantId}:${formatCoordForSignature(lat)}:${formatCoordForSignature(lng)}:${feature.properties.category || '기타'}`
            );
        });
    }

    lastRenderTargetIds = renderTargetIdsForSignature;
    lastRenderTargetKey.searchedId = searchedId;
    lastRenderTargetKey.selectedId = selectedId;
    lastRenderTargetKey.clusterMode = nextIsClusterMode;
    lastRenderTargetKey.regionalMode = nextIsRegionalClusterMode;
    lastRenderTargetKey.seoulMode = nextIsSeoulDistrictMode;
    lastRenderTargetKey.displayRestaurants = displayRestaurants;
    lastRenderTargetKey.displayRestaurantIds = displayRestaurantIds;
    lastRenderTargetKey.clusters = clusters;
    lastRenderTargetKey.regionalClusters = regionalClusters;
    lastRenderTargetKey.seoulClustersToRender = seoulClustersToRender;
    lastRenderTargetKey.seoulIndividualIds = seoulIndividualIds;
    lastRenderTargetKey.restaurantById = restaurantById;
    lastRenderTargetKey.mergedRestaurantById = mergedRestaurantById;
    return renderTargetIdsForSignature;
}

export function shouldReportNaverMarkerRenderPerformance({
    activeMarkerCount,
    isDevelopment,
}: {
    activeMarkerCount: number;
    isDevelopment: boolean;
}) {
    return isDevelopment && activeMarkerCount > 50;
}

export function shouldClearEmptyClusterState({
    clusteringEnabled,
    displayRestaurantCount,
    expandedRestaurantCount = 0,
}: {
    clusteringEnabled: boolean;
    displayRestaurantCount: number;
    expandedRestaurantCount?: number;
}) {
    if (expandedRestaurantCount > 0) {
        return false;
    }

    return !clusteringEnabled || displayRestaurantCount === 0;
}

export function nextEmptyIdentityArray<T>(previous: readonly T[]): T[] {
    return previous.length === 0 ? (previous as T[]) : [];
}

export function resolveSkippedEmptyThemeMarkerPlan({
    displayRestaurantCount,
    hasRenderedMarkerDom,
}: {
    displayRestaurantCount: number;
    hasRenderedMarkerDom: boolean;
}): 'skip' | 'continue' | 'retry' {
    if (displayRestaurantCount === 0) {
        return hasRenderedMarkerDom ? 'continue' : 'skip';
    }

    return hasRenderedMarkerDom ? 'skip' : 'retry';
}

export function resolveEmptyClusterMarkerCleanupPlan({
    displayRestaurantCount,
    clusterCount,
    expandedRestaurantCount = 0,
}: {
    displayRestaurantCount: number;
    clusterCount: number;
    expandedRestaurantCount?: number;
}): 'render' | 'release' | 'retry' {
    if (expandedRestaurantCount > 0) {
        return 'render';
    }

    if (displayRestaurantCount === 0) {
        return 'release';
    }

    if (clusterCount === 0) {
        return 'retry';
    }

    return 'render';
}
