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

        expect(result.centerOffsetStyle).toEqual({});
        expect(result.floatingBadgePositionClass).toContain('safe-area-inset-top');
        expect(result.floatingBadgePositionClass).toContain('top-[calc(env(safe-area-inset-top)_+_114px)]');
        expect(result.floatingBadgePositionClass).toContain('z-[70]');
        expect(result.floatingBadgePositionClass).toContain('mobile-map-status-badge');
        expect(result.floatingToastPositionClass).toContain('right-3');
        expect(result.floatingToastPositionClass).toContain('bottom-[calc(var(--mobile-bottom-nav-effective-height');
        expect(result.floatingToastPositionClass).toContain('_+_env(safe-area-inset-bottom)_+_0.75rem');
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

        expect(result.centerOffsetStyle).toEqual({});
        expect(result.floatingBadgePositionClass).toContain('left-1/2');
        expect(result.floatingBadgePositionClass).toContain('top-[4.75rem]');
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

        expect(result.centerOffsetStyle).toEqual({});
        expect(result.floatingBadgePositionClass).toContain('left-1/2');
        expect(result.floatingToastPositionClass).toContain('top-[4.75rem]');
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

        expect(result.centerOffsetStyle).toEqual({});
    });
});
