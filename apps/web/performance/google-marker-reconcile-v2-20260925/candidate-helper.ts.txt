import type { Restaurant } from '../types/restaurant';
import { sanitizeMarkerImageUrl } from './html-escape';
import { getRestaurantLatLng } from './map-view-google-helpers';
import { getMapViewMarkerIcon } from './map-view-helpers';
import {
    buildMapViewMarkerHtml,
    getMapViewMarkerSize,
    isMapViewMarkerSelected,
} from './map-view-marker-helpers';

export interface ManagedMapViewMarker {
    map: unknown;
    content: Node | null;
    position?: unknown;
    title?: string;
}

export interface MapViewMarkerEntry<M extends ManagedMapViewMarker> {
    marker: M;
    restaurantId: string;
    restaurant: Restaurant;
    position: { lat: number; lng: number };
    imagePath: string;
    name: string;
    onActivate: (restaurant: Restaurant) => void;
}

// Reconcile in O(previous + next) time. Retained IDs keep their marker, image,
// and click listener; only added/removed IDs attach/detach provider objects.
export function reconcileMapViewMarkers<M extends ManagedMapViewMarker>({
    previous,
    restaurants,
    createMarker,
    onActivate,
    selectedRestaurantId,
    searchedRestaurantId,
}: {
    previous: readonly MapViewMarkerEntry<M>[];
    restaurants: readonly Restaurant[];
    createMarker: (options: {
        position: { lat: number; lng: number };
        content: HTMLElement;
        title: string;
    }) => M | null;
    onActivate: (restaurant: Restaurant) => void;
    selectedRestaurantId?: string | null;
    searchedRestaurantId?: string | null;
}): MapViewMarkerEntry<M>[] {
    const remaining = new Map(previous.map((entry) => [entry.restaurantId, entry]));
    const next: MapViewMarkerEntry<M>[] = [];
    const seen = new Set<string>();

    for (const restaurant of restaurants) {
        const position = getRestaurantLatLng(restaurant);
        if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)
            || seen.has(restaurant.id)) continue;
        seen.add(restaurant.id);
        const imagePath = getMapViewMarkerIcon(restaurant.categories);
        const retained = remaining.get(restaurant.id);
        if (retained) {
            remaining.delete(restaurant.id);
            if (retained.position.lat !== position.lat || retained.position.lng !== position.lng) {
                retained.marker.position = position;
                retained.position = position;
            }
            if (retained.imagePath !== imagePath || retained.name !== restaurant.name) {
                const image = (retained.marker.content as HTMLElement | null)?.querySelector('img');
                if (retained.imagePath !== imagePath) image?.setAttribute('src', sanitizeMarkerImageUrl(imagePath));
                if (retained.name !== restaurant.name) {
                    image?.setAttribute('alt', restaurant.name);
                    retained.marker.title = restaurant.name;
                }
                retained.imagePath = imagePath;
                retained.name = restaurant.name;
            }
            // The listener reads these fields at click time, including after a
            // same-ID data refresh or a parent callback change.
            retained.restaurant = restaurant;
            retained.onActivate = onActivate;
            next.push(retained);
            continue;
        }

        const isSelected = isMapViewMarkerSelected({
            restaurantId: restaurant.id, selectedRestaurantId, searchedRestaurantId,
        });
        const content = document.createElement('div');
        content.className = `custom-marker ${isSelected ? 'selected-marker' : ''}`;
        content.innerHTML = buildMapViewMarkerHtml({
            imagePath, isSelected, markerSize: getMapViewMarkerSize(isSelected), name: restaurant.name,
        });
        const marker = createMarker({ position, content, title: restaurant.name });
        if (!marker) continue;
        const entry: MapViewMarkerEntry<M> = {
            marker, restaurantId: restaurant.id, restaurant, position,
            imagePath, name: restaurant.name, onActivate,
        };
        content.addEventListener('click', () => entry.onActivate(entry.restaurant));
        next.push(entry);
    }

    // Keep the old visible markers until replacements have been attached.
    for (const entry of remaining.values()) entry.marker.map = null;
    return next;
}
