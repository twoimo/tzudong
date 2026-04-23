import { describe, expect, test } from 'bun:test';

import { buildMapViewPanelWidthObserver } from '../lib/map-view-panel-width-helpers';

describe('map view panel width helpers', () => {
    test('updates panel width for each observer entry', () => {
        const calls: number[] = [];
        const { observerCallback } = buildMapViewPanelWidthObserver({
            setPanelWidth: (width) => calls.push(width),
        });

        observerCallback([
            { contentRect: { width: 320 } },
            { contentRect: { width: 360 } },
        ]);

        expect(calls).toEqual([320, 360]);
    });
});
