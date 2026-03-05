import { describe, expect, test } from 'bun:test';

import {
    calculateHoverAnchoredCenter,
    type GeoPoint,
    type HoverAnchorProjection,
    type OffsetPoint,
} from '../lib/map-hover-anchor';

type LinearProjectionState = {
    center: GeoPoint;
    scale: number;
    viewportCenter: OffsetPoint;
};

const makeLinearProjection = (state: LinearProjectionState): HoverAnchorProjection => ({
    fromCoordToOffset: (coord) => ({
        x: state.viewportCenter.x + (coord.lng - state.center.lng) * state.scale,
        y: state.viewportCenter.y - (coord.lat - state.center.lat) * state.scale,
    }),
    fromOffsetToCoord: (offset) => ({
        lat: state.center.lat - (offset.y - state.viewportCenter.y) / state.scale,
        lng: state.center.lng + (offset.x - state.viewportCenter.x) / state.scale,
    }),
});

describe('map hover anchor center adjustment', () => {
    test('keeps hovered coordinate stable after zoom in', () => {
        const state: LinearProjectionState = {
            center: { lat: 37.5665, lng: 126.9780 },
            scale: 1200,
            viewportCenter: { x: 600, y: 400 },
        };
        const mouseOffset = { x: 860, y: 230 };

        const projectionBefore = makeLinearProjection(state);
        const anchorCoordBeforeZoom = projectionBefore.fromOffsetToCoord(mouseOffset);

        state.scale = state.scale * 2; // zoom in
        const projectionAfterZoom = makeLinearProjection(state);

        const adjustedCenter = calculateHoverAnchoredCenter({
            projection: projectionAfterZoom,
            anchorCoordBeforeZoom,
            currentCenter: state.center,
            mouseOffset,
        });

        state.center = adjustedCenter;
        const projectionAfterAdjust = makeLinearProjection(state);
        const finalOffset = projectionAfterAdjust.fromCoordToOffset(anchorCoordBeforeZoom);

        expect(Math.abs(finalOffset.x - mouseOffset.x)).toBeLessThan(0.0001);
        expect(Math.abs(finalOffset.y - mouseOffset.y)).toBeLessThan(0.0001);
    });

    test('keeps hovered coordinate stable after zoom out', () => {
        const state: LinearProjectionState = {
            center: { lat: 35.1796, lng: 129.0756 },
            scale: 1800,
            viewportCenter: { x: 720, y: 420 },
        };
        const mouseOffset = { x: 500, y: 520 };

        const projectionBefore = makeLinearProjection(state);
        const anchorCoordBeforeZoom = projectionBefore.fromOffsetToCoord(mouseOffset);

        state.scale = state.scale / 2; // zoom out
        const projectionAfterZoom = makeLinearProjection(state);

        const adjustedCenter = calculateHoverAnchoredCenter({
            projection: projectionAfterZoom,
            anchorCoordBeforeZoom,
            currentCenter: state.center,
            mouseOffset,
        });

        state.center = adjustedCenter;
        const projectionAfterAdjust = makeLinearProjection(state);
        const finalOffset = projectionAfterAdjust.fromCoordToOffset(anchorCoordBeforeZoom);

        expect(Math.abs(finalOffset.x - mouseOffset.x)).toBeLessThan(0.0001);
        expect(Math.abs(finalOffset.y - mouseOffset.y)).toBeLessThan(0.0001);
    });
});
