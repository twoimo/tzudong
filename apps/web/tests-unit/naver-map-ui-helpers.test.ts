import { describe, expect, test } from 'bun:test';

import {
    resolveRestaurantDetailPanelElement,
    shouldResetNaverMapOnPathChange,
} from '../lib/naver-map-ui-helpers';

describe('naver map ui helpers', () => {
    test('resets map only when route changes back to home', () => {
        expect(shouldResetNaverMapOnPathChange('/feed', '/')).toBe(true);
        expect(shouldResetNaverMapOnPathChange('/', '/')).toBe(false);
        expect(shouldResetNaverMapOnPathChange('/feed', '/costs')).toBe(false);
    });

    test('resolves restaurant detail panel element by priority', () => {
        const calls: string[] = [];
        const root = {
            querySelector(selector: string) {
                calls.push(`query:${selector}`);
                if (selector === '[data-panel-type="restaurant-detail"]') return { id: 'data' };
                return null;
            },
            getElementById(id: string) {
                calls.push(`id:${id}`);
                return { id };
            },
        } as any;

        const panel = resolveRestaurantDetailPanelElement(root);
        expect(panel).toEqual({ id: 'data' });
        expect(calls[0]).toBe('query:[data-panel-type="restaurant-detail"]');
    });
});
