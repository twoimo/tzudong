import { describe, expect, test } from 'bun:test';

import {
    buildNaverWheelAnchorAdjustmentPlan,
    buildNaverWheelInput,
    buildNaverWheelProjectionAdapter,
    buildNaverWheelCenterOffsetAfterZoom,
    buildNaverWheelViewportPlan,
    clearNaverPendingAnchorAdjustListener,
    flushQueuedNaverWheelInput,
    resolveNaverWheelCleanupState,
    resolveNaverWheelInputDispatch,
    resolveNaverWheelPostAdjustPlan,
    resolveNaverWheelZoomPlan,
} from '../lib/naver-map-wheel-helpers';

describe('naver map wheel helpers', () => {
    test('returns no-op when delta direction is zero', () => {
        expect(resolveNaverWheelZoomPlan({
            currentMapZoom: 10,
            deltaY: 0,
            maxZoom: 18,
            minZoom: 6,
            previousTargetZoom: 10,
            timeDiffMs: 50,
        })).toEqual({
            nextZoom: 10,
            normalizedDirection: 0,
            shouldApply: false,
        });
    });

    test('uses previous target zoom during fast continuous wheel input', () => {
        expect(resolveNaverWheelZoomPlan({
            currentMapZoom: 10.2,
            deltaY: -1,
            maxZoom: 18,
            minZoom: 6,
            previousTargetZoom: 11,
            timeDiffMs: 100,
        })).toEqual({
            nextZoom: 12,
            normalizedDirection: -1,
            shouldApply: true,
        });
    });

    test('clamps zoom to min/max bounds', () => {
        expect(resolveNaverWheelZoomPlan({
            currentMapZoom: 6,
            deltaY: 10,
            maxZoom: 18,
            minZoom: 6,
            previousTargetZoom: 7,
            timeDiffMs: 1000,
        }).nextZoom).toBe(6);

        expect(resolveNaverWheelZoomPlan({
            currentMapZoom: 18,
            deltaY: -10,
            maxZoom: 18,
            minZoom: 6,
            previousTargetZoom: 17,
            timeDiffMs: 1000,
        }).nextZoom).toBe(18);
    });

    test('builds viewport-relative mouse offsets and in-bounds flag', () => {
        expect(buildNaverWheelViewportPlan({
            centerOffset: { x: 500, y: 600 },
            clientX: 220,
            clientY: 170,
            rectHeight: 200,
            rectLeft: 20,
            rectTop: 20,
            rectWidth: 300,
        })).toEqual({
            isInsideViewport: true,
            mouseOffset: { x: 550, y: 650 },
            mousePoint: { x: 200, y: 150 },
            viewportCenterPoint: { x: 150, y: 100 },
        });
    });

    test('marks viewport plan as outside when wheel event is beyond bounds', () => {
        expect(buildNaverWheelViewportPlan({
            centerOffset: { x: 500, y: 600 },
            clientX: -10,
            clientY: 170,
            rectHeight: 200,
            rectLeft: 20,
            rectTop: 20,
            rectWidth: 300,
        }).isInsideViewport).toBe(false);
    });

    test('rebuilds center-relative mouse offset after zoom', () => {
        expect(buildNaverWheelCenterOffsetAfterZoom({
            centerOffsetAfterZoom: { x: 800, y: 900 },
            mousePoint: { x: 210, y: 180 },
            viewportCenterPoint: { x: 150, y: 100 },
        })).toEqual({
            x: 860,
            y: 980,
        });
    });

    test('builds anchor adjustment payload for hover-preserving zoom correction', () => {
        expect(buildNaverWheelAnchorAdjustmentPlan({
            anchorCoordBeforeZoom: { lat: 37.5, lng: 127.1 },
            centerOffsetAfterZoom: { x: 800, y: 900 },
            currentCenter: { lat: 37.6, lng: 127.2 },
            mousePoint: { x: 210, y: 180 },
            viewportCenterPoint: { x: 150, y: 100 },
        })).toEqual({
            anchorCoordBeforeZoom: { lat: 37.5, lng: 127.1 },
            currentCenter: { lat: 37.6, lng: 127.2 },
            mouseOffset: { x: 860, y: 980 },
        });
    });

    test('builds stable wheel input payload', () => {
        expect(buildNaverWheelInput({
            clientX: 120,
            clientY: 240,
            deltaY: -100,
        })).toEqual({
            clientX: 120,
            clientY: 240,
            deltaY: -100,
        });
    });

    test('queues wheel input when anchor adjustment is still running', () => {
        const input = buildNaverWheelInput({
            clientX: 10,
            clientY: 20,
            deltaY: 30,
        });

        expect(resolveNaverWheelInputDispatch({
            input,
            isAnchorAdjusting: true,
        })).toEqual({
            nextQueuedWheelInput: input,
            shouldHandleImmediately: false,
        });
    });

    test('flushes queued wheel input only when anchor adjustment is idle', () => {
        const queuedWheelInput = buildNaverWheelInput({
            clientX: 10,
            clientY: 20,
            deltaY: 30,
        });

        expect(flushQueuedNaverWheelInput({
            isAnchorAdjusting: false,
            queuedWheelInput,
        })).toEqual({
            nextInput: queuedWheelInput,
            nextQueuedWheelInput: null,
            shouldHandleNextInput: true,
        });

        expect(flushQueuedNaverWheelInput({
            isAnchorAdjusting: true,
            queuedWheelInput,
        })).toEqual({
            nextInput: null,
            nextQueuedWheelInput: queuedWheelInput,
            shouldHandleNextInput: false,
        });
    });

    test('resolves post-adjust continuation state from current zoom and queue flag', () => {
        expect(resolveNaverWheelPostAdjustPlan({
            currentZoom: 12,
            hasQueuedWheelInput: true,
        })).toEqual({
            nextIsAnchorAdjusting: false,
            nextTargetZoomLevel: 12,
            shouldScheduleQueuedInput: true,
        });
    });

    test('builds projection adapter around map constructors and projection API', () => {
        const adapter = buildNaverWheelProjectionAdapter({
            createLatLng: (lat, lng) => ({ kind: 'latlng', lat, lng }),
            createPoint: (x, y) => ({ kind: 'point', x, y }),
            projection: {
                fromCoordToOffset: (coord) => ({
                    x: (coord as { lat: number }).lat + 1,
                    y: (coord as { lng: number }).lng + 2,
                }),
                fromOffsetToCoord: (offset) => ({
                    lat: () => (offset as { x: number }).x + 3,
                    lng: () => (offset as { y: number }).y + 4,
                }),
            },
        });

        expect(adapter.fromCoordToOffset({ lat: 10, lng: 20 })).toEqual({
            x: 11,
            y: 22,
        });
        expect(adapter.fromOffsetToCoord({ x: 30, y: 40 })).toEqual({
            lat: 33,
            lng: 44,
        });
    });

    test('clears a pending anchor-adjust listener through injected remover', () => {
        const removed: string[] = [];
        expect(clearNaverPendingAnchorAdjustListener({
            pendingAnchorAdjustListener: 'listener-1',
            removeListener: (listener) => removed.push(listener),
        })).toEqual({
            nextPendingAnchorAdjustListener: null,
        });
        expect(removed).toEqual(['listener-1']);
    });

    test('resolves cleanup state by resetting anchor-adjust and queue state', () => {
        expect(resolveNaverWheelCleanupState()).toEqual({
            nextIsAnchorAdjusting: false,
            nextQueuedWheelInput: null,
        });
    });
});
