import { describe, expect, test } from 'bun:test';

import {
    buildNaverCurrentStateSnapshot,
    getNaverCurrentPanelOffset,
} from '../lib/naver-map-current-state-helpers';

describe('naver map current state helpers', () => {
    test('builds current state snapshot from panel and layout state', () => {
        expect(buildNaverCurrentStateSnapshot({
            effectivePanelOffset: 400,
            externalPanelOpen: false,
            isGridMode: true,
            isPanelCollapsed: false,
            isSidebarOpen: true,
        })).toEqual({
            effectivePanelOffset: 400,
            externalPanelOpen: false,
            isGridMode: true,
            isPanelCollapsed: false,
            isSidebarOpen: true,
        });
    });

    test('returns current panel offset from snapshot', () => {
        expect(getNaverCurrentPanelOffset({ effectivePanelOffset: 320 })).toBe(320);
    });
});
