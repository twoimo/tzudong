import { describe, expect, test } from 'bun:test';

import { getNaverPanelStateFlags } from '../lib/naver-map-panel-state-helpers';

describe('naver map panel state helpers', () => {
    test('marks internal shrinking layout only for local detail panel mode', () => {
        expect(
            getNaverPanelStateFlags({
                internalPanelOpen: true,
                isGridMode: false,
            }),
        ).toEqual({
            isExternalPanelOpen: false,
            isInternalMode: true,
            isShrinkingLayout: true,
        });
    });

    test('treats external marker click mode separately', () => {
        expect(
            getNaverPanelStateFlags({
                externalPanelOpen: false,
                internalPanelOpen: true,
                isGridMode: false,
                onMarkerClick: () => {},
            }),
        ).toEqual({
            isExternalPanelOpen: true,
            isInternalMode: false,
            isShrinkingLayout: false,
        });
    });

    test('does not shrink layout in grid mode', () => {
        expect(
            getNaverPanelStateFlags({
                internalPanelOpen: true,
                isGridMode: true,
            }),
        ).toEqual({
            isExternalPanelOpen: false,
            isInternalMode: true,
            isShrinkingLayout: false,
        });
    });
});
