import { createHash } from 'node:crypto';
import type { CDPSession, Page } from '@playwright/test';

const MAX_EVENTS = 32;
const MAX_HMR_FRAME_BYTES = 16_384;
const RSC_POLICY_BLOCK_REASONS = new Set([
    'csp', 'mixed-content', 'origin', 'integrity', 'subresource-filter', 'content-type',
    'coep-frame-resource-needs-coep-header',
    'coop-sandboxed-iframe-cannot-navigate-to-coop-page',
    'corp-not-same-origin', 'corp-not-same-origin-after-defaulted-to-same-origin-by-coep',
    'corp-not-same-origin-after-defaulted-to-same-origin-by-dip',
    'corp-not-same-origin-after-defaulted-to-same-origin-by-coep-and-dip',
    'corp-not-same-site', 'sri-message-signature-mismatch',
]);
const NAVIGATION_REASONS = new Set([
    'anchorClick', 'formSubmissionGet', 'formSubmissionPost', 'httpHeaderRefresh',
    'initialFrameNavigation', 'metaTagRefresh', 'other', 'pageBlockInterstitial',
    'reload', 'scriptInitiated',
]);
const HMR_TYPES = new Set([
    'addedPage', 'removedPage', 'reloadPage', 'serverComponentChanges',
    'staticParamsChanged', 'middlewareChanges', 'clientChanges', 'serverOnlyChanges',
    'sync', 'built', 'building', 'devPagesManifestUpdate', 'turbopack-message',
    'serverError', 'turbopack-connected', 'isrManifest', 'cacheIndicator',
    'devIndicator', 'devtoolsConfig', 'requestCurrentErrorState',
    'requestPageMetadata', 'requestInsightsUpdate',
]);

type InitiatorClass = 'hmr-perform-full-reload' | 'hmr-handle-message'
    | 'hmr-handle-disconnect' | 'router-fallback' | 'app-recovery' | 'other';
type MimeClass = 'rsc' | 'html' | 'other';
type RscScope = 'home' | 'admin' | 'other';
type RscFailureClass = 'blocked-by-client' | 'blocked-by-policy' | 'aborted' | 'connection' | 'other';
type NavigationEvent =
    | { kind: 'frame-navigation'; reason: string }
    | { kind: 'document-request'; initiator: InitiatorClass }
    | { kind: 'console'; code: string }
    | { kind: 'hmr-message'; type: string; globalSyncHashChanged: boolean; socketSyncHashChanged: boolean }
    | { kind: 'hmr-client-full-reload'; hadRuntimeError: boolean }
    | { kind: 'rsc-response'; status: number; mime: MimeClass; redirect: boolean }
    | { kind: 'rsc-failed'; canceled: boolean; class: RscFailureClass; scope: RscScope };

export type NavigationFailureSnapshot = Readonly<{
    schema: 'nightly-navigation-failure-v2';
    availability: 'active' | 'unavailable';
    unavailableReason: 'not-chromium' | 'cdp-unavailable' | 'cdp-closed' | null;
    events: readonly NavigationEvent[];
    overflow: boolean;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function classifyInitiator(value: unknown): InitiatorClass {
    let stack: unknown = asRecord(value)?.stack;
    for (let depth = 0; depth < 3; depth += 1) {
        const trace = asRecord(stack);
        if (!trace) break;
        const frames = Array.isArray(trace.callFrames) ? trace.callFrames.slice(0, 12) : [];
        for (const frame of frames) {
            const name = asRecord(frame)?.functionName;
            if (name === 'performFullReload') return 'hmr-perform-full-reload';
            if (name === 'handleMessage') return 'hmr-handle-message';
            if (name === 'handleDisconnect') return 'hmr-handle-disconnect';
            if (name === 'handleHardNavError' || name === 'HistoryUpdater') return 'router-fallback';
            if (name === 'tryRecoveryReload' || name === 'RootError' || name === 'GlobalError') {
                return 'app-recovery';
            }
        }
        stack = trace.parent;
    }
    return 'other';
}

function classifyConsole(message: unknown): NavigationEvent | null {
    if (typeof message !== 'string') return null;
    if (message.includes('performing full reload because your application had an unrecoverable error')) {
        return { kind: 'console', code: 'unrecoverable-reload' };
    }
    if (message.includes('[Fast Refresh] performing full reload')
        || message.includes('Fast Refresh had to perform a full reload')) {
        return { kind: 'console', code: 'fast-refresh-full-reload' };
    }
    if (message.includes('Failed to fetch RSC payload')
        && message.includes('Falling back to browser navigation')) {
        return { kind: 'console', code: 'failed-rsc-browser-navigation' };
    }
    if (message.includes('Error occurred during navigation, falling back to hard navigation')) {
        return { kind: 'console', code: 'browser-navigation-fallback' };
    }
    return null;
}

function mimeClass(value: unknown): MimeClass {
    if (typeof value !== 'string') return 'other';
    const mime = value.toLowerCase().split(';', 1)[0]?.trim();
    if (mime === 'text/x-component') return 'rsc';
    if (mime === 'text/html') return 'html';
    return 'other';
}

function rscFailureClass(errorText: unknown, blockedReason: unknown): RscFailureClass {
    // A specific CDP policy reason takes precedence over a generic blocking error.
    if (typeof blockedReason === 'string' && RSC_POLICY_BLOCK_REASONS.has(blockedReason)) {
        return 'blocked-by-policy';
    }
    if (errorText === 'net::ERR_BLOCKED_BY_CLIENT' || blockedReason === 'inspector') {
        return 'blocked-by-client';
    }
    if (errorText === 'net::ERR_ABORTED') return 'aborted';
    if (typeof errorText === 'string' && /^net::ERR_(CONNECTION_|INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|TIMED_OUT|ADDRESS_UNREACHABLE)/.test(errorText)) {
        return 'connection';
    }
    return 'other';
}

export class NavigationFailureJournal {
    private readonly events: NavigationEvent[] = [];
    private overflow = false;
    private nextEventIndex = 0;
    private availability: NavigationFailureSnapshot['availability'] = 'active';
    private unavailableReason: NavigationFailureSnapshot['unavailableReason'] = null;
    private previousGlobalSyncHashDigest: string | null = null;
    private readonly previousSyncHashBySocket = new Map<string, string>();

    private append(event: NavigationEvent): void {
        if (this.events.length < MAX_EVENTS) {
            this.events.push(event);
            return;
        }
        this.events[this.nextEventIndex] = event;
        this.nextEventIndex = (this.nextEventIndex + 1) % MAX_EVENTS;
        this.overflow = true;
    }

    markUnavailable(reason: NonNullable<NavigationFailureSnapshot['unavailableReason']>): void {
        this.availability = 'unavailable';
        this.unavailableReason = reason;
    }

    recordFrameNavigation(reason: unknown): void {
        this.append({
            kind: 'frame-navigation',
            reason: typeof reason === 'string' && NAVIGATION_REASONS.has(reason) ? reason : 'other',
        });
    }

    recordDocumentRequest(initiator: unknown): void {
        this.append({ kind: 'document-request', initiator: classifyInitiator(initiator) });
    }

    recordConsole(message: unknown): void {
        const event = classifyConsole(message);
        if (event) this.append(event);
    }

    recordHmrFrame(payload: unknown, requestId = 'direct-call'): void {
        if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > MAX_HMR_FRAME_BYTES) return;
        let value: unknown;
        try { value = JSON.parse(payload); } catch { return; }
        const message = asRecord(value);
        if (!message || typeof message.type !== 'string' || !HMR_TYPES.has(message.type)) return;
        let globalSyncHashChanged = false;
        let socketSyncHashChanged = false;
        if (message.type === 'sync' && typeof message.hash === 'string' && message.hash.length <= 256) {
            const digest = createHash('sha256').update(message.hash).digest('hex');
            globalSyncHashChanged = this.previousGlobalSyncHashDigest !== null
                && this.previousGlobalSyncHashDigest !== digest;
            // Next reloads before replacing mostRecentCompilationHash on a mismatch.
            if (!globalSyncHashChanged) this.previousGlobalSyncHashDigest = digest;
            const key = socketKey(requestId);
            const previousSocketSyncHash = this.previousSyncHashBySocket.get(key);
            socketSyncHashChanged = previousSocketSyncHash !== undefined && previousSocketSyncHash !== digest;
            if (previousSocketSyncHash !== undefined || this.previousSyncHashBySocket.size < 8) {
                this.previousSyncHashBySocket.set(key, digest);
            }
        }
        this.append({ kind: 'hmr-message', type: message.type, globalSyncHashChanged, socketSyncHashChanged });
    }

    forgetHmrSocket(requestId: string): void {
        this.previousSyncHashBySocket.delete(createHash('sha256').update(requestId).digest('hex'));
    }

    recordHmrClientFrame(payload: unknown): void {
        if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > MAX_HMR_FRAME_BYTES) return;
        let value: unknown;
        try { value = JSON.parse(payload); } catch { return; }
        const message = asRecord(value);
        if (message?.event !== 'client-full-reload' || typeof message.hadRuntimeError !== 'boolean') return;
        this.append({ kind: 'hmr-client-full-reload', hadRuntimeError: message.hadRuntimeError });
    }

    recordRscResponse(status: unknown, mime: unknown, redirect: unknown): void {
        if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) return;
        this.append({ kind: 'rsc-response', status, mime: mimeClass(mime), redirect: redirect === true });
    }

    recordRscFailure(canceled: unknown, errorText: unknown, blockedReason: unknown, scope: RscScope): void {
        this.append({
            kind: 'rsc-failed',
            canceled: canceled === true,
            class: rscFailureClass(errorText, blockedReason),
            scope,
        });
    }

    snapshot(): NavigationFailureSnapshot {
        const orderedEvents = this.overflow
            ? [...this.events.slice(this.nextEventIndex), ...this.events.slice(0, this.nextEventIndex)]
            : this.events;
        return {
            schema: 'nightly-navigation-failure-v2',
            availability: this.availability,
            unavailableReason: this.unavailableReason,
            events: orderedEvents.map((event) => ({ ...event })),
            overflow: this.overflow,
        };
    }
}

function rscRequestScope(url: unknown, headers: unknown, appOrigin: string | undefined): RscScope | null {
    if (typeof url !== 'string' || !appOrigin) return null;
    try {
        const parsed = new URL(url);
        if (parsed.origin !== appOrigin) return null;
        const requestHeaders = asRecord(headers);
        const hasRscHeader = requestHeaders && Object.entries(requestHeaders).some(
            ([name, value]) => name.toLowerCase() === 'rsc' && value === '1',
        );
        if (!parsed.searchParams.has('_rsc') && hasRscHeader !== true) return null;
        if (parsed.pathname === '/') return 'home';
        if (parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/')) return 'admin';
        return 'other';
    } catch { return null; }
}

function isNextHmrSocket(url: unknown): boolean {
    if (typeof url !== 'string') return false;
    try {
        const path = new URL(url).pathname;
        return path === '/_next/hmr' || path === '/_next/webpack-hmr';
    } catch { return false; }
}

function socketKey(requestId: string): string {
    return createHash('sha256').update(requestId).digest('hex');
}

export type NavigationFailureObserver = {
    snapshot: () => NavigationFailureSnapshot;
    stop: () => Promise<void>;
};

export async function startNavigationFailureObserver(page: Page, appOrigin?: string): Promise<NavigationFailureObserver> {
    const journal = new NavigationFailureJournal();
    const onConsole = (message: { text: () => string }) => journal.recordConsole(message.text());
    page.on('console', onConsole);
    let session: CDPSession | null = null;
    let stopping = false;
    const onSessionClose = () => {
        if (!stopping) journal.markUnavailable('cdp-closed');
    };
    const listeners: Array<[string, (payload: never) => void]> = [];
    const addListener = (event: string, callback: (payload: never) => void) => {
        session?.on(event as never, callback);
        listeners.push([event, callback]);
    };

    try {
        if (page.context().browser()?.browserType().name() !== 'chromium') {
            journal.markUnavailable('not-chromium');
        } else {
            session = await page.context().newCDPSession(page);
            session.on('close', onSessionClose);
            await session.send('Page.enable');
            await session.send('Network.enable');
            try { await session.send('Debugger.enable'); } catch { /* Stack classification falls back to other. */ }
            const { frameTree } = await session.send('Page.getFrameTree');
            const mainFrameId = frameTree.frame.id;
            const rscRequests = new Map<string, { redirected: boolean; scope: RscScope }>();
            const hmrSockets = new Set<string>();

            addListener('Page.frameRequestedNavigation', (payload: never) => {
                const event = payload as { frameId: string; reason: unknown };
                if (event.frameId === mainFrameId) journal.recordFrameNavigation(event.reason);
            });
            addListener('Network.requestWillBeSent', (payload: never) => {
                const event = payload as {
                    requestId: string; frameId?: string; type?: string;
                    initiator: unknown; request: { url: string; headers: unknown };
                    redirectResponse?: unknown;
                };
                if (event.type === 'Document' && event.frameId === mainFrameId) {
                    journal.recordDocumentRequest(event.initiator);
                }
                const key = socketKey(event.requestId);
                const tracked = rscRequests.get(key);
                if (tracked) {
                    tracked.redirected = true;
                } else {
                    const scope = rscRequestScope(event.request?.url, event.request?.headers, appOrigin);
                    if (scope && rscRequests.size < 64) {
                        rscRequests.set(key, { redirected: Boolean(event.redirectResponse), scope });
                    }
                }
            });
            addListener('Network.responseReceived', (payload: never) => {
                const event = payload as {
                    requestId: string; response: { status: number; mimeType: string };
                };
                const tracked = rscRequests.get(socketKey(event.requestId));
                if (!tracked) return;
                journal.recordRscResponse(
                    event.response?.status,
                    event.response?.mimeType,
                    tracked.redirected || (event.response?.status >= 300 && event.response?.status < 400),
                );
            });
            addListener('Network.loadingFinished', (payload: never) => {
                rscRequests.delete(socketKey((payload as { requestId: string }).requestId));
            });
            addListener('Network.loadingFailed', (payload: never) => {
                const event = payload as {
                    requestId: string; canceled?: boolean; errorText?: string; blockedReason?: string;
                };
                const key = socketKey(event.requestId);
                const tracked = rscRequests.get(key);
                if (!tracked) return;
                journal.recordRscFailure(event.canceled, event.errorText, event.blockedReason, tracked.scope);
                rscRequests.delete(key);
            });
            addListener('Network.webSocketCreated', (payload: never) => {
                const event = payload as { requestId: string; url: string };
                if (isNextHmrSocket(event.url) && hmrSockets.size < 8) hmrSockets.add(socketKey(event.requestId));
            });
            addListener('Network.webSocketFrameReceived', (payload: never) => {
                const event = payload as { requestId: string; response: { opcode: number; payloadData: string } };
                if (hmrSockets.has(socketKey(event.requestId)) && event.response?.opcode === 1) {
                    journal.recordHmrFrame(event.response.payloadData, event.requestId);
                }
            });
            addListener('Network.webSocketFrameSent', (payload: never) => {
                const event = payload as { requestId: string; response: { opcode: number; payloadData: string } };
                if (hmrSockets.has(socketKey(event.requestId)) && event.response?.opcode === 1) {
                    journal.recordHmrClientFrame(event.response.payloadData);
                }
            });
            addListener('Network.webSocketClosed', (payload: never) => {
                const requestId = (payload as { requestId: string }).requestId;
                hmrSockets.delete(socketKey(requestId));
                journal.forgetHmrSocket(requestId);
            });
        }
    } catch {
        journal.markUnavailable('cdp-unavailable');
    }

    return {
        snapshot: () => journal.snapshot(),
        stop: async () => {
            stopping = true;
            try { page.off('console', onConsole); } catch { /* Page already closed. */ }
            for (const [event, callback] of listeners) {
                try { session?.off(event as never, callback); } catch { /* Session already closed. */ }
            }
            try { session?.off('close', onSessionClose); } catch { /* Session already closed. */ }
            try { await session?.detach(); } catch { /* Page or session already closed. */ }
        },
    };
}

export async function withNavigationFailureObserver<T>(
    page: Page,
    appOrigin: string | undefined,
    run: () => Promise<T>,
    finish: (snapshot: NavigationFailureSnapshot, failed: boolean) => Promise<void>,
    start: (page: Page, appOrigin?: string) => Promise<NavigationFailureObserver> = startNavigationFailureObserver,
): Promise<T> {
    let observer: NavigationFailureObserver | null = null;
    try { observer = await start(page, appOrigin); } catch { /* Observation is optional. */ }
    let failed = false;
    try {
        return await run();
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        let snapshot: NavigationFailureSnapshot;
        try {
            if (!observer) throw new Error('observer-unavailable');
            snapshot = observer.snapshot();
        } catch {
            const unavailable = new NavigationFailureJournal();
            unavailable.markUnavailable('cdp-unavailable');
            snapshot = unavailable.snapshot();
        }
        try { await observer?.stop(); } catch { /* Keep the original test result. */ }
        try { await finish(snapshot, failed); } catch { /* Keep the original test result. */ }
    }
}
