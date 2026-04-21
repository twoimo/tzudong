import type { Restaurant } from '@/types/restaurant';

type RestaurantMatch = Pick<Restaurant, 'id' | 'name' | 'lat' | 'lng' | 'mergedRestaurants'> | null | undefined;
type SearchSelectionSnapshot = {
    searchedRestaurant: Restaurant | null;
    selectedRestaurant: Restaurant | null;
    panelRestaurant: Restaurant | null;
    isPanelOpen: boolean;
};

const hasSameNameAndCoordinate = (left: RestaurantMatch, right: RestaurantMatch): boolean => {
    if (!left || !right) return false;

    return (
        left.name === right.name &&
        Math.abs((left.lat || 0) - (right.lat || 0)) < 0.0001 &&
        Math.abs((left.lng || 0) - (right.lng || 0)) < 0.0001
    );
};

export const isSameRestaurantSelection = (left: RestaurantMatch, right: RestaurantMatch): boolean => {
    if (!left || !right) return false;
    if (left.id === right.id) return true;

    const leftIds = new Set([
        left.id,
        ...(left.mergedRestaurants?.map((restaurant) => restaurant.id) ?? []),
    ]);
    const rightIds = [
        right.id,
        ...(right.mergedRestaurants?.map((restaurant) => restaurant.id) ?? []),
    ];

    if (rightIds.some((id) => leftIds.has(id))) {
        return true;
    }

    return hasSameNameAndCoordinate(left, right);
};

type SearchSelectionInput = {
    searchedRestaurant: Restaurant | null;
    selectedRestaurant: Restaurant | null;
};

export const getActiveSearchedRestaurant = ({
    searchedRestaurant,
    selectedRestaurant,
}: SearchSelectionInput): Restaurant | null => {
    if (!searchedRestaurant) return null;
    if (!selectedRestaurant) return searchedRestaurant;

    return isSameRestaurantSelection(searchedRestaurant, selectedRestaurant)
        ? searchedRestaurant
        : null;
};

type ShouldHandleSearchSelectionInput = SearchSelectionInput & {
    previousHandledRestaurant: Restaurant | null;
};

export const shouldHandleSearchSelection = ({
    searchedRestaurant,
    selectedRestaurant,
    previousHandledRestaurant,
}: ShouldHandleSearchSelectionInput): boolean => {
    const activeSearchedRestaurant = getActiveSearchedRestaurant({
        searchedRestaurant,
        selectedRestaurant,
    });

    if (!activeSearchedRestaurant) return false;
    if (!previousHandledRestaurant) return true;

    return !isSameRestaurantSelection(previousHandledRestaurant, activeSearchedRestaurant);
};

export const releaseSearchSelectionOwnership = (
    snapshot: SearchSelectionSnapshot,
): SearchSelectionSnapshot => {
    if (!getActiveSearchedRestaurant(snapshot)) {
        return snapshot;
    }

    return {
        ...snapshot,
        searchedRestaurant: null,
    };
};

const dedupeRestaurants = (restaurants: Restaurant[]): Restaurant[] => {
    const uniqueRestaurants: Restaurant[] = [];

    restaurants.forEach((restaurant) => {
        if (!uniqueRestaurants.some((candidate) => isSameRestaurantSelection(candidate, restaurant))) {
            uniqueRestaurants.push(restaurant);
        }
    });

    return uniqueRestaurants;
};

const getApproximateRestaurantDistance = (
    source: Pick<Restaurant, 'lat' | 'lng'>,
    candidate: Pick<Restaurant, 'lat' | 'lng'>,
): number => {
    const sourceLat = Number(source.lat);
    const sourceLng = Number(source.lng);
    const candidateLat = Number(candidate.lat);
    const candidateLng = Number(candidate.lng);

    if (
        !Number.isFinite(sourceLat) ||
        !Number.isFinite(sourceLng) ||
        !Number.isFinite(candidateLat) ||
        !Number.isFinite(candidateLng)
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const latDiffKm = (sourceLat - candidateLat) * 111;
    const lngDiffKm = (sourceLng - candidateLng) * 88;
    return Math.sqrt(latDiffKm ** 2 + lngDiffKm ** 2);
};

type BuildPostSearchSwipeCandidatesInput = {
    visibleRestaurants: Restaurant[];
    allRestaurants: Restaurant[];
    activeSearchedRestaurant: Restaurant | null;
};

export const buildRestaurantsForSwipe = ({
    activeSearchedRestaurant,
    displayRestaurantIds,
    displayRestaurants,
}: {
    activeSearchedRestaurant: Restaurant | null;
    displayRestaurantIds: Set<string>;
    displayRestaurants: Restaurant[];
}): Restaurant[] => {
    if (!activeSearchedRestaurant || displayRestaurantIds.has(activeSearchedRestaurant.id)) {
        return displayRestaurants;
    }

    return [...displayRestaurants, activeSearchedRestaurant];
};

export const buildPostSearchSwipeCandidates = ({
    visibleRestaurants,
    allRestaurants,
    activeSearchedRestaurant,
}: BuildPostSearchSwipeCandidatesInput): Restaurant[] => {
    const dedupedVisibleRestaurants = dedupeRestaurants(visibleRestaurants);
    if (!activeSearchedRestaurant || dedupedVisibleRestaurants.length !== 1) {
        return dedupedVisibleRestaurants;
    }

    const nearestFallbackRestaurant = dedupeRestaurants(allRestaurants).reduce<Restaurant | null>(
        (nearestRestaurant, candidateRestaurant) => {
            if (dedupedVisibleRestaurants.some((restaurant) => isSameRestaurantSelection(restaurant, candidateRestaurant))) {
                return nearestRestaurant;
            }

            const candidateDistance = getApproximateRestaurantDistance(
                activeSearchedRestaurant,
                candidateRestaurant,
            );
            if (!Number.isFinite(candidateDistance)) {
                return nearestRestaurant;
            }

            if (!nearestRestaurant) {
                return candidateRestaurant;
            }

            const nearestDistance = getApproximateRestaurantDistance(
                activeSearchedRestaurant,
                nearestRestaurant,
            );

            return candidateDistance < nearestDistance ? candidateRestaurant : nearestRestaurant;
        },
        null,
    );

    return nearestFallbackRestaurant
        ? [...dedupedVisibleRestaurants, nearestFallbackRestaurant]
        : dedupedVisibleRestaurants;
};
