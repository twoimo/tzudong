import { describe, expect, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OverseasMapStatusOverlay } from '../components/map/overseas-map-status-overlay';

type Props = ComponentProps<typeof OverseasMapStatusOverlay>;
const baseProps: Props = {
    activeThemeId: 'hot-view',
    isMapLoaded: true,
    viewportMode: 'desktop',
    resultStatus: 'ready',
    restaurantCount: 3,
};

function renderOverlay(overrides: Partial<Props> = {}) {
    return renderToStaticMarkup(<OverseasMapStatusOverlay {...baseProps} {...overrides} />);
}

describe('overseas map status slot', () => {
    test('leaves provider loading and failure screens as the only map status until load succeeds', () => {
        for (const resultStatus of ['pending', 'error', 'select-country', 'ready'] as const) {
            expect(renderOverlay({ isMapLoaded: false, resultStatus })).toBe('');
        }
        expect(renderOverlay({ viewportMode: 'pending' })).toBe('');
    });

    test('pending results replace selected criteria and never claim a known empty result', () => {
        for (const restaurantCount of [0, 3]) {
            const html = renderOverlay({ resultStatus: 'pending', restaurantCount });
            expect(html).toContain('data-map-overlay-kind="loading"');
            expect(html).toContain('aria-busy="true"');
            expect(html).toContain('role="status"');
            expect(html).not.toContain('data-map-overlay-kind="empty"');
            expect(html).not.toContain('<button');
            expect(html.match(/data-overseas-map-status-slot=/g)).toHaveLength(1);
        }
    });

    test('failed results remain an alert even when an old row count and theme are present', () => {
        const html = renderOverlay({ resultStatus: 'error' });
        expect(html).toContain('data-map-overlay-kind="error"');
        expect(html).toContain('role="alert"');
        expect(html).toContain('aria-live="assertive"');
        expect(html).not.toContain('aria-busy="true"');
        expect(html).not.toContain('<button');
        expect(html.match(/data-overseas-map-status-slot=/g)).toHaveLength(1);
    });

    test('country selection and a confirmed empty result take priority over criteria', () => {
        const selection = renderOverlay({ resultStatus: 'select-country', restaurantCount: 0 });
        expect(selection).toContain('data-map-overlay-kind="select-country"');
        expect(selection).not.toContain('data-map-overlay-kind="empty"');
        expect(selection).not.toContain('<button');

        const empty = renderOverlay({ restaurantCount: 0 });
        expect(empty).toContain('data-map-overlay-kind="empty"');
        expect(empty).toContain('role="status"');
        expect(empty).not.toContain('<button');
        expect(empty.match(/data-overseas-map-status-slot=/g)).toHaveLength(1);
    });

    test('ready results expose one real Radix criteria trigger and no duplicate status', () => {
        const html = renderOverlay();
        expect(html).toContain('data-map-overlay-kind="theme"');
        expect(html.match(/<button\b/g)).toHaveLength(1);
        expect(html).toContain('aria-haspopup="dialog"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('data-state="closed"');
        expect(html).toContain('pointer-events-auto');
        expect(html.match(/data-overseas-map-status-slot=/g)).toHaveLength(1);
        expect(renderOverlay({ activeThemeId: null })).toBe('');
    });

    test('uses the measured mobile control boundary and preserves the desktop status position', () => {
        const mobile = renderOverlay({ viewportMode: 'mobileOrTablet' });
        expect(mobile).toContain('mobile-map-status-badge');
        expect(mobile).toContain('fixed');
        expect(mobile).toContain('--mobile-map-controls-bottom');
        expect(mobile).toContain('safe-area-inset-top');
        expect(mobile).not.toContain('top-28');

        const desktop = renderOverlay();
        expect(desktop).toContain('absolute inset-x-3 top-28');
        expect(desktop).not.toContain('mobile-map-status-badge');
        expect(desktop).not.toContain('--mobile-map-controls-bottom');
    });
});
