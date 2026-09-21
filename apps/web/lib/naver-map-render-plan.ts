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

export function getVisibleRestaurantsForRender(
    restaurantsForSwipe: Restaurant[],
    selectedRestaurantId: string | null,
    extendedBounds: ExtendedBounds | null,
    viewportFilterEnabled: boolean,
) {
    if (!viewportFilterEnabled) {
        return restaurantsForSwipe;
    }

    return restaurantsForSwipe.filter(
        (restaurant) =>
            (selectedRestaurantId != null && restaurant.id === selectedRestaurantId) ||
            isRestaurantInViewport(restaurant, extendedBounds)
    );
}

export function getRestaurantsWithRenderableCoordinates(restaurants: Restaurant[]) {
    return restaurants.flatMap((restaurant) => {
        const normalizedRestaurant = normalizeNaverMarkerCoordinates(restaurant);
        return normalizedRestaurant ? [normalizedRestaurant] : [];
    });
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
