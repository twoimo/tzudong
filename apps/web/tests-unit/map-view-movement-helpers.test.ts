import { describe, expect, test } from 'bun:test';

import {
    resolveMapViewSelectedPanTarget,
    shouldCenterSelectedRestaurant,
} from '../lib/map-view-movement-helpers';

describe('map view movement helpers', () => {
    test('detects when selected restaurant should be re-centered', () => {
        expect(shouldCenterSelectedRestaurant({
            lastCenteredRestaurantId: null,
            selectedRestaurantId: 'r1',
        })).toBe(true);

        expect(shouldCenterSelectedRestaurant({
            lastCenteredRestaurantId: 'r1',
            selectedRestaurantId: 'r1',
        })).toBe(false);
    });

    test('resolves lng shifted by half panel width', () => {
        expect(resolveMapViewSelectedPanTarget({
            boundsNorthEastLng: 130,
            boundsSouthWestLng: 120,
            lng: 127,
            mapWidth: 1000,
            panelWidth: 400,
            sidebarWidth: 0,
        })).toBe(129);
    });
});
