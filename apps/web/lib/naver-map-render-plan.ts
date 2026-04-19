import type { Restaurant } from '@/types/restaurant';
import type Supercluster from 'supercluster';
import { isCluster, type ClusterProperties, type RegionalCluster, type SeoulDistrictCluster } from '@/lib/clustering';
import { getPrimaryCategory, isRestaurantInViewport, type ExtendedBounds } from '@/lib/naver-map-view-helpers';

const formatCoordForSignature = (value: number | null | undefined): string =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : 'na';

const toRestaurantRenderToken = (restaurant: Restaurant, prefix = 'restaurant'): string =>
    `${prefix}-${restaurant.id}:${formatCoordForSignature(restaurant.lat)}:${formatCoordForSignature(restaurant.lng)}:${getPrimaryCategory(restaurant)}`;

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
            restaurant.id === selectedRestaurantId ||
            isRestaurantInViewport(restaurant, extendedBounds)
    );
}

export function buildRenderTargetIdsForSignature({
    activeSearchedRestaurant,
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
