import type { InitialLoadMilestone } from './initial-load-milestones';

export function isInitialLoadDiagnosticRequest(params: Record<string, string | string[] | undefined>): boolean {
    return Object.keys(params).length === 1 && params.__perf === 'initial-load';
}

/**
 * Serialized into a nonce-bearing inline script only for /?__perf=initial-load.
 * Keep this function self-contained: it must not capture imports or module state.
 * All retained fields are numbers, booleans, null, or fixed classification enums.
 */
function installInitialLoadDiagnostic(gitSha: string | null): void {
    const params = new URLSearchParams(location.search);
    if (location.pathname !== '/' || params.size !== 1 || params.get('__perf') !== 'initial-load'
        || window.__tzudongInitialLoadDiagnostic) return;

    const cutoffMs = 20_000;
    const readinessSamplingIntervalMs = 500;
    const maxEntries = 2_000;
    const maxLongTasks = 250;
    const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce;
    const observerSetupMs = performance.now();
    let stopped = false;
    let resourceEntries = 0;
    let entryCapReached = false;
    let resourceBufferOverflow = false;
    let observerWorkMs = 0;
    const errors = new Set<string>();
    const observers: PerformanceObserver[] = [];
    const cleanups: Array<() => void> = [];
    const numeric = (value: unknown): number | null => typeof value === 'number'
        && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
    const withinWindow = (value: unknown): number | null => {
        const result = numeric(value);
        return result !== null && result <= cutoffMs ? result : null;
    };
    const count = (value: unknown): number | null => typeof value === 'number'
        && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
    const viewport = () => ({ width: numeric(innerWidth), height: numeric(innerHeight), dpr: numeric(devicePixelRatio) });
    const initialViewport = viewport();
    let finalViewport = initialViewport;
    const visibilityAtStart = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    let firstHiddenAtMs: number | null = visibilityAtStart === 'hidden' ? numeric(observerSetupMs) : null;
    let trustedInputCount = 0;
    let firstTrustedInputAtMs: number | null = null;
    let resizeCount = 0;
    let firstResizeAtMs: number | null = null;
    let fpMs: number | null = null;
    let fcpMs: number | null = null;
    const milestones: Record<InitialLoadMilestone | 'controlsReady' | 'mapVisible' | 'desktopPanelReady' | 'initialSkeletonHidden', number | null> = {
        homeClientCommitted: null, viewportResolved: null,
        dataQueryStarted: null, dataFetchCompleted: null, dataMergeCompleted: null, dataReady: null, dataError: null,
        naverSdkRequested: null, naverSdkReady: null, naverSdkError: null,
        mapConstructionStarted: null, mapConstructed: null, mapConstructionError: null,
        clusterIndexStarted: null, clusterIndexReady: null,
        controlsWrapperMounted: null, mobileControlsMounted: null, desktopPanelSettled: null,
        controlsReady: null, mapVisible: null, desktopPanelReady: null, initialSkeletonHidden: null,
    };
    const milestoneCounts: { fetchedRows: number | null; restaurantCount: number | null; clusterInputCount: number | null } = {
        fetchedRows: null, restaurantCount: null, clusterInputCount: null,
    };
    window.__tzudongInitialLoadDiagnostic = {
        mark(phase, value) {
            const now = withinWindow(performance.now());
            if (stopped || now === null || !Object.prototype.hasOwnProperty.call(milestones, phase)
                || milestones[phase] !== null) return;
            milestones[phase] = now;
            if (phase === 'dataError') errors.add('HOME_DATA_ERROR');
            if (phase === 'naverSdkError') errors.add('NAVER_SDK_ERROR');
            if (phase === 'mapConstructionError') errors.add('MAP_CONSTRUCTION_ERROR');
            if (phase === 'dataFetchCompleted') milestoneCounts.fetchedRows = count(value);
            if (phase === 'dataReady') milestoneCounts.restaurantCount = count(value);
            if (phase === 'clusterIndexReady') milestoneCounts.clusterInputCount = count(value);
        },
    };
    const listen = (target: EventTarget, name: string, handler: EventListener, capture = false) => {
        target.addEventListener(name, handler, { capture, passive: true });
        cleanups.push(() => target.removeEventListener(name, handler, capture));
    };
    listen(document, 'visibilitychange', () => {
        const now = withinWindow(performance.now());
        if (now !== null && document.visibilityState !== 'visible' && firstHiddenAtMs === null) firstHiddenAtMs = now;
    });
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
        listen(window, type, (event) => {
            const now = withinWindow(performance.now());
            if (!event.isTrusted || now === null) return;
            trustedInputCount = Math.min(1_000_000, trustedInputCount + 1);
            if (firstTrustedInputAtMs === null) firstTrustedInputAtMs = now;
        }, true);
    }
    listen(window, 'resize', () => {
        const now = withinWindow(performance.now());
        if (now === null) return;
        finalViewport = viewport();
        resizeCount = Math.min(1_000_000, resizeCount + 1);
        if (firstResizeAtMs === null) firstResizeAtMs = now;
    });
    listen(performance, 'resourcetimingbufferfull', () => { resourceBufferOverflow = true; });

    // URL values are classified immediately and never retained in the report.
    const classifyResource = (name: string, initiator = ''): string => {
        try {
            const url = new URL(name, location.href);
            const host = url.hostname;
            const path = url.pathname;
            if (url.origin === location.origin) {
                if (/\.(?:woff2?|ttf|otf)$/i.test(path)) return 'same-origin-font';
                if (path.endsWith('.css')) return 'same-origin-css';
                if (path.endsWith('.js')) return 'same-origin-script';
                if (path.startsWith('/api/')) return 'same-origin-api';
                if (initiator === 'img' || path.startsWith('/_next/image')) return 'same-origin-image';
                return 'same-origin-other';
            }
            if (/(^|\.)supabase\.(?:co|in)$/.test(host)) {
                return path === '/rest/v1/restaurants' ? 'supabase-restaurants' : 'supabase-other';
            }
            if (host === 'oapi.map.naver.com' && /\/maps\.js$/.test(path)) return 'naver-sdk';
            if (/(^|\.)(?:pstatic\.net|naver\.com|naver\.net|ntruss\.com)$/.test(host)) {
                return initiator === 'img' ? 'naver-image' : 'naver-other';
            }
            return 'other';
        } catch { return 'unclassified'; }
    };
    type ResourceAggregate = {
        category: string; count: number; completedCount: number; knownTimingCount: number; unknownTimingCount: number;
        transferBytesKnown: number; encodedBytesKnown: number; decodedBytesKnown: number;
        zeroTransferKnownCount: number; networkTransferKnownCount: number; totalDurationMs: number;
        firstStartMs: number | null; lastResponseEndMs: number | null;
    };
    const resourceAggregates = new Map<string, ResourceAggregate>();
    const resourceDetailAvailable = (entry: PerformanceResourceTiming) => entry.responseStart > 0
        && entry.requestStart > 0 && entry.responseEnd >= entry.responseStart;
    const collectResource = (entry: PerformanceResourceTiming) => {
        if (entry.startTime > cutoffMs || entry.responseEnd > cutoffMs || entry.responseEnd <= 0) return;
        if (resourceEntries >= maxEntries) { entryCapReached = true; return; }
        resourceEntries += 1;
        const category = classifyResource(entry.name, entry.initiatorType);
        let aggregate = resourceAggregates.get(category);
        if (!aggregate) {
            aggregate = { category, count: 0, completedCount: 0, knownTimingCount: 0, unknownTimingCount: 0,
                transferBytesKnown: 0, encodedBytesKnown: 0, decodedBytesKnown: 0,
                zeroTransferKnownCount: 0, networkTransferKnownCount: 0, totalDurationMs: 0,
                firstStartMs: null, lastResponseEndMs: null };
            resourceAggregates.set(category, aggregate);
        }
        aggregate.count += 1;
        aggregate.completedCount += 1;
        aggregate.totalDurationMs += entry.duration;
        aggregate.firstStartMs = Math.min(aggregate.firstStartMs ?? Infinity, entry.startTime);
        aggregate.lastResponseEndMs = Math.max(aggregate.lastResponseEndMs ?? 0, entry.responseEnd);
        if (resourceDetailAvailable(entry)) {
            aggregate.knownTimingCount += 1;
            aggregate.transferBytesKnown += entry.transferSize;
            aggregate.encodedBytesKnown += entry.encodedBodySize;
            aggregate.decodedBytesKnown += entry.decodedBodySize;
            if (entry.transferSize === 0) aggregate.zeroTransferKnownCount += 1;
            else aggregate.networkTransferKnownCount += 1;
        } else aggregate.unknownTimingCount += 1;
    };
    type LcpEntry = PerformanceEntry & { renderTime?: number; loadTime?: number; size?: number; element?: Element; url?: string };
    type WindowLcp = {
        startTimeMs: number | null; observedAtMs: number | null; renderTimeMs: number | null; loadTimeMs: number | null;
        size: number | null; elementKind: string; resourceCategory: string | null; resourceApplicable: boolean;
        resourceStartMs: number | null; resourceRequestStartMs: number | null; resourceResponseEndMs: number | null;
        timingDetailAvailable: boolean; ttfbMs: number | null; resourceLoadDelayMs: number | null;
        resourceLoadDurationMs: number | null; elementRenderDelayMs: number | null;
    };
    let windowLcp: WindowLcp | null = null;
    const navigationEntry = () => performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const collectLcp = (entry: LcpEntry) => {
        if (entry.startTime > cutoffMs || (windowLcp?.startTimeMs ?? -1) > entry.startTime) return;
        const applicable = Boolean(entry.url);
        const resource = applicable
            ? performance.getEntriesByName(entry.url!, 'resource').findLast((candidate) => candidate.startTime <= entry.startTime) as PerformanceResourceTiming | undefined
            : undefined;
        const detailAvailable = Boolean(resource && resource.responseEnd <= cutoffMs && resourceDetailAvailable(resource));
        const responseStart = navigationEntry()?.responseStart;
        const ttfb = responseStart && responseStart <= entry.startTime ? numeric(responseStart) : null;
        const tag = entry.element?.tagName;
        const elementKind = tag === 'IMG' ? 'image' : tag === 'VIDEO' ? 'video'
            : tag === 'SVG' || tag === 'svg' ? 'svg' : applicable ? 'background-image' : tag ? 'text' : 'unavailable';
        windowLcp = {
            startTimeMs: withinWindow(entry.startTime), observedAtMs: numeric(performance.now()),
            renderTimeMs: numeric(entry.renderTime), loadTimeMs: numeric(entry.loadTime), size: numeric(entry.size), elementKind,
            resourceCategory: resource ? classifyResource(resource.name, resource.initiatorType) : applicable ? 'unclassified' : null,
            resourceApplicable: applicable, resourceStartMs: resource ? withinWindow(resource.startTime) : null,
            resourceRequestStartMs: detailAvailable ? numeric(resource!.requestStart) : null,
            resourceResponseEndMs: detailAvailable ? numeric(resource!.responseEnd) : null,
            timingDetailAvailable: detailAvailable, ttfbMs: ttfb,
            resourceLoadDelayMs: null, resourceLoadDurationMs: null, elementRenderDelayMs: null,
        };
        if (ttfb !== null && (!applicable || detailAvailable)) {
            const requestStart = resource?.requestStart ?? ttfb;
            const responseEnd = resource?.responseEnd ?? ttfb;
            windowLcp.resourceLoadDelayMs = numeric(Math.max(0, requestStart - ttfb));
            windowLcp.resourceLoadDurationMs = numeric(Math.max(0, responseEnd - Math.max(requestStart, ttfb)));
            windowLcp.elementRenderDelayMs = numeric(Math.max(0, entry.startTime - Math.max(responseEnd, ttfb)));
        }
    };
    const completedLongTasks: Array<{ startTimeMs: number; durationMs: number }> = [];
    let crossingCutoffCount = 0;
    const supported = typeof PerformanceObserver === 'function' ? PerformanceObserver.supportedEntryTypes ?? [] : [];
    const support = { navigation: Boolean(navigationEntry()), paint: supported.includes('paint'),
        largestContentfulPaint: supported.includes('largest-contentful-paint'), resource: supported.includes('resource'),
        longTask: supported.includes('longtask') };
    const handlers: Record<string, (entry: PerformanceEntry) => void> = {
        paint(entry) {
            if (entry.name === 'first-paint') fpMs = withinWindow(entry.startTime);
            if (entry.name === 'first-contentful-paint') fcpMs = withinWindow(entry.startTime);
        },
        'largest-contentful-paint': collectLcp,
        resource: (entry) => collectResource(entry as PerformanceResourceTiming),
        longtask(entry) {
            if (entry.startTime > cutoffMs) return;
            if (entry.startTime + entry.duration > cutoffMs) { crossingCutoffCount += 1; return; }
            if (completedLongTasks.length >= maxLongTasks) { entryCapReached = true; return; }
            completedLongTasks.push({ startTimeMs: numeric(entry.startTime)!, durationMs: numeric(entry.duration)! });
        },
    };
    for (const [type, handler] of Object.entries(handlers)) {
        if (!supported.includes(type)) continue;
        try {
            const observer = new PerformanceObserver((list) => {
                if (stopped) return;
                const started = performance.now();
                for (const entry of list.getEntries()) handler(entry);
                observerWorkMs += performance.now() - started;
            });
            observer.observe({ type, buffered: true });
            observers.push(observer);
        } catch { errors.add('OBSERVER_REGISTRATION_FAILED'); }
    }

    // Read actual DOM readiness, without retaining text, IDs, coordinates or URLs.
    // Sampling is bounded and its own CPU time is reported. SDK/constructor flags
    // are deliberately separate from visible completed tiles and real markers.
    let readinessSamples = 0;
    let readinessWorkMs = 0;
    let readiness = { observedAtMs: null as number | null, controlsReady: false, mapVisible: false,
        visibleTileCount: 0, visibleMarkerCount: 0, desktopPanelReady: false,
        initialSkeletonVisible: true, desktopPanelAlertCount: 0, desktopPopularItemCount: 0, desktopLatestItemCount: 0 };
    const visible = (element: Element | null) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0
            || rect.top >= innerHeight || rect.left >= innerWidth) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    };
    const inspectReadiness = () => {
        const started = performance.now();
        if (stopped || started > cutoffMs || readinessSamples >= 40) return;
        readinessSamples += 1;
        const data = document.documentElement.dataset;
        const desktop = innerWidth >= 1280;
        const panel = document.querySelector('[data-desktop-left-panel-map-home="true"]');
        const popularCount = panel?.querySelectorAll('button[aria-label$=" 인기 맛집 상세 보기"]').length ?? 0;
        const latestCount = panel?.querySelectorAll('[data-desktop-left-panel-latest-restaurants="true"] [role="button"]').length ?? 0;
        const alertCount = panel?.querySelectorAll('[role="alert"]').length ?? 0;
        const map = document.querySelector('[data-testid="map-container"]');
        let visibleTileCount = 0;
        for (const image of map?.querySelectorAll('img') ?? []) {
            if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth <= 0) continue;
            try {
                const host = new URL(image.currentSrc || image.src, location.href).hostname;
                const rect = image.getBoundingClientRect();
                if (/(^|\.)(?:pstatic\.net|naver\.com|naver\.net|ntruss\.com)$/.test(host)
                    && rect.width >= 100 && rect.height >= 100 && visible(image)) visibleTileCount += 1;
            } catch { /* Unclassifiable images cannot prove provider tile readiness. */ }
        }
        const visibleMarkerCount = [...document.querySelectorAll('button.cluster-marker-container, button.tzudong-individual-marker[data-testid="marker"]')].filter(visible).length;
        const nextReadiness = {
            observedAtMs: null as number | null,
            controlsReady: desktop
                ? data.homeChromeReady === 'true'
                    && visible(document.querySelector('button[data-desktop-map-menu-trigger="true"][aria-haspopup="menu"][aria-expanded]'))
                    && visible(document.querySelector('input[name="desktop-left-panel-restaurant-search"]'))
                : data.homeMobileChromeReady === 'true'
                    && visible(document.querySelector('button[aria-label="맛집 검색 열기"]'))
                    && visible(document.querySelector('[data-mobile-map-sheet-trigger="region"]'))
                    && visible(document.querySelector('[data-mobile-map-sheet-trigger="category"]')),
            mapVisible: visibleTileCount > 0 && visibleMarkerCount > 0,
            visibleTileCount, visibleMarkerCount,
            desktopPanelReady: desktop && data.homePanelReady === 'true' && visible(panel)
                && alertCount === 0 && popularCount > 0 && latestCount > 0,
            initialSkeletonVisible: visible(document.querySelector('[data-home-static-skeleton]')),
            desktopPanelAlertCount: alertCount, desktopPopularItemCount: popularCount, desktopLatestItemCount: latestCount,
        };
        const completedAt = performance.now();
        readinessWorkMs += completedAt - started;
        if (completedAt > cutoffMs) return;
        readiness = { ...nextReadiness, observedAtMs: numeric(completedAt) };
        if (readiness.controlsReady && milestones.controlsReady === null) milestones.controlsReady = numeric(completedAt);
        if (readiness.mapVisible && milestones.mapVisible === null) milestones.mapVisible = numeric(completedAt);
        if (readiness.desktopPanelReady && milestones.desktopPanelReady === null) milestones.desktopPanelReady = numeric(completedAt);
        if (!readiness.initialSkeletonVisible && milestones.initialSkeletonHidden === null) milestones.initialSkeletonHidden = numeric(completedAt);
    };
    const readinessTimer = window.setInterval(inspectReadiness, readinessSamplingIntervalMs);
    cleanups.push(() => window.clearInterval(readinessTimer));
    let fontsReadyMs: number | null = null;
    // This is the initial FontFaceSet.ready promise resolution, not a claim that
    // later lazy content cannot discover additional fonts.
    document.fonts?.ready.then(() => {
        const now = withinWindow(performance.now());
        if (!stopped && now !== null) fontsReadyMs = now;
    }).catch(() => { if (!stopped) errors.add('FONT_READINESS_FAILED'); });

    const freeze = () => {
        if (stopped) return;
        const freezeStarted = performance.now();
        // Browser timers can round a fractional delay down. Keep observing until
        // the actual deadline instead of admitting an early, shorter window.
        if (freezeStarted < cutoffMs) {
            window.setTimeout(freeze, Math.max(1, cutoffMs - freezeStarted));
            return;
        }
        const frozenAtMs = numeric(freezeStarted);
        // Drain before disconnecting, then stop every collector before adding UI.
        for (const observer of observers) {
            for (const entry of observer.takeRecords()) handlers[entry.entryType]?.(entry);
            observer.disconnect();
        }
        for (const cleanup of cleanups) cleanup();
        stopped = true;
        window.__tzudongInitialLoadDiagnostic = { mark() { /* Frozen. */ } };
        const nav = navigationEntry();
        const navigation = nav ? {
            type: ['navigate', 'reload', 'back_forward', 'prerender'].includes(nav.type) ? nav.type : 'unknown',
            startTime: numeric(nav.startTime), redirectCount: count(nav.redirectCount),
            activationStart: numeric((nav as PerformanceNavigationTiming & { activationStart?: number }).activationStart),
            workerStart: numeric(nav.workerStart), domainLookupStart: numeric(nav.domainLookupStart), domainLookupEnd: numeric(nav.domainLookupEnd),
            connectStart: numeric(nav.connectStart), connectEnd: numeric(nav.connectEnd), secureConnectionStart: numeric(nav.secureConnectionStart),
            requestStart: numeric(nav.requestStart), responseStart: numeric(nav.responseStart), responseEnd: withinWindow(nav.responseEnd),
            domInteractive: nav.domInteractive > 0 ? withinWindow(nav.domInteractive) : null,
            domContentLoadedEventEnd: nav.domContentLoadedEventEnd > 0 ? withinWindow(nav.domContentLoadedEventEnd) : null,
            loadEventEnd: nav.loadEventEnd > 0 ? withinWindow(nav.loadEventEnd) : null,
            transferSize: numeric(nav.transferSize), encodedBodySize: numeric(nav.encodedBodySize), decodedBodySize: numeric(nav.decodedBodySize),
        } : null;
        const roundedResources = [...resourceAggregates.values()].map((aggregate) => ({ ...aggregate,
            totalDurationMs: numeric(aggregate.totalDurationMs), firstStartMs: numeric(aggregate.firstStartMs), lastResponseEndMs: numeric(aggregate.lastResponseEndMs) }));
        const finalParams = new URLSearchParams(location.search);
        const contextUnchanged = location.pathname === '/' && finalParams.size === 1 && finalParams.get('__perf') === 'initial-load';
        const snapshot = {
            schemaVersion: 'production-attribution.snapshot.v1', mode: 'initial-load',
            capture: { cutoffMs, observerSetupMs: numeric(observerSetupMs), frozenAtMs, freezeReason: 'deadline',
                instrumentationVersion: '20261115.1', visibilityAtStart, firstHiddenAtMs, trustedInputCount, firstTrustedInputAtMs,
                resizeCount, firstResizeAtMs, resourceBufferOverflow, entryCapReached,
                contextUnchanged, observerWorkMs: numeric(observerWorkMs), readinessWorkMs: numeric(readinessWorkMs),
                readinessSamplingIntervalMs, readinessSamples },
            binding: { gitSha, hostname: ['www.tzudong.app', 'tzudong.app'].includes(location.hostname) ? location.hostname : 'other', pathname: '/' },
            viewport: { initial: initialViewport, final: finalViewport }, support, navigation,
            paints: { fpMs, fcpMs, windowLcp },
            longTasks: support.longTask ? { count: completedLongTasks.length,
                totalDurationMs: numeric(completedLongTasks.reduce((sum, entry) => sum + entry.durationMs, 0)),
                longTaskBlockingSumMs: numeric(completedLongTasks.reduce((sum, entry) => sum + Math.max(0, entry.durationMs - 50), 0)),
                maxDurationMs: numeric(Math.max(0, ...completedLongTasks.map((entry) => entry.durationMs))),
                windowStartMs: 0, windowEndMs: cutoffMs, crossingCutoffCount, completedEntries: completedLongTasks } : null,
            resources: { byCategory: support.resource ? roundedResources : null, overflow: resourceBufferOverflow,
                completedEntriesOnly: true, incompleteRequestCount: null },
            milestones, milestoneCounts, fontsReadyMs, fontReadinessBasis: 'initial-document-fonts-ready-promise',
            completeness: { ...readiness, dataReady: milestones.dataReady !== null && milestones.dataError === null,
                mapConstructed: milestones.mapConstructed !== null && milestones.mapConstructionError === null,
                diagnosticErrors: [...errors].sort() },
            legacyTtiMs: null, legacyTtiStatus: 'not-collected',
        };
        const panel = document.createElement('section');
        panel.id = 'initial-load-diagnostic-panel';
        panel.setAttribute('aria-label', '초기 로딩 진단 결과');
        const heading = document.createElement('h1');
        heading.textContent = '초기 로딩 진단 · 20초 관측 완료';
        const note = document.createElement('p');
        note.textContent = '이 화면을 표시하기 전에 관측을 종료했습니다. 수치는 이 방문의 고정 관측 구간이며, TTI 또는 실제 사용자 전체 통계가 아닙니다.';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '진단 결과 닫기';
        close.addEventListener('click', () => panel.remove(), { once: true });
        const pre = document.createElement('pre');
        pre.id = 'initial-load-diagnostic-result';
        pre.textContent = JSON.stringify(snapshot, null, 2);
        const style = document.createElement('style');
        if (nonce) style.nonce = nonce;
        style.textContent = '#initial-load-diagnostic-panel{position:fixed;inset:12px;z-index:2147483647;overflow:auto;padding:16px;background:#fff;color:#111;border:2px solid #333;font:14px/1.5 system-ui;box-sizing:border-box}#initial-load-diagnostic-panel h1{font-size:18px}#initial-load-diagnostic-panel button{padding:8px 12px;border:1px solid #555;background:#fff;color:#111}#initial-load-diagnostic-result{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 monospace}';
        panel.append(style, heading, note, close, pre);
        (document.body ?? document.documentElement).append(panel);
    };
    window.setTimeout(freeze, Math.max(0, cutoffMs - performance.now()));
}

export function buildInitialLoadDiagnosticScript(release: string | undefined): string {
    const gitSha = release && /^[a-f0-9]{40}$/.test(release) ? release : null;
    return `(${installInitialLoadDiagnostic.toString()})(${JSON.stringify(gitSha)});`.replace(/<\/script/gi, '<\\/script');
}
