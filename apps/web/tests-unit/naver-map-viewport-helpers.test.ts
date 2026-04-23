import { describe, expect, test } from 'bun:test';

import { getNaverViewportOffset } from '../lib/naver-map-viewport-helpers';

describe('naver map viewport helpers', () => {
    test('returns zero offset on mobile', () => {
        expect(getNaverViewportOffset({
            internalPanelOpen: true,
            isGridMode: false,
            isMobileOrTablet: true,
            isPanelCollapsed: false,
            panelWidth: 400,
            propIsPanelOpen: true,
        })).toBe(0);
    });

    test('returns zero offset for shrinking internal layout', () => {
        expect(getNaverViewportOffset({
            internalPanelOpen: true,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            panelWidth: 400,
            propIsPanelOpen: true,
        })).toBe(0);
    });

    test('returns zero offset when panel is collapsed or closed', () => {
        expect(getNaverViewportOffset({
            internalPanelOpen: false,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: true,
            panelWidth: 400,
            propIsPanelOpen: true,
        })).toBe(0);

        expect(getNaverViewportOffset({
            externalPanelOpen: true,
            internalPanelOpen: false,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            panelWidth: 400,
            propIsPanelOpen: false,
        })).toBe(0);
    });

    test('returns panel width when external panel is open', () => {
        expect(getNaverViewportOffset({
            externalPanelOpen: false,
            internalPanelOpen: false,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            onMarkerClick: () => {},
            panelWidth: 400,
            propIsPanelOpen: false,
        })).toBe(400);
    });
});
