import { describe, expect, test } from 'bun:test';

import { getNaverOverlayPositioning } from '../lib/naver-map-overlay-position-helpers';

describe('naver map overlay position helpers', () => {
    test('uses zero offset on mobile even when panel is open', () => {
        const result = getNaverOverlayPositioning({
            isExternalPanelOpen: true,
            isGridMode: false,
            isMobileOrTablet: true,
            isPanelCollapsed: false,
            isPanelOpen: true,
            isShrinkingLayout: false,
            panelWidth: 400,
        });

        expect(result.centerOffsetStyle).toEqual({ left: 'calc(50% - 0px)' });
        expect(result.floatingBadgePositionClass).toContain('safe-area-inset-top');
        expect(result.floatingToastPositionClass).toContain('safe-area-inset-top');
    });

    test('uses zero offset when desktop panel is collapsed', () => {
        const result = getNaverOverlayPositioning({
            isExternalPanelOpen: true,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: true,
            isPanelOpen: true,
            isShrinkingLayout: false,
            panelWidth: 400,
        });

        expect(result.centerOffsetStyle).toEqual({ left: 'calc(50% - 0px)' });
        expect(result.floatingBadgePositionClass).toContain('top-4');
    });

    test('applies half panel offset on desktop when panel is open', () => {
        const result = getNaverOverlayPositioning({
            isExternalPanelOpen: false,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            isPanelOpen: true,
            isShrinkingLayout: false,
            panelWidth: 400,
        });

        expect(result.centerOffsetStyle).toEqual({ left: 'calc(50% - 200px)' });
        expect(result.floatingToastPositionClass).toContain('top-4');
    });

    test('keeps zero offset in grid mode', () => {
        const result = getNaverOverlayPositioning({
            isExternalPanelOpen: true,
            isGridMode: true,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            isPanelOpen: true,
            isShrinkingLayout: false,
            panelWidth: 400,
        });

        expect(result.centerOffsetStyle).toEqual({ left: 'calc(50% - 0px)' });
    });
});
