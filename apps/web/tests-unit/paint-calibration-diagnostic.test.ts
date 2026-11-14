import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildPaintCalibrationDiagnosticScript } from '../lib/performance/paint-calibration-diagnostic';
import { isPaintCalibrationRequest } from '../lib/performance/paint-calibration-request';
import { shouldCollectFieldVitals } from '../lib/performance/field-vitals';

type Entry = Record<string, unknown> & { entryType: string; startTime: number; name?: string; duration?: number };
type Timer = { callback: () => void; delay: number; interval: boolean; cleared: boolean; fired: boolean };

function browser(options: { search?: string; pathname?: string; supported?: string[]; registerFailure?: string; focus?: boolean; release?: string } = {}) {
    let now = 100;
    let focus = options.focus ?? true;
    let frameId = 0;
    let drainFailure = false;
    let resourceReadFailure = false;
    let frameRequestFailure = false;
    let callbackReadFailure = false;
    const timers: Timer[] = [];
    const frames = new Map<number, (timestamp: number) => void>();
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
        tagName: string; id = ''; nonce = ''; textContent = ''; loading = ''; fetchPriority = '';
        naturalWidth = 0; complete = false;
        children: Element[] = []; dataset: Record<string, string> = {};
        regions = new Set<string>(); matches = new Map<string, Element[]>();
        constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
        setAttribute() { /* Accessibility attributes never enter snapshots. */ }
        append(...children: Element[]) { this.children.push(...children); if (children.some(child => child.id === 'paint-calibration-diagnostic-panel')) order.push('panel'); }
        remove() { /* Closing happens after measurement. */ }
        closest(selector: string) { return this.regions.has(selector) ? this : null; }
        querySelector(selector: string) { return this.matches.get(selector)?.[0] ?? null; }
        querySelectorAll(selector: string) { return this.matches.get(selector) ?? []; }
    }
    const document = Object.assign(new Target(), {
        documentElement: new Element('html'), body: new Element('body'), currentScript: { nonce: 'PRIVATE_NONCE' },
        visibilityState: 'visible', prerendering: false, wasDiscarded: false,
        hasFocus: () => focus, createElement: (tag: string) => new Element(tag),
        querySelector: (_selector: string): Element | null => null,
        querySelectorAll: (_selector: string): Element[] => [],
    });
    const nav = { entryType: 'navigation', name: 'PRIVATE_NAV_URL', startTime: 0, type: 'navigate', redirectCount: 0,
        responseStart: 80, responseEnd: 90, domInteractive: 120, domContentLoadedEventEnd: 130, loadEventEnd: 140, activationStart: 0 };
    const timeline: Entry[] = [];
    const resources: Entry[] = [];
    const performance = {
        now: () => now,
        getEntriesByType: (type: string) => type === 'navigation' ? [nav] : type === 'paint' ? timeline.filter(entry => entry.startTime <= now) : [],
        getEntriesByName: (name: string) => {
            if (resourceReadFailure) throw new Error('PRIVATE_RESOURCE_FAILURE');
            return resources.filter(entry => entry.name === name);
        },
    };
    const observerInstances: Observer[] = [];
    class Observer {
        static supportedEntryTypes = options.supported ?? ['paint', 'largest-contentful-paint', 'longtask'];
        type = ''; disconnected = false; pending: Entry[] = [];
        callback: (list: { getEntries: () => Entry[] }) => void;
        constructor(callback: (list: { getEntries: () => Entry[] }) => void) { this.callback = callback; observerInstances.push(this); }
        observe({ type, buffered }: { type: string; buffered: boolean }) {
            expect(buffered).toBe(true);
            this.type = type;
            if (options.registerFailure === type) throw new Error('PRIVATE_REGISTRATION_FAILURE');
        }
        takeRecords() { order.push(`drain:${this.type}`); if (drainFailure) throw new Error('PRIVATE_DRAIN_FAILURE'); const value = this.pending; this.pending = []; return value; }
        disconnect() { this.disconnected = true; order.push(`disconnect:${this.type}`); }
    }
    const location = { pathname: options.pathname ?? '/', search: options.search ?? '?__perf=paint-calibration',
        origin: 'https://www.tzudong.app', href: 'https://www.tzudong.app/?__perf=paint-calibration', hostname: 'www.tzudong.app' };
    const runtime = Object.assign(new Target(), {
        innerWidth: 1363, innerHeight: 936, devicePixelRatio: 1,
        setTimeout(callback: () => void, delay: number) { const timer = { callback, delay, interval: false, cleared: false, fired: false }; timers.push(timer); return timer; },
        setInterval(callback: () => void, delay: number) { const timer = { callback, delay, interval: true, cleared: false, fired: false }; timers.push(timer); return timer; },
        clearInterval(timer: Timer) { timer.cleared = true; },
        requestAnimationFrame(callback: (timestamp: number) => void) {
            if (frameRequestFailure) throw new Error('PRIVATE_RAF_FAILURE');
            const id = ++frameId; frames.set(id, callback); return id;
        },
        cancelAnimationFrame(id: number) { frames.delete(id); order.push('cancel-frame'); },
    }) as Target & Record<string, unknown> & { innerWidth: number; innerHeight: number; devicePixelRatio: number };
    const context = { window: runtime, document, location, performance, PerformanceObserver: Observer,
        HTMLImageElement: Element, URL, URLSearchParams,
        get innerWidth() { return runtime.innerWidth; }, get innerHeight() { return runtime.innerHeight; },
        get devicePixelRatio() { return runtime.devicePixelRatio; } };
    runInNewContext(buildPaintCalibrationDiagnosticScript(options.release ?? 'a'.repeat(40)), context, { timeout: 1000 });
    const initialDeadlines = timers.filter(timer => !timer.interval);
    const find = (element: Element, id: string): Element | undefined => element.id === id ? element : element.children.map(child => find(child, id)).find(Boolean);
    const fire = (timer: Timer, time: number) => { now = time; timer.fired = true; timer.callback(); };
    return {
        document, runtime, location, resources, timeline, timers, frames, order, observerInstances, Element, nav,
        setTime(time: number) { now = time; }, setFocus(value: boolean) { focus = value; },
        setDrainFailure(value: boolean) { drainFailure = value; }, setResourceReadFailure(value: boolean) { resourceReadFailure = value; },
        setFrameRequestFailure(value: boolean) { frameRequestFailure = value; }, setCallbackReadFailure(value: boolean) { callbackReadFailure = value; },
        checkpoint(time = 20000) { fire(initialDeadlines[0]!, time); }, finalize(time = 30000) { fire(initialDeadlines[1]!, time); },
        probe(time: number) { fire(timers.find(timer => timer.interval)!, time); },
        deliverFrame(time: number, timestamp = time) { now = time; const [id, callback] = [...frames][0]!; frames.delete(id); callback(timestamp); },
        emit(type: string, entries: Entry[], pending = false) {
            const observer = observerInstances.find(value => value.type === type)!;
            if (pending) observer.pending.push(...entries);
            else observer.callback({ getEntries: () => { if (callbackReadFailure) throw new Error('PRIVATE_CALLBACK_FAILURE'); return entries; } });
        },
        initialMark(phase: string, value?: number) { (runtime.__tzudongInitialLoadDiagnostic as { mark: (phase: string, value?: number) => void })?.mark(phase, value); },
        criticalMark(phase: string) { (runtime.__tzudongPaintCalibration as { mark: (phase: string) => void })?.mark(phase); },
        claim() { return (runtime.__tzudongPaintCalibration as { claimInitialLatestQuery: () => boolean })?.claimInitialLatestQuery(); },
        result() { const pre = find(document.body, 'paint-calibration-diagnostic-result'); return pre ? JSON.parse(pre.textContent) : null; },
        panel() { return find(document.body, 'paint-calibration-diagnostic-panel'); },
    };
}

const paint = (name: string, startTime: number): Entry => ({ entryType: 'paint', name, startTime, duration: 0 });
const lcp = (startTime: number, values: Record<string, unknown> = {}): Entry => ({ entryType: 'largest-contentful-paint', name: '', startTime, renderTime: startTime, loadTime: 0, size: 832, ...values });

describe('independent paint delivery calibration', () => {
    test('an actual serialized-script snapshot satisfies the independently defined evidence schema', async () => {
        const { schemaProblems } = await import('../performance/production-paint-calibration-20261115/evidence.mjs');
        const schema = JSON.parse(readFileSync(new URL('../performance/production-paint-calibration-20261115/snapshot.schema.json', import.meta.url), 'utf8'));
        const page = browser();
        page.setTime(900); page.emit('paint', [paint('first-paint', 500), paint('first-contentful-paint', 800)]);
        page.probe(1000); page.deliverFrame(1010);
        page.checkpoint();
        page.setTime(25000); page.emit('largest-contentful-paint', [lcp(24000)]);
        page.finalize();
        expect(schemaProblems(page.result(), schema)).toEqual([]);
    });

    test('normal, extra, duplicate, other-route and old diagnostic requests install nothing', () => {
        for (const options of [{ search: '' }, { search: '?__perf=initial-load' }, { search: '?__perf=paint-calibration&extra=1' },
            { search: '?__perf=paint-calibration&__perf=paint-calibration' }, { pathname: '/feed' }]) {
            const page = browser(options);
            expect(page.timers).toHaveLength(0); expect(page.observerInstances).toHaveLength(0);
            expect(page.runtime.__tzudongPaintCalibration).toBeUndefined(); expect(page.runtime.__tzudongInitialLoadDiagnostic).toBeUndefined();
        }
        for (const [pathname, search, method, expected] of [
            ['/', '__perf=paint-calibration', 'GET', true], ['/', '__perf=paint-calibration', 'HEAD', true],
            ['/', '__perf=paint-calibration', 'POST', false], ['/feed', '__perf=paint-calibration', 'GET', false],
            ['/', '__perf=paint-calibration&__perf=paint-calibration', 'GET', false],
            ['/', '__perf=paint-calibration&x=1', 'GET', false], ['/', '__perf=initial-load', 'GET', false],
        ] as const) expect(isPaintCalibrationRequest(pathname, new URLSearchParams(search), method)).toBe(expected);
        expect(shouldCollectFieldVitals({ production: true, hostname: 'www.tzudong.app', pathname: '/', search: '?__perf=paint-calibration', webdriver: false })).toBe(false);
    });

    test('primary checkpoint is immutable; boundary drain and late delivery retain separate event and delivery windows', () => {
        const page = browser();
        page.setTime(900); page.emit('paint', [paint('first-paint', 500), paint('first-contentful-paint', 800)]);
        page.setTime(19000); page.emit('largest-contentful-paint', [lcp(1500), lcp(20001)], true);
        page.checkpoint(20003);
        expect(page.panel()).toBeUndefined();
        expect(page.observerInstances.every(value => !value.disconnected)).toBe(true);
        page.setTime(21000); page.emit('paint', [paint('first-contentful-paint', 19000)]);
        page.setTime(25000); page.emit('largest-contentful-paint', [lcp(24000)]);
        page.finalize(30004);
        const result = page.result();
        expect(result.schemaVersion).toBe('production-paint-calibration.snapshot.v1');
        expect(result.capture.performanceComparisonEligible).toBe(false);
        expect(result.capture.primaryCheckpointAtMs).toBe(20003);
        expect(result.primary.paintEntries.map((entry: { startTimeMs: number }) => entry.startTimeMs)).toEqual([500, 800]);
        expect(result.primary.lcpEntries.map((entry: { startTimeMs: number; accepted: boolean; delivery: string; entryWindow: string; receivedAtMs: number }) => [entry.startTimeMs, entry.accepted, entry.delivery, entry.entryWindow, entry.receivedAtMs])).toEqual([
            [1500, true, 'drain', 'primary', 20003], [20001, false, 'drain', 'tail', 20003],
        ]);
        expect(result.late.paintEntries).toEqual([{ startTimeMs: 19000, receivedAtMs: 21000, delivery: 'callback', entryWindow: 'primary', accepted: true, name: 'first-contentful-paint' }]);
        expect(result.late.lcpEntries[0].entryWindow).toBe('tail');
        expect(result.primary.observerStats.paint.receivedEntryCount).toBe(2);
        expect(result.late.observerStats.paint.receivedEntryCount).toBe(1);
        expect(result.primary.observerStats['largest-contentful-paint'].afterCutoffCount).toBe(1);
        expect(page.observerInstances.every(value => value.disconnected)).toBe(true);
        expect(page.order.at(-1)).toBe('panel');
        const frozen = JSON.stringify(result);
        page.setTime(31000); page.emit('paint', [paint('first-contentful-paint', 31000)]);
        page.criticalMark('latestSortReady');
        expect(JSON.stringify(page.result())).toBe(frozen);
    });

    test('paint timeline cross-check never fills absent observer measurements', () => {
        const page = browser();
        page.timeline.push(paint('first-paint', 400), paint('first-contentful-paint', 900), paint('PRIVATE_NAME', 25000));
        page.checkpoint(); page.finalize();
        const result = page.result();
        expect(result.primary.paintEntries).toEqual([]);
        expect(result.primary.paintTimeline.entries).toEqual([
            { name: 'first-paint', startTimeMs: 400, entryWindow: 'primary' },
            { name: 'first-contentful-paint', startTimeMs: 900, entryWindow: 'primary' },
        ]);
        expect(result.late.paintTimeline.entries.at(-1)).toEqual({ name: 'other', startTimeMs: 25000, entryWindow: 'tail' });
        expect(JSON.stringify(result)).not.toContain('PRIVATE_NAME');
    });

    test('a primary callback delayed past20s retains its actual delivery time before a late checkpoint', () => {
        const page = browser();
        page.setTime(20100); page.emit('paint', [paint('first-contentful-paint', 19500)]);
        page.checkpoint(20200); page.finalize();
        const record = page.result().primary.paintEntries[0];
        expect(record).toEqual({ startTimeMs: 19500, receivedAtMs: 20100, delivery: 'callback', entryWindow: 'primary', accepted: true, name: 'first-contentful-paint' });
        expect(page.result().capture.primaryCheckpointAtMs).toBe(20200);
        expect(page.result().late.paintEntries).toEqual([]);
    });

    test('focus and sparse frames remain context, with one pending frame and cancellation at the primary boundary', () => {
        const page = browser({ focus: false });
        page.probe(600); page.probe(1100); page.probe(1600);
        expect(page.frames.size).toBe(1);
        page.setTime(1700); page.runtime.send('blur');
        page.document.visibilityState = 'hidden'; page.document.send('visibilitychange');
        page.runtime.innerWidth = 820; page.runtime.send('resize');
        page.deliverFrame(2100, 2090);
        page.probe(2600); expect(page.frames.size).toBe(1);
        page.checkpoint();
        expect(page.frames.size).toBe(0);
        expect(page.timers.find(timer => timer.interval)?.cleared).toBe(true);
        page.probe(22000); expect(page.frames.size).toBe(0);
        page.setTime(23000); page.setFocus(true); page.runtime.send('focus');
        page.document.visibilityState = 'visible'; page.document.send('visibilitychange');
        page.finalize();
        const result = page.result();
        expect(result.primary.context.focusAtSetup).toBe(false);
        expect(result.primary.context.focusAtRead).toBe(false);
        expect(result.primary.context.focusFalseSampleCount).toBe(4);
        expect(result.primary.context.firstHiddenAtMs).toBe(1700);
        expect(result.late.context.focusAtRead).toBe(true);
        expect(result.primary.frames).toMatchObject({ requestedCount: 2, completedCount: 1, skippedPendingCount: 2,
            pendingAtPrimaryEnd: true, pendingRequestedAtMs: 2600, cancelledCount: 1, maxDelayMs: 1500 });
        expect(result.primary.frames.samples).toEqual([{ requestedAtMs: 600, callbackAtMs: 2100, frameTimestampMs: 2090, withinPrimary: true }]);
        expect(result.viewport.primary.width).toBe(820);
    });

    test('observer failures remain explicit and do not expose free-form errors', () => {
        const page = browser({ registerFailure: 'longtask' });
        page.setResourceReadFailure(true); page.setTime(1000);
        page.emit('largest-contentful-paint', [lcp(900, { url: 'https://www.tzudong.app/PRIVATE_IMAGE' })]);
        page.setCallbackReadFailure(true); page.emit('paint', []); page.setCallbackReadFailure(false);
        page.setDrainFailure(true); page.checkpoint(); page.setDrainFailure(false); page.finalize();
        const result = page.result();
        expect(result.primary.observerStats.longtask.registered).toBe(false);
        expect(result.primary.observerStats['largest-contentful-paint'].receivedEntryCount).toBe(1);
        expect(result.primary.observerStats['largest-contentful-paint'].handlerErrorCount).toBe(1);
        expect(result.primary.observerStats.paint.callbackCount).toBe(1);
        expect(result.primary.errors).toEqual(['OBSERVER_CALLBACK_READ_FAILED', 'OBSERVER_DRAIN_FAILED', 'OBSERVER_ENTRY_HANDLER_FAILED', 'OBSERVER_REGISTRATION_FAILED']);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    });

    test('fixed LCP region and priority classify an image without its URL, text, id or nonce', () => {
        const page = browser();
        const image = new page.Element('img'); image.id = 'PRIVATE_ID'; image.textContent = 'PRIVATE_TEXT';
        image.loading = 'eager'; image.fetchPriority = 'high'; image.regions.add('[data-desktop-left-panel-latest-restaurants="true"]');
        image.regions.add('[data-slot="card"][role="button"]');
        const url = 'https://www.tzudong.app/_next/image?url=PRIVATE_URL&token=PRIVATE_TOKEN';
        page.resources.push({ entryType: 'resource', startTime: 1000, name: url, requestStart: 1100, responseStart: 1200, responseEnd: 1300 });
        page.setTime(1600); page.emit('largest-contentful-paint', [lcp(1500, { element: image, url, loadTime: 1350, size: 71757 })]);
        page.checkpoint(); page.finalize();
        const record = page.result().primary.lcpEntries[0];
        expect(record).toMatchObject({ region: 'desktop-latest-card', elementKind: 'image', loading: 'eager', fetchPriority: 'high', size: 71757 });
        expect(record.resource).toEqual({ applicable: true, matched: true, category: 'same-origin-image', timingDetailAvailable: true,
            startTimeMs: 1000, requestStartMs: 1100, responseEndMs: 1300 });
        expect(JSON.stringify(page.result())).not.toContain('PRIVATE_');
        expect(page.panel()!.children[0].nonce).toBe('PRIVATE_NONCE');
    });

    test('a latest-section heading is not attributed to a restaurant card', () => {
        const page = browser();
        const heading = new page.Element('h2');
        heading.regions.add('[data-desktop-left-panel-latest-restaurants="true"]');
        heading.regions.add('[data-desktop-left-panel-map-home="true"]');
        page.setTime(1600); page.emit('largest-contentful-paint', [lcp(1500, { element: heading })]);
        page.checkpoint(); page.finalize();
        expect(page.result().primary.lcpEntries[0]).toMatchObject({ region: 'desktop-home-panel', elementKind: 'text', loading: 'unavailable', fetchPriority: 'unavailable' });
    });

    test('caps, invalid values and long tasks crossing the boundary are retained honestly', () => {
        const page = browser(); page.setTime(19000);
        page.emit('paint', Array.from({ length: 17 }, (_, index) => paint('first-paint', index + 1)));
        page.emit('largest-contentful-paint', Array.from({ length: 25 }, (_, index) => lcp(index + 1)));
        page.emit('longtask', Array.from({ length: 101 }, (_, index) => ({ entryType: 'longtask', startTime: index * 100, duration: 60 })));
        page.emit('longtask', [{ entryType: 'longtask', startTime: 19990, duration: 120 }], true);
        page.emit('paint', [paint('first-contentful-paint', NaN)]);
        for (let index = 0; index < 42; index++) { page.probe(19000); if (page.frames.size) page.deliverFrame(19000); }
        page.checkpoint(20200); page.finalize();
        const result = page.result();
        expect(result.primary.paintEntries).toHaveLength(16);
        expect(result.primary.lcpEntries).toHaveLength(24);
        expect(result.primary.longTasks).toHaveLength(100);
        expect(result.primary.entryCapReached).toBe(true);
        expect(result.primary.observerStats.paint.droppedByCapCount).toBe(1);
        expect(result.primary.observerStats.paint.invalidEntryCount).toBe(1);
        expect(result.primary.observerStats['largest-contentful-paint'].droppedByCapCount).toBe(1);
        expect(result.primary.observerStats.longtask.afterCutoffCount).toBe(1);
        expect(result.primary.observerStats.longtask.droppedByCapCount).toBe(2);
        expect(result.primary.frames.requestedCount).toBe(40);
        expect(result.primary.frames.samples).toHaveLength(40);
        expect(result.primary.frames.capReached).toBe(true);
    });

    test('initial app and critical-path milestone bags are first-wins and freeze at20s', () => {
        const page = browser(); page.setTime(500);
        expect(page.claim()).toBe(true); expect(page.claim()).toBe(false);
        page.initialMark('dataFetchCompleted', 764); page.initialMark('dataReady', 715); page.initialMark('__proto__', 1);
        page.criticalMark('latestFirstCardCommitted');
        page.setTime(600); page.criticalMark('latestQueryStarted'); page.criticalMark('latestSortReady');
        page.setTime(700); page.criticalMark('latestFirstCardCommitted');
        page.setTime(800); page.criticalMark('latestQueryStarted');
        page.checkpoint();
        page.setTime(21000); page.initialMark('clusterIndexReady', 999); page.criticalMark('latestKpiReady');
        expect(page.claim()).toBe(false); page.finalize();
        const result = page.result();
        expect(result.primary.initialLatestQueryClaimed).toBe(true);
        expect(result.primary.milestones.initialLoad.dataReady).toBe(500);
        expect(result.primary.milestoneCounts).toEqual({ fetchedRows: 764, restaurantCount: 715, clusterInputCount: null });
        expect(result.primary.milestones.criticalPath.latestQueryStarted).toBe(600);
        expect(result.primary.milestones.criticalPath.latestFirstCardCommitted).toBe(700);
        expect(result.primary.milestones.criticalPath.latestKpiReady).toBeNull();
    });

    test('fractional early timers reschedule and never reveal diagnostic content early', () => {
        const page = browser();
        page.checkpoint(19999.8); expect(page.panel()).toBeUndefined();
        expect(page.timers.at(-1)?.delay).toBe(1);
        page.setTime(19999.9); page.emit('paint', [paint('first-contentful-paint', 19999.85)], true);
        page.checkpoint(20000.8); expect(page.panel()).toBeUndefined();
        page.finalize(29999.8); expect(page.panel()).toBeUndefined(); expect(page.timers.at(-1)?.delay).toBe(1);
        page.finalize(30000.8);
        expect(page.result().primary.paintEntries[0].startTimeMs).toBe(19999.85);
        expect(page.result().capture.finalizedAtMs).toBe(30000.8);
    });

    test('unsupported entries remain absent and navigation context is explicit', () => {
        const page = browser({ supported: [], release: 'PRIVATE_RELEASE' });
        page.nav.redirectCount = 1; page.location.search = '?changed=PRIVATE_QUERY';
        page.checkpoint(); page.finalize();
        const result = page.result();
        expect(result.support.paint).toBe(false); expect(result.support.largestContentfulPaint).toBe(false);
        expect(result.binding.gitSha).toBeNull(); expect(result.navigation.redirectCount).toBe(1);
        expect(result.primary.paintEntries).toEqual([]);
        expect(result.primary.context.contextUnchanged).toBe(false);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    });
});
