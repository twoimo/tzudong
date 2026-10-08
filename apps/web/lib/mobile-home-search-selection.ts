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

    const leftMerged = left.mergedRestaurants;
    const rightMerged = right.mergedRestaurants;
    if ((!leftMerged || leftMerged.length === 0) && (!rightMerged || rightMerged.length === 0)) {
        return hasSameNameAndCoordinate(left, right);
    }

    const leftIds = new Set([
        left.id,
        ...(leftMerged?.map((restaurant) => restaurant.id) ?? []),
    ]);
    const rightIds = [
        right.id,
        ...(rightMerged?.map((restaurant) => restaurant.id) ?? []),
    ];

    if (rightIds.some((id) => leftIds.has(id))) {
        return true;
    }

    return hasSameNameAndCoordinate(left, right);
};

// A render pass compares many candidates with one selection. Build its merged-id
// index at most once, instead of allocating a Set and arrays for every candidate.
const createRestaurantSelectionMatcher = (selection: Restaurant) => {
    let selectionIds: Set<string> | undefined;
    return (candidate: Restaurant): boolean => {
        if (candidate.id === selection.id || hasSameNameAndCoordinate(candidate, selection)) return true;
        const selectionMerged = selection.mergedRestaurants;
        const candidateMerged = candidate.mergedRestaurants;
        if (!selectionMerged?.length) {
            if (candidateMerged) {
                for (let index = 0; index < candidateMerged.length; index += 1) {
                    if (candidateMerged[index].id === selection.id) return true;
                }
            }
            return false;
        }
        if (!selectionIds) {
            selectionIds = new Set([selection.id]);
            for (let index = 0; index < selectionMerged.length; index += 1) {
                selectionIds.add(selectionMerged[index].id);
            }
        }
        if (selectionIds.has(candidate.id)) return true;
        if (candidateMerged) {
            for (let index = 0; index < candidateMerged.length; index += 1) {
                if (selectionIds.has(candidateMerged[index].id)) return true;
            }
        }
        return false;
    };
};

type SelectionCacheKey = Readonly<Pick<Restaurant, 'id' | 'name' | 'lat' | 'lng'> & { mergedIds: readonly string[] }>;
const EMPTY_MERGED_IDS: readonly string[] = [];

const selectionCacheKey = (selection: Restaurant): SelectionCacheKey => ({
    id: selection.id,
    name: selection.name,
    lat: selection.lat,
    lng: selection.lng,
    mergedIds: selection.mergedRestaurants?.length
        ? selection.mergedRestaurants.map((item) => item.id)
        : EMPTY_MERGED_IDS,
});

const matchesSelectionCacheKey = (key: SelectionCacheKey, selection: Restaurant): boolean => {
    if (key.id !== selection.id || key.name !== selection.name
        || !Object.is(key.lat, selection.lat) || !Object.is(key.lng, selection.lng)) return false;
    const merged = selection.mergedRestaurants;
    if (key.mergedIds.length !== (merged?.length ?? 0)) return false;
    for (let index = 0; index < key.mergedIds.length; index += 1) {
        if (key.mergedIds[index] !== merged![index].id) return false;
    }
    return true;
};

// Multiple visible lists share catalog rows. Keep one immutable key per live
// row instead of allocating another key for every list containing that row.
// Replacing a changed key leaves older list snapshots able to detect the edit.
const rowSelectionKeys = new WeakMap<Restaurant, SelectionCacheKey>();
const snapshotKeyForRestaurant = (restaurant: Restaurant): SelectionCacheKey => {
    const previous = rowSelectionKeys.get(restaurant);
    if (previous && matchesSelectionCacheKey(previous, restaurant)) return previous;
    const key = selectionCacheKey(restaurant);
    rowSelectionKeys.set(restaurant, key);
    return key;
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

export const resolveSearchSelectionReleasePlan = ({
    activeSearchedRestaurant,
    hasReleaseHandler,
    releasedSearchSelectionId,
}: {
    activeSearchedRestaurant: Pick<Restaurant, 'id'> | null;
    hasReleaseHandler: boolean;
    releasedSearchSelectionId: string | null;
}) => {
    if (!activeSearchedRestaurant || !hasReleaseHandler) {
        return {
            nextReleasedSearchSelectionId: releasedSearchSelectionId,
            shouldRelease: false,
        } as const;
    }

    if (releasedSearchSelectionId === activeSearchedRestaurant.id) {
        return {
            nextReleasedSearchSelectionId: releasedSearchSelectionId,
            shouldRelease: false,
        } as const;
    }

    return {
        nextReleasedSearchSelectionId: activeSearchedRestaurant.id,
        shouldRelease: true,
    } as const;
};

export const resolveReleasedSearchSelectionResetPlan = ({
    activeSearchedRestaurant,
    releasedSearchSelectionId,
}: {
    activeSearchedRestaurant: Pick<Restaurant, 'id'> | null;
    releasedSearchSelectionId: string | null;
}) => {
    if (!activeSearchedRestaurant) {
        return { nextReleasedSearchSelectionId: null } as const;
    }

    if (releasedSearchSelectionId && releasedSearchSelectionId !== activeSearchedRestaurant.id) {
        return { nextReleasedSearchSelectionId: null } as const;
    }

    return { nextReleasedSearchSelectionId: releasedSearchSelectionId } as const;
};

type SwipeListSnapshot = {
    references: Restaurant[];
    keys: SelectionCacheKey[];
    unique: Restaurant[];
};
const swipeListSnapshots = new WeakMap<Restaurant[], SwipeListSnapshot>();
let lastPostSearchDedupeExaminationCount = 0;

export function getLastPostSearchDedupeExaminationCount() {
    return lastPostSearchDedupeExaminationCount;
}

const dedupeRestaurants = (restaurants: Restaurant[]): Restaurant[] => {
    const snapshot = swipeListSnapshots.get(restaurants);
    if (snapshot && snapshot.references.length === restaurants.length
        && restaurants.every((restaurant, index) => snapshot.references[index] === restaurant
            && matchesSelectionCacheKey(snapshot.keys[index], restaurant))) {
        return snapshot.unique;
    }
    // Array identity alone is insufficient: callers can replace rows or edit
    // matching fields in place. Drop the dependent results on any such change.
    orderedVisibleCache.delete(restaurants);
    nearestSwipeFallbackCache.delete(restaurants);
    lastPostSearchDedupeExaminationCount += 1;
    const seenIds = new Set<string>();
    const seenMergedIds = new Set<string>();
    const restaurantsByName = new Map<string, Restaurant[]>();
    const uniqueRestaurants: Restaurant[] = [];

    restaurants.forEach((restaurant) => {
        if (seenIds.has(restaurant.id) || seenMergedIds.has(restaurant.id)) return;

        const sameNameRestaurants = restaurantsByName.get(restaurant.name);
        if (sameNameRestaurants?.some((candidate) => hasSameNameAndCoordinate(candidate, restaurant))) return;

        const mergedRestaurants = restaurant.mergedRestaurants;
        if (mergedRestaurants?.some((mergedRestaurant) =>
            seenIds.has(mergedRestaurant.id) || seenMergedIds.has(mergedRestaurant.id))) {
            return;
        }

        seenIds.add(restaurant.id);
        mergedRestaurants?.forEach((mergedRestaurant) => seenMergedIds.add(mergedRestaurant.id));
        uniqueRestaurants.push(restaurant);
        if (sameNameRestaurants) sameNameRestaurants.push(restaurant);
        else restaurantsByName.set(restaurant.name, [restaurant]);
    });

    const unique = uniqueRestaurants.length === restaurants.length ? restaurants : uniqueRestaurants;
    swipeListSnapshots.set(restaurants, {
        references: restaurants.slice(),
        keys: restaurants.map(snapshotKeyForRestaurant),
        unique,
    });
    return unique;
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
    return latDiffKm * latDiffKm + lngDiffKm * lngDiffKm;
};

type BuildPostSearchSwipeCandidatesInput = {
    visibleRestaurants: Restaurant[];
    allRestaurants: Restaurant[];
    activeSearchedRestaurant: Restaurant | null;
};

export const buildRestaurantsForSwipe = ({
    activeSearchedRestaurant,
    selectedRestaurant,
    displayRestaurantIds,
    displayRestaurants,
}: {
    activeSearchedRestaurant: Restaurant | null;
    selectedRestaurant?: Restaurant | null;
    displayRestaurantIds: Set<string>;
    displayRestaurants: Restaurant[];
}): Restaurant[] => {
    const pinnedRestaurants = [activeSearchedRestaurant, selectedRestaurant].filter(Boolean) as Restaurant[];
    if (pinnedRestaurants.length === 0) return displayRestaurants;

    const restaurantsToAdd: Restaurant[] = [];
    pinnedRestaurants.forEach((restaurant) => {
        if (displayRestaurantIds.has(restaurant.id)) return;
        if (displayRestaurants.some((candidate) => isSameRestaurantSelection(candidate, restaurant))) return;
        if (restaurantsToAdd.some((candidate) => isSameRestaurantSelection(candidate, restaurant))) return;
        restaurantsToAdd.push(restaurant);
    });
    if (restaurantsToAdd.length === 0) return displayRestaurants;

    return [...displayRestaurants, ...restaurantsToAdd];
};

// Snapshots validate relevant row fields before lookup. Weak owners release
// list history when the list is no longer used; each history remains bounded.
const MAX_SEARCH_CACHE_ENTRIES = 64;
const rememberSelectionResult = <T>(cache: Map<string, T>, id: string, value: T) => {
    cache.delete(id);
    cache.set(id, value);
    if (cache.size > MAX_SEARCH_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
};

const nearestSwipeFallbackCache = new WeakMap<readonly Restaurant[], Map<string, {
    searched: SelectionCacheKey;
    visible: SelectionCacheKey;
    restaurant: Restaurant | null;
}>>();
let nearestFallbackScanCount = 0;

export function getNearestFallbackScanCount() {
    return nearestFallbackScanCount;
}

const orderedVisibleCache = new WeakMap<readonly Restaurant[], Map<string, {
    searched: SelectionCacheKey;
    restaurants: Restaurant[];
}>>();
let lastSwipeOrderBuildCount = 0;

export function getLastSwipeOrderBuildCount() {
    return lastSwipeOrderBuildCount;
}

export function getSwipeSelectionCacheState(visibleRestaurants: Restaurant[], allRestaurants: Restaurant[]) {
    const orders = orderedVisibleCache.get(visibleRestaurants);
    let allocatedOrderArrays = 0;
    let retainedOrderReferences = 0;
    const unique = swipeListSnapshots.get(visibleRestaurants)?.unique;
    for (const order of orders?.values() ?? []) {
        if (order.restaurants !== unique) {
            allocatedOrderArrays += 1;
            retainedOrderReferences += order.restaurants.length;
        }
    }
    return {
        orderEntries: orders?.size ?? 0,
        fallbackEntries: nearestSwipeFallbackCache.get(allRestaurants)?.size ?? 0,
        allocatedOrderArrays,
        retainedOrderReferences,
        snapshotRows: (swipeListSnapshots.get(visibleRestaurants)?.references.length ?? 0)
            + (allRestaurants === visibleRestaurants ? 0 : swipeListSnapshots.get(allRestaurants)?.references.length ?? 0),
    };
}

const orderRestaurantsForSelection = (restaurants: Restaurant[], selection: Restaurant): Restaurant[] => {
    const matches = createRestaurantSelectionMatcher(selection);
    let ordered: Restaurant[] | undefined;
    let firstUnmatched = -1;
    let head = 0;
    let tail = restaurants.length - 1;
    for (let index = 0; index < restaurants.length; index += 1) {
        const restaurant = restaurants[index];
        if (matches(restaurant)) {
            if (!ordered && firstUnmatched !== -1) {
                ordered = new Array<Restaurant>(restaurants.length);
                for (let prefix = 0; prefix < firstUnmatched; prefix += 1) ordered[prefix] = restaurants[prefix];
                for (let prior = firstUnmatched; prior < index; prior += 1) ordered[tail--] = restaurants[prior];
            }
            if (ordered) ordered[head] = restaurant;
            head += 1;
        } else {
            if (firstUnmatched === -1) firstUnmatched = index;
            if (ordered) ordered[tail--] = restaurant;
        }
    }
    // No match, all matches, or an already leading match group needs no copy.
    if (!ordered) return restaurants;
    for (let left = head, right = ordered.length - 1; left < right; left += 1, right -= 1) {
        const restaurant = ordered[left];
        ordered[left] = ordered[right];
        ordered[right] = restaurant;
    }
    return ordered;
};

export const buildPostSearchSwipeCandidates = ({
    visibleRestaurants,
    allRestaurants,
    activeSearchedRestaurant,
}: BuildPostSearchSwipeCandidatesInput): Restaurant[] => {
    const dedupedVisibleRestaurants = dedupeRestaurants(visibleRestaurants);
    let orderedVisibleRestaurants = dedupedVisibleRestaurants;
    if (activeSearchedRestaurant) {
        let orders = orderedVisibleCache.get(visibleRestaurants);
        if (!orders) {
            orders = new Map();
            orderedVisibleCache.set(visibleRestaurants, orders);
        }
        const cachedOrder = orders.get(activeSearchedRestaurant.id);
        if (cachedOrder && matchesSelectionCacheKey(cachedOrder.searched, activeSearchedRestaurant)) {
            orderedVisibleRestaurants = cachedOrder.restaurants;
            // A hit refreshes recency without increasing the fixed capacity.
            rememberSelectionResult(orders, activeSearchedRestaurant.id, cachedOrder);
        } else {
            lastSwipeOrderBuildCount += 1;
            orderedVisibleRestaurants = orderRestaurantsForSelection(dedupedVisibleRestaurants, activeSearchedRestaurant);
            rememberSelectionResult(orders, activeSearchedRestaurant.id, {
                searched: selectionCacheKey(activeSearchedRestaurant),
                restaurants: orderedVisibleRestaurants,
            });
        }
    }

    if (!activeSearchedRestaurant || orderedVisibleRestaurants.length !== 1) {
        return orderedVisibleRestaurants;
    }

    const visibleRestaurant = orderedVisibleRestaurants[0];
    const dedupedRestaurants = dedupeRestaurants(allRestaurants);
    let fallbacks = nearestSwipeFallbackCache.get(allRestaurants);
    if (!fallbacks) {
        fallbacks = new Map();
        nearestSwipeFallbackCache.set(allRestaurants, fallbacks);
    }
    const cached = fallbacks.get(activeSearchedRestaurant.id);
    if (cached && matchesSelectionCacheKey(cached.searched, activeSearchedRestaurant)
        && matchesSelectionCacheKey(cached.visible, visibleRestaurant)) {
        rememberSelectionResult(fallbacks, activeSearchedRestaurant.id, cached);
        const cachedFallback = cached.restaurant;
        return cachedFallback
            ? [...orderedVisibleRestaurants, cachedFallback]
            : orderedVisibleRestaurants;
    }

    nearestFallbackScanCount += 1;
    const matchesVisible = createRestaurantSelectionMatcher(visibleRestaurant);
    let nearestFallbackRestaurant: Restaurant | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < dedupedRestaurants.length; index += 1) {
        const candidateRestaurant = dedupedRestaurants[index];
        if (matchesVisible(candidateRestaurant)) continue;

        const candidateDistance = getApproximateRestaurantDistance(
            activeSearchedRestaurant,
            candidateRestaurant,
        );
        if (!Number.isFinite(candidateDistance) || candidateDistance >= nearestDistance) continue;

        nearestFallbackRestaurant = candidateRestaurant;
        nearestDistance = candidateDistance;
    }

    rememberSelectionResult(fallbacks, activeSearchedRestaurant.id, {
        searched: selectionCacheKey(activeSearchedRestaurant),
        visible: selectionCacheKey(visibleRestaurant),
        restaurant: nearestFallbackRestaurant,
    });

    return nearestFallbackRestaurant
        ? [...orderedVisibleRestaurants, nearestFallbackRestaurant]
        : orderedVisibleRestaurants;
};
