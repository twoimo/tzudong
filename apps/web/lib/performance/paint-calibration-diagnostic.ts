import type { InitialLoadMilestone } from './initial-load-milestones';
import type { PaintCalibrationMilestone } from './paint-calibration-milestones';

/**
 * Separate diagnostic, never a replacement for the frozen initial-load series.
 * Serialized into a nonce-bearing head script on the exact opt-in request only.
 * Keep every runtime dependency inside this function. Retain fixed enums and
 * numbers only: no text, arbitrary identifiers, resource URLs or free-form errors.
 */
function installPaintCalibration(gitSha: string | null): void {
    const params = new URLSearchParams(location.search);
    if (location.pathname !== '/' || params.size !== 1 || params.get('__perf') !== 'paint-calibration'
        || window.__tzudongPaintCalibration || window.__tzudongInitialLoadDiagnostic) return;

    const primaryCutoffMs = 20_000;
    const finalCutoffMs = 30_000;
    const frameProbeIntervalMs = 500;
    const maxFrameProbes = 40;
    const caps = { paintEntries: 16, lcpEntries: 24, longTasks: 100, paintTimeline: 8 };
    const observerSetupMs = performance.now();
    const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce;
    const numeric = (value: unknown): number | null => typeof value === 'number'
        && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
    const count = (value: unknown): number | null => typeof value === 'number'
        && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
    const increment = (value: number) => Math.min(value + 1, 1_000_000);
    const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    const viewport = () => ({ width: numeric(innerWidth), height: numeric(innerHeight), dpr: numeric(devicePixelRatio) });
    const initialViewport = viewport();
    let primaryViewport = initialViewport;
    let primaryCheckpointAtMs: number | null = null;
    let primaryFrozen = false;
    let stopped = false;
    let initialLatestQueryClaimed = false;
    const cleanup: Array<() => void> = [];
    const types = ['paint', 'largest-contentful-paint', 'longtask'] as const;
    type EntryType = typeof types[number];
    type Delivery = 'callback' | 'drain';
    type EntryWindow = 'primary' | 'tail' | 'outside';
    type EntryBasis = { startTimeMs: number; receivedAtMs: number | null; delivery: Delivery; entryWindow: EntryWindow; accepted: boolean };
    type ObserverStats = {
        registered: boolean; callbackCount: number; callbackEntryCount: number; drainedEntryCount: number;
        receivedEntryCount: number; acceptedEntryCount: number; afterCutoffCount: number;
        invalidEntryCount: number; handlerErrorCount: number; droppedByCapCount: number;
    };
    type PaintRecord = EntryBasis & { name: 'first-paint' | 'first-contentful-paint' | 'other' };
    type LcpRecord = EntryBasis & {
        renderTimeMs: number | null; loadTimeMs: number | null; size: number | null;
        elementKind: 'image' | 'video' | 'svg' | 'background-image' | 'text' | 'unavailable';
        region: 'desktop-latest-card' | 'desktop-home-panel' | 'map' | 'static-skeleton' | 'other' | 'unavailable';
        loading: 'lazy' | 'eager' | 'auto' | 'unavailable'; fetchPriority: 'high' | 'low' | 'auto' | 'unavailable';
        resource: { applicable: boolean; matched: boolean; category: 'same-origin-image' | 'cross-origin-image' | 'unavailable';
            timingDetailAvailable: boolean; startTimeMs: number | null; requestStartMs: number | null; responseEndMs: number | null };
    };
    type LongTaskRecord = EntryBasis & { durationMs: number; endTimeMs: number };
    type Segment = {
        observerStats: Record<EntryType, ObserverStats>; paintEntries: PaintRecord[]; lcpEntries: LcpRecord[];
        longTasks: LongTaskRecord[]; entryCapReached: boolean; observerWorkMs: number; errors: Set<string>;
    };
    const newSegment = (): Segment => ({
        observerStats: Object.fromEntries(types.map(type => [type, {
            registered: false, callbackCount: 0, callbackEntryCount: 0, drainedEntryCount: 0,
            receivedEntryCount: 0, acceptedEntryCount: 0, afterCutoffCount: 0,
            invalidEntryCount: 0, handlerErrorCount: 0, droppedByCapCount: 0,
        }])) as Record<EntryType, ObserverStats>,
        paintEntries: [], lcpEntries: [], longTasks: [], entryCapReached: false, observerWorkMs: 0, errors: new Set(),
    });
    const primarySegment = newSegment();
    const lateSegment = newSegment();
    const activeSegment = () => primaryFrozen ? lateSegment : primarySegment;
    const eventWindow = (start: number): EntryWindow => start <= primaryCutoffMs ? 'primary' : start <= finalCutoffMs ? 'tail' : 'outside';
    const initialLoad: Record<InitialLoadMilestone, number | null> = {
        homeClientCommitted: null, viewportResolved: null,
        dataQueryStarted: null, dataFetchCompleted: null, dataMergeCompleted: null, dataReady: null, dataError: null,
        naverSdkRequested: null, naverSdkReady: null, naverSdkError: null,
        mapConstructionStarted: null, mapConstructed: null, mapConstructionError: null,
        clusterIndexStarted: null, clusterIndexReady: null,
        controlsWrapperMounted: null, mobileControlsMounted: null, desktopPanelSettled: null,
    };
    const criticalPath: Record<PaintCalibrationMilestone, number | null> = {
        desktopImplementationLoadStarted: null, desktopImplementationLoadReady: null,
        mobileImplementationLoadStarted: null, mobileImplementationLoadReady: null,
        latestQueryStarted: null, latestRestaurantRowsReady: null, latestKpiStarted: null, latestKpiReady: null,
        latestSortReady: null, latestFirstCardCommitted: null,
    };
    const milestoneCounts = { fetchedRows: null as number | null, restaurantCount: null as number | null, clusterInputCount: null as number | null };
    const primaryNow = () => {
        const now = numeric(performance.now());
        return stopped || primaryFrozen || now === null || now > primaryCutoffMs ? null : now;
    };
    window.__tzudongInitialLoadDiagnostic = {
        mark(phase, value) {
            const now = primaryNow();
            if (now === null || !Object.prototype.hasOwnProperty.call(initialLoad, phase) || initialLoad[phase] !== null) return;
            initialLoad[phase] = now;
            if (phase === 'dataFetchCompleted') milestoneCounts.fetchedRows = count(value);
            if (phase === 'dataReady') milestoneCounts.restaurantCount = count(value);
            if (phase === 'clusterIndexReady') milestoneCounts.clusterInputCount = count(value);
        },
    };
    window.__tzudongPaintCalibration = {
        mark(phase) {
            const now = primaryNow();
            if (now === null || !Object.prototype.hasOwnProperty.call(criticalPath, phase) || criticalPath[phase] !== null
                || (phase === 'latestFirstCardCommitted' && criticalPath.latestSortReady === null)) return;
            criticalPath[phase] = now;
        },
        claimInitialLatestQuery() {
            if (primaryNow() === null || initialLatestQueryClaimed) return false;
            initialLatestQueryClaimed = true;
            return true;
        },
    };

    const safeFocus = (): boolean | null => {
        try { return typeof document.hasFocus === 'function' ? document.hasFocus() : null; }
        catch { activeSegment().errors.add('FOCUS_READ_FAILED'); return null; }
    };
    const visibility = () => document.visibilityState === 'visible' ? 'visible' : 'hidden';
    const initialVisibility = visibility();
    const initialFocus = safeFocus();
    const context = {
        visibilityAtSetup: initialVisibility, focusAtSetup: initialFocus,
        firstHiddenAtMs: initialVisibility === 'hidden' ? numeric(observerSetupMs) : null,
        visibilityChangeCount: 0, focusEventCount: 0, blurEventCount: 0,
        firstFocusAtMs: null as number | null, firstBlurAtMs: null as number | null,
        trustedInputCount: 0, firstTrustedInputAtMs: null as number | null,
        resizeCount: 0, firstResizeAtMs: null as number | null,
        focusSampleCount: 0, focusTrueSampleCount: 0, focusFalseSampleCount: 0, focusUnknownSampleCount: 0,
        prerenderingAtSetup: Boolean((document as Document & { prerendering?: boolean }).prerendering),
        wasDiscarded: Boolean((document as Document & { wasDiscarded?: boolean }).wasDiscarded),
    };
    const listen = (target: EventTarget, name: string, handler: EventListener, capture = false) => {
        target.addEventListener(name, handler, { passive: true, capture });
        cleanup.push(() => target.removeEventListener(name, handler, capture));
    };
    const contextNow = () => {
        const now = numeric(performance.now());
        return stopped || now === null || now > finalCutoffMs ? null : now;
    };
    listen(document, 'visibilitychange', () => {
        const now = contextNow(); if (now === null) return;
        context.visibilityChangeCount = increment(context.visibilityChangeCount);
        if (visibility() === 'hidden' && context.firstHiddenAtMs === null) context.firstHiddenAtMs = now;
    });
    listen(window, 'focus', () => {
        const now = contextNow(); if (now === null) return;
        context.focusEventCount = increment(context.focusEventCount);
        if (context.firstFocusAtMs === null) context.firstFocusAtMs = now;
    });
    listen(window, 'blur', () => {
        const now = contextNow(); if (now === null) return;
        context.blurEventCount = increment(context.blurEventCount);
        if (context.firstBlurAtMs === null) context.firstBlurAtMs = now;
    });
    listen(window, 'resize', () => {
        const now = contextNow(); if (now === null) return;
        context.resizeCount = increment(context.resizeCount);
        if (context.firstResizeAtMs === null) context.firstResizeAtMs = now;
    });
    for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
        listen(window, name, (event) => {
            const now = contextNow(); if (now === null || !event.isTrusted) return;
            context.trustedInputCount = increment(context.trustedInputCount);
            if (context.firstTrustedInputAtMs === null) context.firstTrustedInputAtMs = now;
        }, true);
    }
    const readContext = () => ({ ...context, observedAtMs: numeric(performance.now()),
        visibilityAtRead: visibility(), focusAtRead: safeFocus(),
        contextUnchanged: location.pathname === '/' && new URLSearchParams(location.search).size === 1
            && new URLSearchParams(location.search).get('__perf') === 'paint-calibration',
    });

    const supported = typeof PerformanceObserver === 'function' ? PerformanceObserver.supportedEntryTypes ?? [] : [];
    const navigationEntry = () => performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const support = { navigation: Boolean(navigationEntry()), paint: supported.includes('paint'),
        largestContentfulPaint: supported.includes('largest-contentful-paint'), longTask: supported.includes('longtask'),
        animationFrame: typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function' };
    type LcpEntry = PerformanceEntry & { renderTime?: number; loadTime?: number; size?: number; element?: Element; url?: string };
    const lcpRegion = (element: Element | undefined): LcpRecord['region'] => {
        if (!element) return 'unavailable';
        const card = element.closest('[data-slot="card"][role="button"]');
        if (card?.closest('[data-desktop-left-panel-latest-restaurants="true"]')) return 'desktop-latest-card';
        if (element.closest('[data-desktop-left-panel-map-home="true"]')) return 'desktop-home-panel';
        if (element.closest('[data-testid="map-container"]')) return 'map';
        if (element.closest('[data-home-static-skeleton]')) return 'static-skeleton';
        return 'other';
    };
    const retain = <T,>(segment: Segment, type: EntryType, target: T[], entry: T, cap: number) => {
        if (target.length < cap) target.push(entry);
        else { segment.entryCapReached = true; segment.observerStats[type].droppedByCapCount = increment(segment.observerStats[type].droppedByCapCount); }
    };
    const collect = (type: EntryType, entry: PerformanceEntry, delivery: Delivery, segment: Segment) => {
        const stats = segment.observerStats[type];
        stats.receivedEntryCount = increment(stats.receivedEntryCount);
        if (delivery === 'callback') stats.callbackEntryCount = increment(stats.callbackEntryCount);
        else stats.drainedEntryCount = increment(stats.drainedEntryCount);
        const start = numeric(entry.startTime);
        if (start === null) { stats.invalidEntryCount = increment(stats.invalidEntryCount); return; }
        const cutoff = segment === primarySegment ? primaryCutoffMs : finalCutoffMs;
        const accepted = start <= cutoff;
        const basis: EntryBasis = { startTimeMs: start, receivedAtMs: numeric(performance.now()), delivery, entryWindow: eventWindow(start), accepted };
        if (!accepted) stats.afterCutoffCount = increment(stats.afterCutoffCount);
        if (type === 'paint') {
            const name = entry.name === 'first-paint' || entry.name === 'first-contentful-paint' ? entry.name : 'other';
            if (name === 'other') { basis.accepted = false; stats.invalidEntryCount = increment(stats.invalidEntryCount); }
            if (basis.accepted) stats.acceptedEntryCount = increment(stats.acceptedEntryCount);
            retain(segment, type, segment.paintEntries, { ...basis, name }, caps.paintEntries);
        } else if (type === 'longtask') {
            const duration = numeric(entry.duration);
            const end = duration === null ? null : numeric(start + duration);
            if (duration === null || end === null) { stats.invalidEntryCount = increment(stats.invalidEntryCount); return; }
            if (accepted && end > cutoff) { basis.accepted = false; stats.afterCutoffCount = increment(stats.afterCutoffCount); }
            if (basis.accepted) stats.acceptedEntryCount = increment(stats.acceptedEntryCount);
            retain(segment, type, segment.longTasks, { ...basis, durationMs: duration, endTimeMs: end }, caps.longTasks);
        } else {
            const candidate = entry as LcpEntry;
            const applicable = Boolean(candidate.url);
            const resource = applicable
                ? performance.getEntriesByName(candidate.url!, 'resource').findLast(value => value.startTime <= start) as PerformanceResourceTiming | undefined
                : undefined;
            const detail = Boolean(resource && resource.requestStart > 0 && resource.responseStart > 0 && resource.responseEnd >= resource.responseStart);
            const tag = candidate.element?.tagName?.toUpperCase();
            const loading = (candidate.element as HTMLImageElement | undefined)?.loading;
            const priority = (candidate.element as HTMLImageElement | undefined)?.fetchPriority;
            const category = resource ? (new URL(resource.name, location.href).origin === location.origin ? 'same-origin-image' : 'cross-origin-image') : 'unavailable';
            const record: LcpRecord = { ...basis,
                renderTimeMs: numeric(candidate.renderTime), loadTimeMs: numeric(candidate.loadTime), size: numeric(candidate.size),
                elementKind: tag === 'IMG' ? 'image' : tag === 'VIDEO' ? 'video' : tag === 'SVG' ? 'svg'
                    : applicable ? 'background-image' : tag ? 'text' : 'unavailable',
                region: lcpRegion(candidate.element),
                loading: loading === 'lazy' || loading === 'eager' ? loading : tag === 'IMG' ? 'auto' : 'unavailable',
                fetchPriority: priority === 'high' || priority === 'low' ? priority : tag === 'IMG' ? 'auto' : 'unavailable',
                resource: { applicable, matched: Boolean(resource), category, timingDetailAvailable: detail,
                    startTimeMs: resource ? numeric(resource.startTime) : null,
                    requestStartMs: detail ? numeric(resource!.requestStart) : null,
                    responseEndMs: detail ? numeric(resource!.responseEnd) : null },
            };
            if (basis.accepted) stats.acceptedEntryCount = increment(stats.acceptedEntryCount);
            retain(segment, type, segment.lcpEntries, record, caps.lcpEntries);
        }
    };
    const receive = (type: EntryType, entry: PerformanceEntry, delivery: Delivery, segment: Segment) => {
        try { collect(type, entry, delivery, segment); }
        catch { segment.observerStats[type].handlerErrorCount = increment(segment.observerStats[type].handlerErrorCount); segment.errors.add('OBSERVER_ENTRY_HANDLER_FAILED'); }
    };
    const observers: Array<{ type: EntryType; observer: PerformanceObserver }> = [];
    for (const type of types) {
        if (!supported.includes(type)) continue;
        try {
            const observer = new PerformanceObserver((list) => {
                if (stopped) return;
                const started = performance.now();
                const segment = activeSegment();
                segment.observerStats[type].callbackCount = increment(segment.observerStats[type].callbackCount);
                try { for (const entry of list.getEntries()) receive(type, entry, 'callback', segment); }
                catch { segment.errors.add('OBSERVER_CALLBACK_READ_FAILED'); }
                segment.observerWorkMs += performance.now() - started;
            });
            observer.observe({ type, buffered: true });
            primarySegment.observerStats[type].registered = true;
            lateSegment.observerStats[type].registered = true;
            observers.push({ type, observer });
        } catch { primarySegment.errors.add('OBSERVER_REGISTRATION_FAILED'); }
    }
    const drain = (segment: Segment) => {
        const started = performance.now();
        for (const { type, observer } of observers) {
            try { for (const entry of observer.takeRecords()) receive(type, entry, 'drain', segment); }
            catch { segment.errors.add('OBSERVER_DRAIN_FAILED'); }
        }
        segment.observerWorkMs += performance.now() - started;
    };
    const readPaintTimeline = () => {
        const entries: Array<{ name: PaintRecord['name']; startTimeMs: number | null; entryWindow: EntryWindow | 'invalid' }> = [];
        let readError = false; let capReached = false;
        try {
            for (const entry of performance.getEntriesByType('paint')) {
                if (entries.length >= caps.paintTimeline) { capReached = true; break; }
                const start = numeric(entry.startTime);
                entries.push({ name: entry.name === 'first-paint' || entry.name === 'first-contentful-paint' ? entry.name : 'other',
                    startTimeMs: start, entryWindow: start === null ? 'invalid' : eventWindow(start) });
            }
        } catch { readError = true; activeSegment().errors.add('PAINT_TIMELINE_READ_FAILED'); }
        return { observedAtMs: numeric(performance.now()), entries, readError, capReached };
    };
    const frames = {
        requestedCount: 0, completedCount: 0, skippedPendingCount: 0, capReached: false,
        pendingAtPrimaryEnd: false, pendingRequestedAtMs: null as number | null, cancelledCount: 0,
        maxDelayMs: null as number | null, workMs: 0,
        samples: [] as Array<{ requestedAtMs: number; callbackAtMs: number | null; frameTimestampMs: number | null; withinPrimary: boolean }>,
    };
    let pendingFrame: number | null = null;
    const frameProbe = () => {
        const started = performance.now();
        if (stopped || primaryFrozen || started > primaryCutoffMs) return;
        try {
            const focus = safeFocus();
            context.focusSampleCount = increment(context.focusSampleCount);
            if (focus === true) context.focusTrueSampleCount = increment(context.focusTrueSampleCount);
            else if (focus === false) context.focusFalseSampleCount = increment(context.focusFalseSampleCount);
            else context.focusUnknownSampleCount = increment(context.focusUnknownSampleCount);
            if (!support.animationFrame) return;
            if (pendingFrame !== null) { frames.skippedPendingCount = increment(frames.skippedPendingCount); return; }
            if (frames.requestedCount >= maxFrameProbes) { frames.capReached = true; return; }
            const requestedAt = numeric(started)!;
            frames.requestedCount += 1;
            frames.pendingRequestedAtMs = requestedAt;
            try {
                pendingFrame = window.requestAnimationFrame(timestamp => {
                    const callbackAt = performance.now();
                    if (stopped || primaryFrozen) return;
                    pendingFrame = null;
                    frames.pendingRequestedAtMs = null;
                    frames.completedCount += 1;
                    const delay = Math.max(0, callbackAt - requestedAt);
                    frames.maxDelayMs = Math.max(frames.maxDelayMs ?? 0, delay);
                    frames.samples.push({ requestedAtMs: requestedAt, callbackAtMs: numeric(callbackAt),
                        frameTimestampMs: numeric(timestamp), withinPrimary: callbackAt <= primaryCutoffMs });
                    frames.workMs += performance.now() - callbackAt;
                });
            } catch { activeSegment().errors.add('RAF_REQUEST_FAILED'); frames.pendingRequestedAtMs = null; }
        } finally {
            frames.workMs += performance.now() - started;
        }
    };
    const frameTimer = window.setInterval(frameProbe, frameProbeIntervalMs);

    const readReadiness = () => {
        const data = document.documentElement.dataset;
        const panel = document.querySelector('[data-desktop-left-panel-map-home="true"]');
        const latest = panel?.querySelector('[data-desktop-left-panel-latest-restaurants="true"]');
        const image = latest?.querySelector('img[data-youtube-thumbnail-quality]') as HTMLImageElement | null | undefined;
        const map = document.querySelector('[data-testid="map-container"]');
        const mapImages = [...map?.querySelectorAll('img') ?? []];
        return { observedAtMs: numeric(performance.now()), basis: 'primary-checkpoint-dom-state',
            homeChromeReady: data.homeChromeReady === 'true', homeMobileChromeReady: data.homeMobileChromeReady === 'true',
            homePanelReady: data.homePanelReady === 'true', staticSkeletonPresent: Boolean(document.querySelector('[data-home-static-skeleton]')),
            desktopPanelPresent: Boolean(panel), desktopPopularItemCount: panel?.querySelectorAll('button[aria-label$=" 인기 맛집 상세 보기"]').length ?? 0,
            desktopLatestItemCount: latest?.querySelectorAll('[role="button"]').length ?? 0,
            desktopPanelAlertCount: panel?.querySelectorAll('[role="alert"]').length ?? 0,
            firstLatestImageComplete: Boolean(image?.complete && image.naturalWidth > 0), firstLatestImageNaturalWidth: image ? numeric(image.naturalWidth) : null,
            mapElementPresent: Boolean(map), mapImageCount: mapImages.length,
            completeMapImageCount: mapImages.filter(value => value instanceof HTMLImageElement && value.complete && value.naturalWidth > 0).length,
            markerCount: document.querySelectorAll('button.cluster-marker-container, button.tzudong-individual-marker[data-testid="marker"]').length };
    };
    const snapshotSegment = (segment: Segment) => copy({ observerStats: segment.observerStats,
        paintEntries: segment.paintEntries, lcpEntries: segment.lcpEntries, longTasks: segment.longTasks,
        entryCapReached: segment.entryCapReached, observerWorkMs: numeric(segment.observerWorkMs), errors: [...segment.errors].sort() });
    let primary: Record<string, unknown> | null = null;
    const checkpoint = () => {
        if (primaryFrozen || stopped) return;
        const started = performance.now();
        if (started < primaryCutoffMs) { window.setTimeout(checkpoint, Math.max(1, primaryCutoffMs - started)); return; }
        primaryCheckpointAtMs = numeric(started);
        window.clearInterval(frameTimer);
        frames.pendingAtPrimaryEnd = pendingFrame !== null;
        if (pendingFrame !== null) { window.cancelAnimationFrame(pendingFrame); frames.cancelledCount += 1; pendingFrame = null; }
        drain(primarySegment);
        const readbackStarted = performance.now();
        const paintTimeline = readPaintTimeline();
        const currentContext = readContext();
        const readiness = readReadiness();
        primaryViewport = viewport();
        primary = copy({ ...snapshotSegment(primarySegment), observedAtMs: primaryCheckpointAtMs,
            paintTimeline, context: currentContext, frames: { ...frames, workMs: numeric(frames.workMs), maxDelayMs: numeric(frames.maxDelayMs) },
            milestones: { initialLoad, criticalPath }, milestoneCounts, initialLatestQueryClaimed,
            readiness, readbackWorkMs: numeric(performance.now() - readbackStarted) });
        primaryFrozen = true;
        window.__tzudongInitialLoadDiagnostic = { mark() { /* Primary interval is immutable. */ } };
        window.__tzudongPaintCalibration = { mark() { /* Primary interval is immutable. */ }, claimInitialLatestQuery: () => false };
    };
    const finalize = () => {
        if (stopped) return;
        const started = performance.now();
        if (started < finalCutoffMs) { window.setTimeout(finalize, Math.max(1, finalCutoffMs - started)); return; }
        if (!primaryFrozen) checkpoint();
        drain(lateSegment);
        for (const { observer } of observers) observer.disconnect();
        for (const remove of cleanup) remove();
        const paintTimeline = readPaintTimeline();
        const currentContext = readContext();
        stopped = true;
        const nav = navigationEntry();
        const snapshot = {
            schemaVersion: 'production-paint-calibration.snapshot.v1', mode: 'paint-calibration',
            binding: { gitSha, hostname: ['www.tzudong.app', 'tzudong.app'].includes(location.hostname) ? location.hostname : 'other', pathname: '/' },
            capture: { instrumentationVersion: '20261115.paint.1', primaryCutoffMs, finalCutoffMs,
                observerSetupMs: numeric(observerSetupMs), primaryCheckpointAtMs, finalizedAtMs: numeric(performance.now()),
                frameProbeIntervalMs, maxFrameProbes, caps, lateObservationBasis: 'passive-observers-only',
                lateDeliveryBasis: 'deliveries-after-primary-checkpoint', observerStatsBasis: 'independent-per-segment',
                performanceComparisonEligible: false },
            support, viewport: { initial: initialViewport, primary: primaryViewport, final: viewport() },
            navigation: nav ? { type: ['navigate', 'reload', 'back_forward', 'prerender'].includes(nav.type) ? nav.type : 'unknown',
                startTimeMs: numeric(nav.startTime), redirectCount: count(nav.redirectCount), responseStartMs: numeric(nav.responseStart), responseEndMs: numeric(nav.responseEnd),
                domInteractiveMs: nav.domInteractive > 0 ? numeric(nav.domInteractive) : null,
                domContentLoadedMs: nav.domContentLoadedEventEnd > 0 ? numeric(nav.domContentLoadedEventEnd) : null,
                loadEventEndMs: nav.loadEventEnd > 0 ? numeric(nav.loadEventEnd) : null,
                activationStartMs: numeric((nav as PerformanceNavigationTiming & { activationStart?: number }).activationStart) } : null,
            primary, late: { ...snapshotSegment(lateSegment), observedAtMs: numeric(started), paintTimeline, context: currentContext },
        };
        const panel = document.createElement('section');
        panel.id = 'paint-calibration-diagnostic-panel'; panel.setAttribute('aria-label', '페인트 전달 진단 결과');
        const heading = document.createElement('h1'); heading.textContent = '페인트 전달 진단 · 30초 관측 완료';
        const note = document.createElement('p');
        note.textContent = '20초 구간과 이후 10초 전달 기록을 분리했습니다. 화면 표시 전에 관측을 종료했으며, 이 결과는 성능 개선 점수나 기존 측정의 보정값이 아닙니다.';
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '진단 결과 닫기';
        close.addEventListener('click', () => panel.remove(), { once: true });
        const pre = document.createElement('pre'); pre.id = 'paint-calibration-diagnostic-result'; pre.textContent = JSON.stringify(snapshot, null, 2);
        const style = document.createElement('style'); if (nonce) style.nonce = nonce;
        style.textContent = '#paint-calibration-diagnostic-panel{position:fixed;inset:12px;z-index:2147483647;overflow:auto;padding:16px;background:#fff;color:#111;border:2px solid #333;font:14px/1.5 system-ui;box-sizing:border-box}#paint-calibration-diagnostic-panel h1{font-size:18px}#paint-calibration-diagnostic-panel button{padding:8px 12px;border:1px solid #555;background:#fff;color:#111}#paint-calibration-diagnostic-result{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 monospace}';
        panel.append(style, heading, note, close, pre); (document.body ?? document.documentElement).append(panel);
    };
    window.setTimeout(checkpoint, Math.max(0, primaryCutoffMs - performance.now()));
    window.setTimeout(finalize, Math.max(0, finalCutoffMs - performance.now()));
}

export function buildPaintCalibrationDiagnosticScript(release: string | undefined): string {
    const gitSha = release && /^[a-f0-9]{40}$/.test(release) ? release : null;
    return `(${installPaintCalibration.toString()})(${JSON.stringify(gitSha)});`.replace(/<\/script/gi, '<\\/script');
}
