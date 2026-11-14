import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { buildInitialLoadDiagnosticScript, isInitialLoadDiagnosticRequest } from '../lib/performance/initial-load-diagnostic';
import { shouldCollectFieldVitals } from '../lib/performance/field-vitals';

// Execute the actual serialized inline script against browser-shaped APIs. No
// application network, storage, credentials, real clock waits or DOM text needed.
function browser({ search = '?__perf=initial-load', pathname = '/', supported = ['paint', 'largest-contentful-paint', 'resource', 'longtask'],
    navigation = true, release = 'a'.repeat(40), observerApi = true } = {}) {
    let now = 100;
    const order: string[] = [];
    class Target {
        listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
        addEventListener(name: string, callback: (event: Record<string, unknown>) => void) {
            if (!this.listeners.has(name)) this.listeners.set(name, new Set());
            this.listeners.get(name)!.add(callback);
        }
        removeEventListener(name: string, callback: (event: Record<string, unknown>) => void) { this.listeners.get(name)?.delete(callback); }
        send(name: string, event: Record<string, unknown> = {}) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
    }
    class Element extends Target {
        tagName: string;
        id = '';
        nonce = '';
        textContent = '';
        dataset: Record<string, string> = {};
        children: Element[] = [];
        matches = new Map<string, Element[]>();
        rect = { width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 };
        constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
        setAttribute() { /* Only fixed accessibility strings are written. */ }
        append(...children: Element[]) {
            this.children.push(...children);
            if (children.some((child) => child.id === 'initial-load-diagnostic-panel')) order.push('panel');
        }
        remove() { /* Closing is unrelated to captured values. */ }
        getBoundingClientRect() { return this.rect; }
        querySelector(selector: string) { return this.matches.get(selector)?.[0] ?? null; }
        querySelectorAll(selector: string) { return this.matches.get(selector) ?? []; }
    }
    class Image extends Element {
        complete = true;
        naturalWidth = 256;
        currentSrc = 'https://maps.pstatic.net/tile?private=never-retain';
        src = this.currentSrc;
        constructor() { super('img'); this.rect = { width: 256, height: 256, top: 0, left: 0, right: 256, bottom: 256 }; }
    }
    const document = Object.assign(new Target(), {
        visibilityState: 'visible', currentScript: { nonce: 'test-nonce-never-output' },
        documentElement: new Element('html'), body: new Element('body'),
        matches: new Map<string, Element[]>(),
        createElement: (tag: string) => new Element(tag),
        querySelector(selector: string) { return this.matches.get(selector)?.[0] ?? null; },
        querySelectorAll(selector: string) { return this.matches.get(selector) ?? []; },
    });
    const nav = { entryType: 'navigation', name: 'https://www.tzudong.app/?private=never-retain',
        type: 'navigate', startTime: 0, redirectCount: 0, activationStart: 0, workerStart: 0,
        domainLookupStart: 0, domainLookupEnd: 4, connectStart: 4, connectEnd: 20, secureConnectionStart: 7,
        requestStart: 30, responseStart: 80, responseEnd: 110, domInteractive: 200,
        domContentLoadedEventEnd: 230, loadEventEnd: 900, transferSize: 5000, encodedBodySize: 4700, decodedBodySize: 19000 };
    const resources: Record<string, unknown>[] = [];
    const performance = Object.assign(new Target(), {
        now: () => now,
        getEntriesByType: (type: string) => type === 'navigation' && navigation ? [nav] : [],
        getEntriesByName: (name: string) => resources.filter((entry) => entry.name === name),
    });
    const observerInstances: Observer[] = [];
    class Observer {
        static supportedEntryTypes = supported;
        type = '';
        disconnected = false;
        pending: Record<string, unknown>[] = [];
        callback: (list: { getEntries: () => Record<string, unknown>[] }) => void;
        constructor(callback: (list: { getEntries: () => Record<string, unknown>[] }) => void) { this.callback = callback; observerInstances.push(this); }
        observe({ type, buffered }: { type: string; buffered: boolean }) { this.type = type; expect(buffered).toBe(true); }
        takeRecords() { order.push('drain'); const pending = this.pending; this.pending = []; return pending; }
        disconnect() { this.disconnected = true; order.push('disconnect'); }
    }
    const timers: Array<{ callback: () => void; delay: number; interval: boolean; cleared: boolean }> = [];
    const runtime = Object.assign(new Target(), {
        document, performance, location: new URL(`https://www.tzudong.app${pathname}${search}`),
        URL, URLSearchParams, PerformanceObserver: observerApi ? Observer : undefined,
        HTMLImageElement: Image, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        setInterval(callback: () => void, delay: number) { timers.push({ callback, delay, interval: true, cleared: false }); return timers.length; },
        clearInterval(id: number) { timers[id - 1].cleared = true; order.push('interval-clear'); },
        setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay, interval: false, cleared: false }); return timers.length; },
        window: undefined as unknown,
        __tzudongInitialLoadDiagnostic: undefined as { mark: (phase: string, count?: number) => void } | undefined,
    });
    runtime.window = runtime;
    runInNewContext(buildInitialLoadDiagnosticScript(release), runtime);
    const find = (element: Element, id: string): Element | undefined => element.id === id ? element
        : element.children.map((child) => find(child, id)).find(Boolean);
    return {
        runtime, document, performance, nav, resources, timers, order, observerInstances, Element, Image,
        setTime(value: number) { now = value; },
        mark(phase: string, value?: number) { runtime.__tzudongInitialLoadDiagnostic?.mark(phase, value); },
        emit(type: string, entries: Record<string, unknown>[], pending = false) {
            for (const entry of entries) if (type === 'resource') resources.push(entry);
            const observer = observerInstances.find((item) => item.type === type)!;
            if (pending) observer.pending.push(...entries);
            else observer.callback({ getEntries: () => entries });
        },
        inspect(at: number) { now = at; timers.find((timer) => timer.interval && !timer.cleared)?.callback(); },
        freeze(at = 20000) { now = at; timers.find((timer) => !timer.interval)!.callback(); },
        result() { const pre = find(document.body, 'initial-load-diagnostic-result'); return pre ? JSON.parse(pre.textContent) : null; },
        panel() { return find(document.body, 'initial-load-diagnostic-panel'); },
    };
}

const resource = (overrides: Record<string, unknown> = {}) => ({ entryType: 'resource', name: 'https://www.tzudong.app/_next/static/font.woff2',
    initiatorType: 'css', startTime: 150, duration: 80, requestStart: 160, responseStart: 180, responseEnd: 230,
    transferSize: 1200, encodedBodySize: 900, decodedBodySize: 1000, ...overrides });

describe('opt-in production initial-load diagnostic', () => {
    test('requires exactly the explicit home query and preserves field-RUM exclusion', () => {
        expect(isInitialLoadDiagnosticRequest({ __perf: 'initial-load' })).toBe(true);
        for (const params of [{}, { __perf: '1' }, { __perf: ['initial-load', 'initial-load'] }, { __perf: 'initial-load', q: 'private' }]) {
            expect(isInitialLoadDiagnosticRequest(params)).toBe(false);
        }
        for (const options of [{ search: '' }, { search: '?__perf=initial-load&q=private' }, { pathname: '/feed' }]) {
            const page = browser(options);
            expect(page.timers).toHaveLength(0);
            expect(page.observerInstances).toHaveLength(0);
            expect(page.runtime.__tzudongInitialLoadDiagnostic).toBeUndefined();
        }
        expect(shouldCollectFieldVitals({ production: true, hostname: 'www.tzudong.app', pathname: '/',
            search: '?__perf=initial-load', webdriver: false })).toBe(false);
    });

    test('serialized code is self-contained, drains and disconnects before any diagnostic DOM', () => {
        const page = browser();
        expect(page.timers.find((timer) => !timer.interval)?.delay).toBe(19900);
        page.setTime(1000);
        page.emit('paint', [{ entryType: 'paint', name: 'first-contentful-paint', startTime: 800 }], true);
        page.inspect(19999);
        expect(page.panel()).toBeUndefined();
        page.freeze(20007);
        const result = page.result();
        expect(result.paints.fcpMs).toBe(800);
        expect(result.capture.frozenAtMs).toBe(20007);
        expect(page.observerInstances.every((observer) => observer.disconnected)).toBe(true);
        expect(page.order.at(-1)).toBe('panel');
        expect(page.order.filter((value) => value === 'drain')).toHaveLength(4);
        expect(page.order.filter((value) => value === 'disconnect')).toHaveLength(4);
        page.mark('dataReady', 100);
        expect(page.result()).toEqual(result);
        expect(page.panel()!.children[0].nonce).toBe('test-nonce-never-output');
    });

    test('retains classifications and numeric LCP subparts without URL, text, element ID or nonce', () => {
        const page = browser();
        const privateUrl = 'https://project.supabase.co/rest/v1/restaurants?token=PRIVATE_TOKEN&name=PRIVATE_NAME';
        const imageUrl = 'https://maps.pstatic.net/tile?token=PRIVATE_TOKEN';
        page.emit('resource', [resource({ name: privateUrl }), resource({ name: imageUrl, initiatorType: 'img' })]);
        page.setTime(450);
        page.emit('largest-contentful-paint', [{ entryType: 'largest-contentful-paint', startTime: 400, renderTime: 400, loadTime: 230,
            size: 10000, url: imageUrl, element: { tagName: 'IMG', id: 'PRIVATE_ID', textContent: 'PRIVATE_TEXT' } }]);
        page.freeze();
        const result = page.result();
        const lcp = result.paints.windowLcp;
        expect(lcp.resourceCategory).toBe('naver-image');
        expect(lcp.resourceRequestStartMs).toBe(160);
        expect(lcp.ttfbMs + lcp.resourceLoadDelayMs + lcp.resourceLoadDurationMs + lcp.elementRenderDelayMs).toBe(400);
        expect(result.resources.byCategory.map((entry: { category: string }) => entry.category)).toContain('supabase-restaurants');
        const serialized = JSON.stringify(result);
        for (const forbidden of ['PRIVATE_', 'test-nonce', 'project.supabase', '/rest/v1/', '?token=', 'tile?', 'never-retain']) expect(serialized).not.toContain(forbidden);
    });

    test('cross-origin missing timing remains unknown; no fictitious cache hit or LCP subparts', () => {
        const page = browser();
        const url = 'https://maps.pstatic.net/tile';
        page.emit('resource', [resource({ name: url, initiatorType: 'img', requestStart: 0, responseStart: 0, transferSize: 0,
            encodedBodySize: 0, decodedBodySize: 0 })]);
        page.emit('largest-contentful-paint', [{ entryType: 'largest-contentful-paint', startTime: 400, url, element: { tagName: 'IMG' } }]);
        page.freeze();
        const result = page.result();
        expect(result.resources.byCategory[0].unknownTimingCount).toBe(1);
        expect(result.resources.byCategory[0].zeroTransferKnownCount).toBe(0);
        expect(result.paints.windowLcp.timingDetailAvailable).toBe(false);
        expect(result.paints.windowLcp.resourceRequestStartMs).toBeNull();
        expect(result.paints.windowLcp.resourceLoadDurationMs).toBeNull();
    });

    test('excludes entries and readiness after the cutoff and accounts for crossing long tasks', () => {
        const page = browser();
        page.emit('longtask', [
            { entryType: 'longtask', startTime: 1000, duration: 100 },
            { entryType: 'longtask', startTime: 19990, duration: 120 },
            { entryType: 'longtask', startTime: 21000, duration: 500 },
        ], true);
        page.emit('resource', [resource(), resource({ responseEnd: 20100, duration: 19950 })], true);
        page.setTime(19900);
        page.mark('dataQueryStarted');
        page.setTime(20100);
        page.mark('dataReady', 50);
        page.inspect(20100);
        page.freeze(20200);
        const result = page.result();
        expect(result.longTasks.count).toBe(1);
        expect(result.longTasks.longTaskBlockingSumMs).toBe(50);
        expect(result.longTasks.crossingCutoffCount).toBe(1);
        expect(result.resources.byCategory[0].count).toBe(1);
        expect(result.milestones.dataReady).toBeNull();
        expect(result.completeness.observedAtMs).toBeNull();
        expect(result.legacyTtiMs).toBeNull();
    });

    test('records validity events and fixed error phases; rejects unknown phases and invalid counts', () => {
        const page = browser();
        page.setTime(1200);
        page.runtime.send('pointerdown', { isTrusted: false });
        page.runtime.send('keydown', { isTrusted: true, key: 'PRIVATE_INPUT' });
        page.document.visibilityState = 'hidden';
        page.document.send('visibilitychange');
        page.runtime.innerWidth = 820;
        page.runtime.send('resize');
        page.mark('__proto__', 123);
        page.mark('PRIVATE_PHASE', 456);
        page.mark('dataReady', NaN);
        page.mark('dataError');
        page.setTime(1500);
        page.mark('dataReady', 30);
        page.freeze();
        const result = page.result();
        expect(result.capture.trustedInputCount).toBe(1);
        expect(result.capture.firstTrustedInputAtMs).toBe(1200);
        expect(result.capture.firstHiddenAtMs).toBe(1200);
        expect(result.capture.resizeCount).toBe(1);
        expect(result.viewport.final.width).toBe(820);
        expect(result.milestones.dataReady).toBe(1200);
        expect(result.milestoneCounts.restaurantCount).toBeNull();
        expect(result.completeness.dataReady).toBe(false);
        expect(result.completeness.diagnosticErrors).toEqual(['HOME_DATA_ERROR']);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    });

    test('bounds resource and long-task capture and marks truncation instead of claiming completeness', () => {
        const page = browser();
        page.emit('resource', Array.from({ length: 2001 }, () => resource()));
        page.emit('longtask', Array.from({ length: 251 }, (_, index) => ({ entryType: 'longtask', startTime: index * 60, duration: 51 })));
        page.performance.send('resourcetimingbufferfull');
        page.freeze();
        const result = page.result();
        expect(result.resources.byCategory[0].count).toBe(2000);
        expect(result.longTasks.completedEntries).toHaveLength(250);
        expect(result.capture.entryCapReached).toBe(true);
        expect(result.resources.overflow).toBe(true);
    });

    test('does not equate SDK/constructor or mounted controls with a visually ready map', () => {
        const page = browser();
        page.document.documentElement.dataset.homeMobileChromeReady = 'true';
        page.mark('naverSdkReady');
        page.mark('mapConstructed');
        page.inspect(1000);
        page.freeze();
        expect(page.result().completeness.mapConstructed).toBe(true);
        expect(page.result().completeness.mapVisible).toBe(false);
        expect(page.result().completeness.controlsReady).toBe(false);

        const ready = browser();
        const map = new ready.Element('div');
        map.matches.set('img', [new ready.Image()]);
        ready.document.matches.set('[data-testid="map-container"]', [map]);
        ready.document.matches.set('button.cluster-marker-container, button.tzudong-individual-marker[data-testid="marker"]', [new ready.Element('button')]);
        ready.document.documentElement.dataset.homeMobileChromeReady = 'true';
        for (const selector of ['button[aria-label="맛집 검색 열기"]', '[data-mobile-map-sheet-trigger="region"]', '[data-mobile-map-sheet-trigger="category"]']) {
            ready.document.matches.set(selector, [new ready.Element('button')]);
        }
        ready.inspect(1500);
        ready.freeze();
        expect(ready.result().milestones.mapVisible).toBe(1500);
        expect(ready.result().milestones.controlsReady).toBe(1500);
        expect(ready.result().completeness.visibleTileCount).toBe(1);
    });

    test('unsupported APIs and invalid source binding remain null, not plausible zero measurements', () => {
        const page = browser({ observerApi: false, navigation: false, release: '</script>PRIVATE_VALUE' });
        page.freeze();
        const result = page.result();
        expect(result.support.longTask).toBe(false);
        expect(result.longTasks).toBeNull();
        expect(result.resources.byCategory).toBeNull();
        expect(result.navigation).toBeNull();
        expect(result.paints.fcpMs).toBeNull();
        expect(result.binding.gitSha).toBeNull();
        expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
    });

    test('records a changed route or removed diagnostic query without disclosing that route', () => {
        for (const location of ['https://www.tzudong.app/feed?private=PRIVATE_VALUE', 'https://www.tzudong.app/']) {
            const page = browser();
            page.runtime.location = new URL(location);
            page.freeze();
            expect(page.result().capture.contextUnchanged).toBe(false);
            expect(JSON.stringify(page.result())).not.toContain('/feed');
            expect(JSON.stringify(page.result())).not.toContain('PRIVATE_VALUE');
        }
    });
});
