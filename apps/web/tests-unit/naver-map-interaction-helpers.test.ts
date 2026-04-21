import { describe, expect, test } from 'bun:test';

import {
    buildNaverMapInteractionHandlers,
    buildNaverMapInteractionListenerPlan,
    NAVER_INTERACTION_LISTENER_OPTIONS,
    NAVER_INTERACTION_REMOVE_OPTIONS,
} from '../lib/naver-map-interaction-helpers';

describe('naver map interaction helpers', () => {
    test('exposes passive capture listener options', () => {
        expect(NAVER_INTERACTION_LISTENER_OPTIONS).toEqual({
            capture: true,
            passive: true,
        });
        expect(NAVER_INTERACTION_REMOVE_OPTIONS).toEqual({
            capture: true,
        });
    });

    test('builds stable DOM and map interaction listener plan', () => {
        expect(buildNaverMapInteractionListenerPlan()).toEqual({
            domListeners: [
                { eventName: 'wheel', handlerKey: 'searchRelease' },
                { eventName: 'dblclick', handlerKey: 'searchRelease' },
                { eventName: 'mousedown', handlerKey: 'userInteraction' },
                { eventName: 'touchstart', handlerKey: 'userInteraction' },
            ],
            mapEventNames: ['dragstart', 'pinchstart'],
        });
    });

    test('marks map as user-moved and optionally releases search selection', () => {
        const movedRef = { current: false };
        let releases = 0;
        const { handleUserInteraction, handleSearchReleaseInteraction } = buildNaverMapInteractionHandlers({
            hasUserMovedMapRef: movedRef,
            releaseSearchSelectionOnUserInteraction: () => {
                releases += 1;
            },
        });

        handleUserInteraction();
        expect(movedRef.current).toBe(true);
        expect(releases).toBe(0);

        movedRef.current = false;
        handleSearchReleaseInteraction();
        expect(movedRef.current).toBe(true);
        expect(releases).toBe(1);
    });
});
