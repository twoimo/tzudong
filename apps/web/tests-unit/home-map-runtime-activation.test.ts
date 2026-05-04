import { describe, expect, test } from 'bun:test';

import {
    HOME_MAP_ACTIVATION_EVENTS,
    HOME_MAP_AUTO_ACTIVATION_DELAY_MS,
    buildHomeMapActivationPlan,
    shouldActivateHomeMapImmediately,
} from '../app/home-map-runtime-activation';

describe('home map runtime activation plan', () => {
    test('keeps ordinary home visits behind an interaction or idle gate', () => {
        const plan = buildHomeMapActivationPlan({ search: '' });

        expect(plan.activateImmediately).toBe(false);
        expect(plan.delayMs).toBe(HOME_MAP_AUTO_ACTIVATION_DELAY_MS);
        expect(plan.events).toEqual(HOME_MAP_ACTIVATION_EVENTS);
        expect(plan.events).toContain('pointerdown');
        expect(plan.events).toContain('keydown');
    });

    test('activates immediately for deep links and overlay panel routes', () => {
        expect(shouldActivateHomeMapImmediately({ search: '?r=restaurant-1' })).toBe(true);
        expect(shouldActivateHomeMapImmediately({ search: '?restaurant=restaurant-1' })).toBe(true);
        expect(shouldActivateHomeMapImmediately({ search: '?panel=announcement' })).toBe(true);
        expect(shouldActivateHomeMapImmediately({ search: '', hash: '#map' })).toBe(true);
    });

    test('does not treat unrelated query params as immediate map work', () => {
        expect(shouldActivateHomeMapImmediately({ search: '?utm_source=test' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '', hash: '#intro' })).toBe(false);
    });
});
