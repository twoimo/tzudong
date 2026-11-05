import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { removeNaverMapListener } from '../lib/naver-map-event-cleanup';
import { scheduleNaverInitialIdleTrigger } from '../lib/naver-map-init-helpers';

const text = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('NaverMapView.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: string[] = [];
function collect(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
        const callback = node.arguments[0];
        if (callback) effects.push(callback.getText(source));
    }
    ts.forEachChild(node, collect);
}
collect(source);

function executeEffect(body: string, bindings: Record<string, unknown>): (() => void) | undefined {
    expect(body).not.toBe('');
    const js = ts.transpileModule(`const effect = ${body};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return new Function(...Object.keys(bindings), `${js}; return effect();`)(...Object.values(bindings));
}

function cameraFixture(options: { mapsAbsent?: boolean; registrationThrows?: boolean; removalThrows?: boolean } = {}) {
    const writes: unknown[] = [];
    const removals: unknown[] = [];
    let retained: (() => void) | undefined;
    const handle = {};
    const events = {
        addListener(_map: unknown, _event: string, callback: () => void) {
            expect(this).toBe(events);
            retained = callback;
            if (options.registrationThrows) throw new Error('synthetic provider failure');
            return handle;
        },
        removeListener(listener: unknown) {
            expect(this).toBe(events);
            removals.push(listener);
            if (options.removalThrows) throw new Error('synthetic provider failure');
        },
    };
    const window = { naver: { maps: options.mapsAbsent ? undefined : { Event: events } } };
    const bindings = {
        window, isMapInitialized: true, isMapViewerLoading: false,
        mapInstanceRef: { current: { getCenter: () => ({ lat: () => 37.5, lng: () => 127 }), getZoom: () => 12 } },
        routeQueryClient: {}, mapReturnOwner: 'synthetic-owner',
        writeHomeRouteMemory: (...args: unknown[]) => writes.push(args), removeNaverMapListener,
    };
    const run = () => executeEffect(effects.find(effect => effect.includes('writeHomeRouteMemory(')) ?? '', bindings);
    return { run, window, writes, removals, handle, fire: () => retained?.() };
}

function initialIdleFixture() {
    const timers: Array<() => void> = [];
    const cleared: unknown[] = [];
    const errors: unknown[] = [];
    const idleTargets: unknown[] = [];
    const initialized: boolean[] = [];
    const map = { getBounds: () => ({}), getCenter: () => ({}) };
    const events = {
        trigger(target: unknown) { expect(this).toBe(events); idleTargets.push(target); },
    };
    const maps = { Event: events, Map: class { constructor() { return map; } }, LatLng: class {}, Position: { TOP_LEFT: 0, TOP_RIGHT: 1 } };
    const window = { naver: { maps: maps as typeof maps | undefined }, location: { search: '' } };
    const bindings = {
        window, isLoaded: true, isMapViewerLoading: false,
        mapRef: { current: {} }, mapInstanceRef: { current: null as typeof map | null },
        initialIdleWorkRef: { current: null as { map: unknown; cancel: () => void } | null },
        isNaverMapInstanceReusable: () => false,
        resolveNaverStaleMapCleanupPlan: () => ({ shouldCleanup: false }),
        markerPool: { clear() {} }, clusterAnimationManager: { clear() {} },
        markerRenderSignatureRef: { current: null }, setIsMapInitialized: (value: boolean) => initialized.push(value),
        setMapInitError: (value: unknown) => errors.push(value),
        resolveNaverInitialMapView: () => ({ hasValidUrlState: false, initialCenter: [37.5, 127], initialZoom: 12 }),
        getDeviceAdjustedZoom: (value: number) => value, selectedRegion: null,
        readHomeRouteMemory: () => null, routeQueryClient: {}, mapReturnOwner: 'synthetic-owner',
        buildNaverMapOptions: (value: unknown) => value,
        prevSelectedRestaurantIdRef: { current: null }, hasUserMovedMapRef: { current: false },
        resolveNaverPostInitPlan: () => ({ shouldExposeDebugMap: false, shouldMarkInitialLoadFromUrl: false }),
        isInitialLoadFromUrlRef: { current: false }, showMapToast() {},
        scheduleNaverInitialIdleTrigger: (args: Parameters<typeof scheduleNaverInitialIdleTrigger>[0]) =>
            scheduleNaverInitialIdleTrigger({ ...args, setTimeoutFn: ((callback: () => void, delay: number) => {
                expect(delay).toBe(100);
                timers.push(callback);
                return timers.length;
            }) as unknown as typeof setTimeout }),
        clearTimeout: (timer: unknown) => cleared.push(timer),
    };
    const run = () => executeEffect(effects.find(effect => effect.includes('scheduleNaverInitialIdleTrigger(')) ?? '', bindings);
    const unmount = () => {
        const body = effects.find(effect => effect.includes('initialIdleWorkRef.current?.cancel()') && !effect.includes('scheduleNaverInitialIdleTrigger('));
        if (body) executeEffect(body, bindings)?.();
    };
    return { run, unmount, bindings, maps, window, timers, cleared, errors, idleTargets, initialized, map };
}

describe('actual camera-memory effect Event ownership', () => {
    test('missing maps at registration does not escape to the app boundary', () => {
        const fixture = cameraFixture({ mapsAbsent: true });
        expect(fixture.run).not.toThrow();
        expect(fixture.writes).toEqual([]);
    });
    test('cleanup uses the original Event receiver after namespace revocation', () => {
        const fixture = cameraFixture();
        const cleanup = fixture.run();
        fixture.fire();
        fixture.window.naver.maps = undefined;
        expect(cleanup).toBeFunction();
        expect(cleanup!).not.toThrow();
        expect(fixture.removals).toEqual([fixture.handle]);
        expect(fixture.writes).toHaveLength(2);
        fixture.fire();
        expect(fixture.writes).toHaveLength(2);
    });
    test('a provider which retains a callback before throwing cannot keep capture authority', () => {
        const fixture = cameraFixture({ registrationThrows: true });
        expect(fixture.run).not.toThrow();
        fixture.fire();
        expect(fixture.writes).toEqual([]);
    });
    test('failed listener removal still deactivates later callbacks', () => {
        const fixture = cameraFixture({ removalThrows: true });
        const cleanup = fixture.run();
        cleanup?.();
        expect(fixture.writes).toHaveLength(1);
        fixture.fire();
        expect(fixture.writes).toHaveLength(1);
    });
});

describe('actual initial-idle work ownership', () => {
    test('normal live map receives exactly one initial idle', () => {
        const fixture = initialIdleFixture(); fixture.run(); fixture.timers[0]();
        expect(fixture.idleTargets).toEqual([fixture.map]);
        expect(fixture.errors.filter(Boolean)).toEqual([]);
    });
    test('SDK revocation before dispatch produces a fixed local failure', () => {
        const fixture = initialIdleFixture(); fixture.run(); fixture.window.naver.maps = undefined;
        expect(fixture.timers[0]).not.toThrow();
        expect(fixture.idleTargets).toEqual([]);
        expect(fixture.errors.filter(Boolean)).toEqual(['네이버 지도를 초기화하지 못했습니다.']);
    });
    test('a replaced map receives neither the old event nor its failure state', () => {
        const fixture = initialIdleFixture(); fixture.run(); fixture.bindings.mapInstanceRef.current = { ...fixture.map };
        fixture.timers[0]();
        expect(fixture.idleTargets).toEqual([]);
        expect(fixture.errors.filter(Boolean)).toEqual([]);
    });
    test('unmount cancels timer and invalidates a callback retained by the scheduler', () => {
        const fixture = initialIdleFixture(); fixture.run(); fixture.unmount(); fixture.timers[0]();
        expect(fixture.cleared).toEqual([1]);
        expect(fixture.idleTargets).toEqual([]);
        expect(fixture.errors.filter(Boolean)).toEqual([]);
    });
    test('provider trigger exceptions stay in the fixed map failure state', () => {
        const fixture = initialIdleFixture(); fixture.maps.Event.trigger = () => { throw new Error('synthetic private diagnostic'); };
        fixture.run();
        expect(fixture.timers[0]).not.toThrow();
        expect(fixture.errors.filter(Boolean)).toEqual(['네이버 지도를 초기화하지 못했습니다.']);
    });
    test('failed provider cleanup cannot interrupt the local failure state', () => {
        const fixture = initialIdleFixture();
        fixture.bindings.markerPool.clear = () => { throw new Error('synthetic teardown failure'); };
        fixture.bindings.clusterAnimationManager.clear = () => { throw new Error('synthetic teardown failure'); };
        fixture.run(); fixture.window.naver.maps = undefined;
        expect(fixture.timers[0]).not.toThrow();
        expect(fixture.bindings.mapInstanceRef.current).toBeNull();
        expect(fixture.errors.filter(Boolean)).toEqual(['네이버 지도를 초기화하지 못했습니다.']);
    });
    test('a provider which replaces the map before throwing cannot fail its successor', () => {
        const fixture = initialIdleFixture();
        const successor = { ...fixture.map };
        fixture.maps.Event.trigger = () => {
            fixture.bindings.mapInstanceRef.current = successor;
            throw new Error('synthetic provider failure');
        };
        fixture.run();
        expect(fixture.timers[0]).not.toThrow();
        expect(fixture.bindings.mapInstanceRef.current).toBe(successor);
        expect(fixture.errors.filter(Boolean)).toEqual([]);
    });
    test('initial constructor failures do not expose provider diagnostics', () => {
        const fixture = initialIdleFixture();
        fixture.maps.Map = class { constructor() { throw new Error('synthetic private diagnostic'); } };
        expect(fixture.run).not.toThrow();
        expect(fixture.errors.filter(Boolean)).toEqual(['네이버 지도를 초기화하지 못했습니다.']);
        expect(fixture.timers).toEqual([]);
    });
    test('reusing the live map preserves the pending timer, while remount restores canceled work', () => {
        const fixture = initialIdleFixture(); fixture.run();
        fixture.bindings.isNaverMapInstanceReusable = () => true;
        fixture.run();
        expect(fixture.timers).toHaveLength(1);
        fixture.unmount(); fixture.run();
        expect(fixture.timers).toHaveLength(2);
        fixture.timers[0](); fixture.timers[1]();
        expect(fixture.idleTargets).toEqual([fixture.map]);
    });
});
