import type { Restaurant } from '@/types/restaurant';

import { findMatchingRestaurantInList } from './map-restaurant-lookup';
import {
    isSameRestaurantSelection,
    shouldHandleSearchSelection,
} from './mobile-home-search-selection';

export function resolveNaverSelectionChange({
    currentSelectedId,
    previousSelectedId,
}: {
    currentSelectedId: string | null;
    previousSelectedId: string | null;
}) {
    const isSelectionChanged = currentSelectedId !== previousSelectedId;

    return {
        isSelectionChanged,
        nextSelectedId: currentSelectedId,
    };
}

export function resolveNaverSelectedMarkerStyleUpdatePlan({
    currentSelectedId,
    previousSelectedId,
}: {
    currentSelectedId: string | null;
    previousSelectedId: string | null;
}) {
    if (currentSelectedId === previousSelectedId) {
        return {
            nextPreviousSelectedId: previousSelectedId,
            shouldSkip: true,
            updates: [],
        } as const;
    }

    const updates: Array<{ isSelected: boolean; restaurantId: string }> = [];

    if (previousSelectedId) {
        updates.push({
            isSelected: false,
            restaurantId: previousSelectedId,
        });
    }

    if (currentSelectedId) {
        updates.push({
            isSelected: true,
            restaurantId: currentSelectedId,
        });
    }

    return {
        nextPreviousSelectedId: currentSelectedId,
        shouldSkip: false,
        updates,
    } as const;
}

export function resolveNaverSearchSelectionPlan({
    activeSearchedRestaurant,
    previousHandledRestaurant,
    restaurants,
    selectedRestaurant,
}: {
    activeSearchedRestaurant: Restaurant | null;
    previousHandledRestaurant: Restaurant | null;
    restaurants: Restaurant[];
    selectedRestaurant: Restaurant | null;
}) {
    if (!activeSearchedRestaurant) {
        return {
            actualSearchedRestaurant: null,
            focusTarget: null,
            matchedExistingRestaurant: null,
            nextPreviousSearchedRestaurant: null,
            shouldHandle: false,
            shouldNotifyParentSelection: false,
            shouldOpenPanel: false,
        } as const;
    }

    const matchedExistingRestaurant = findMatchingRestaurantInList(activeSearchedRestaurant, restaurants);
    const actualSearchedRestaurant = matchedExistingRestaurant ?? activeSearchedRestaurant;
    const shouldNotifyParentSelection = Boolean(
        matchedExistingRestaurant &&
        !isSameRestaurantSelection(matchedExistingRestaurant, selectedRestaurant)
    );
    const shouldHandle = shouldHandleSearchSelection({
        searchedRestaurant: actualSearchedRestaurant,
        selectedRestaurant,
        previousHandledRestaurant,
    });

    return {
        actualSearchedRestaurant,
        focusTarget: shouldHandle
            ? {
                lat: actualSearchedRestaurant.lat,
                lng: actualSearchedRestaurant.lng,
                zoom: 15,
            }
            : null,
        matchedExistingRestaurant,
        nextPreviousSearchedRestaurant: shouldHandle
            ? actualSearchedRestaurant
            : previousHandledRestaurant,
        shouldHandle,
        shouldNotifyParentSelection,
        shouldOpenPanel: shouldHandle,
    } as const;
}
