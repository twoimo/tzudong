import type { Restaurant } from '@/types/restaurant';

type RestaurantMatch = Pick<Restaurant, 'id' | 'name' | 'lat' | 'lng' | 'mergedRestaurants'> | null | undefined;

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
