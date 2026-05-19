import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    HOME_MAP_ACTIVATION_EVENTS,
    HOME_MAP_AUTO_ACTIVATION_DELAY_MS,
    buildHomeMapActivationPlan,
    isEmbeddedHomeRuntimeWindow,
    shouldActivateHomeMapImmediately,
} from '../app/home-map-runtime-activation';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('home map runtime activation plan', () => {
    test('activates ordinary home visits immediately so the Naver map is the first runtime surface', () => {
        const plan = buildHomeMapActivationPlan({ search: '' });

        expect(plan.activateImmediately).toBe(true);
        expect(plan.delayMs).toBe(HOME_MAP_AUTO_ACTIVATION_DELAY_MS);
        expect(plan.delayMs).toBe(0);
        expect(plan.events).toEqual([]);
        expect(HOME_MAP_ACTIVATION_EVENTS).toContain('pointerdown');
        expect(HOME_MAP_ACTIVATION_EVENTS).toContain('keydown');
    });

    test('keeps deep-link detection available while the runtime itself is no longer gated', () => {
        expect(shouldActivateHomeMapImmediately({ search: '?r=restaurant-1' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '?restaurant=restaurant-1' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '?panel=announcement' })).toBe(true);
        expect(shouldActivateHomeMapImmediately({ search: '', hash: '#map' })).toBe(true);
        expect(buildHomeMapActivationPlan({ search: '?r=restaurant-1' }).activateImmediately).toBe(true);
    });

    test('activates immediately inside the embedded home frame after the outer gate already ran', () => {
        const plan = buildHomeMapActivationPlan({ search: '', isEmbeddedHomeRuntime: true });

        expect(plan.activateImmediately).toBe(true);
        expect(isEmbeddedHomeRuntimeWindow).toBeTypeOf('function');
    });

    test('does not treat unrelated query params as immediate map work', () => {
        expect(shouldActivateHomeMapImmediately({ search: '?utm_source=test' })).toBe(false);
        expect(shouldActivateHomeMapImmediately({ search: '', hash: '#intro' })).toBe(false);
    });

    test('wires the activation plan into the Naver map runtime loader', () => {
        const naverMapSource = source('components/map/NaverMapView.tsx');

        expect(naverMapSource).toContain('buildHomeMapActivationPlan');
        expect(naverMapSource).toContain('isEmbeddedHomeRuntimeWindow');
        expect(naverMapSource).toContain('window.location.search');
        expect(naverMapSource).toContain('window.location.hash');
        expect(naverMapSource).toContain('isEmbeddedHomeRuntime: isEmbeddedHomeRuntimeWindow()');
        expect(naverMapSource).toContain('activationPlan.activateImmediately');
        expect(naverMapSource).not.toContain('window.setTimeout(activateMapRuntime, activationPlan.delayMs)');
        expect(naverMapSource).not.toContain('activationPlan.events.forEach');
        expect(naverMapSource).toContain("strategy: 'afterInteractive'");
        expect(naverMapSource).not.toContain("strategy: 'lazyOnload'");
        expect(naverMapSource).not.toContain('{ timeout: 2000 }');
        expect(naverMapSource).not.toContain('requestIdleCallback(() =>');
    });
});
