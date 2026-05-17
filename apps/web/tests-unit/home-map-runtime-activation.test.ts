import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    HOME_MAP_ACTIVATION_EVENTS,
    HOME_MAP_AUTO_ACTIVATION_DELAY_MS,
    buildHomeMapActivationPlan,
    shouldActivateHomeMapImmediately,
} from '../app/home-map-runtime-activation';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('home map runtime activation plan', () => {
    test('keeps ordinary home visits behind an interaction or idle gate', () => {
        const plan = buildHomeMapActivationPlan({ search: '' });

        expect(plan.activateImmediately).toBe(false);
        expect(plan.delayMs).toBe(HOME_MAP_AUTO_ACTIVATION_DELAY_MS);
        expect(plan.events).toEqual(HOME_MAP_ACTIVATION_EVENTS);
        expect(plan.events).toContain('pointerdown');
        expect(plan.events).toContain('keydown');
    });

    test('keeps restaurant detail links behind the map interaction gate while preserving direct overlays', () => {
        expect(shouldActivateHomeMapImmediately({ search: '?r=restaurant-1' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '?restaurant=restaurant-1' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '?panel=announcement' })).toBe(true);
        expect(shouldActivateHomeMapImmediately({ search: '', hash: '#map' })).toBe(true);
    });

    test('does not treat unrelated query params as immediate map work', () => {
        expect(shouldActivateHomeMapImmediately({ search: '?utm_source=test' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '', hash: '#intro' })).toBe(false);
    });

    test('wires the activation plan into the Naver map runtime loader', () => {
        const naverMapSource = source('components/map/NaverMapView.tsx');

        expect(naverMapSource).toContain('buildHomeMapActivationPlan');
        expect(naverMapSource).toContain('window.location.search');
        expect(naverMapSource).toContain('window.location.hash');
        expect(naverMapSource).toContain('activationPlan.events.forEach');
        expect(naverMapSource).toContain('window.setTimeout(activateMapRuntime, activationPlan.delayMs)');
        expect(naverMapSource).not.toContain('{ timeout: 2000 }');
        expect(naverMapSource).not.toContain('requestIdleCallback(() =>');
    });
});
