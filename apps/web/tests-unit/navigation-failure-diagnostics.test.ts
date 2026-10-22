import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { Page } from '@playwright/test';
import {
    NavigationFailureJournal,
    startNavigationFailureObserver,
    withNavigationFailureObserver,
} from '../tests/nightly/navigation-failure-diagnostics';

const PRIVATE_SENTINEL = 'PRIVATE_SENTINEL_UNLIKE_A_CREDENTIAL_4917';

describe('bounded Nightly navigation diagnostics', () => {
    test('records only fixed classes after inspecting navigation, stack, console, HMR and RSC inputs', () => {
        const journal = new NavigationFailureJournal();
        journal.recordFrameNavigation(`${PRIVATE_SENTINEL}-reason`);
        journal.recordDocumentRequest({
            stack: {
                callFrames: [{
                    functionName: 'performFullReload',
                    url: `http://localhost/${PRIVATE_SENTINEL}`,
                    scriptId: PRIVATE_SENTINEL,
                }],
            },
        });
        journal.recordConsole(`Failed to fetch RSC payload for ${PRIVATE_SENTINEL}. Falling back to browser navigation.`);
        journal.recordHmrFrame(JSON.stringify({
            type: 'sync',
            hash: `${PRIVATE_SENTINEL}-hash-a`,
            url: `http://localhost/?private=${PRIVATE_SENTINEL}`,
            headers: { cookie: PRIVATE_SENTINEL },
        }));
        journal.recordHmrFrame(JSON.stringify({ type: 'built', hash: `${PRIVATE_SENTINEL}-hash-b` }));
        journal.recordRscResponse(200, `text/html;private=${PRIVATE_SENTINEL}`, true);

        expect(journal.snapshot().events).toEqual([
            { kind: 'frame-navigation', reason: 'other' },
            { kind: 'document-request', initiator: 'hmr-perform-full-reload' },
            { kind: 'console', code: 'failed-rsc-browser-navigation' },
            { kind: 'hmr-message', type: 'sync', globalSyncHashChanged: false, socketSyncHashChanged: false },
            { kind: 'hmr-message', type: 'built', globalSyncHashChanged: false, socketSyncHashChanged: false },
            { kind: 'rsc-response', status: 200, mime: 'html', redirect: true },
        ]);
        expect(JSON.stringify(journal.snapshot())).not.toContain(PRIVATE_SENTINEL);
        expect(JSON.stringify(journal.snapshot())).not.toContain('localhost');
        expect(JSON.stringify(journal.snapshot())).not.toContain('cookie');
    });

    test('ignores unrecognized HMR content and caps ordered events at 32', () => {
        const journal = new NavigationFailureJournal();
        journal.recordHmrFrame(JSON.stringify({ type: PRIVATE_SENTINEL, hash: PRIVATE_SENTINEL }));
        journal.recordHmrFrame('{invalid-json');
        for (let index = 0; index < 40; index += 1) {
            journal.recordFrameNavigation(index < 8 ? 'reload' : index === 39 ? 'anchorClick' : 'scriptInitiated');
        }

        const snapshot = journal.snapshot();
        expect(snapshot.events).toHaveLength(32);
        expect(snapshot.events[0]).toEqual({ kind: 'frame-navigation', reason: 'scriptInitiated' });
        expect(snapshot.events[31]).toEqual({ kind: 'frame-navigation', reason: 'anchorClick' });
        expect(snapshot.overflow).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain(PRIVATE_SENTINEL);

        (snapshot.events[0] as { reason: string }).reason = PRIVATE_SENTINEL;
        expect(JSON.stringify(journal.snapshot())).not.toContain(PRIVATE_SENTINEL);
    });

    test('labels unavailable CDP without exposing an error', () => {
        const journal = new NavigationFailureJournal();
        journal.markUnavailable('not-chromium');
        expect(journal.snapshot()).toMatchObject({
            availability: 'unavailable',
            unavailableReason: 'not-chromium',
            events: [],
        });
    });

    test('compares only consecutive sync hashes from the same HMR socket', () => {
        const journal = new NavigationFailureJournal();
        journal.recordHmrFrame(JSON.stringify({ type: 'sync', hash: 'A' }), 'socket-one');
        journal.recordHmrFrame(JSON.stringify({ type: 'built', hash: 'B' }), 'socket-one');
        journal.recordHmrFrame(JSON.stringify({ type: 'sync', hash: 'C' }), 'socket-two');
        journal.recordHmrFrame(JSON.stringify({ type: 'sync', hash: 'A' }), 'socket-one');
        journal.recordHmrFrame(JSON.stringify({ type: 'sync', hash: 'D' }), 'socket-one');

        expect(journal.snapshot().events.map((event) =>
            event.kind === 'hmr-message'
                ? [event.globalSyncHashChanged, event.socketSyncHashChanged]
                : null,
        )).toEqual([
            [false, false], [false, false], [true, false], [false, false], [true, true],
        ]);
        expect(JSON.stringify(journal.snapshot())).not.toContain('socket-one');
        expect(JSON.stringify(journal.snapshot())).not.toContain('socket-two');
    });

    test('keeps the Next sync baseline across a websocket reconnect', () => {
        const journal = new NavigationFailureJournal();
        journal.recordHmrFrame(JSON.stringify({ type: 'sync', hash: 'before' }), 'old-socket');
        journal.forgetHmrSocket('old-socket');
        journal.recordHmrFrame(JSON.stringify({ type: 'built', hash: 'unrelated' }), 'new-socket');
        journal.recordHmrFrame(JSON.stringify({ type: 'sync', hash: 'after' }), 'new-socket');
        expect(journal.snapshot().events[2]).toEqual({
            kind: 'hmr-message', type: 'sync', globalSyncHashChanged: true, socketSyncHashChanged: false,
        });
        expect(JSON.stringify(journal.snapshot())).not.toContain('old-socket');
        expect(JSON.stringify(journal.snapshot())).not.toContain('new-socket');
    });

    test('reduces RSC failure reasons and scope to fixed values', () => {
        const journal = new NavigationFailureJournal();
        journal.recordRscFailure(false, 'net::ERR_BLOCKED_BY_CLIENT', PRIVATE_SENTINEL, 'admin');
        journal.recordRscFailure(true, 'net::ERR_ABORTED', undefined, 'other');
        journal.recordRscFailure(false, PRIVATE_SENTINEL, undefined, 'home');
        expect(journal.snapshot().events).toEqual([
            { kind: 'rsc-failed', canceled: false, class: 'blocked-by-client', scope: 'admin' },
            { kind: 'rsc-failed', canceled: true, class: 'aborted', scope: 'other' },
            { kind: 'rsc-failed', canceled: false, class: 'other', scope: 'home' },
        ]);
        expect(JSON.stringify(journal.snapshot())).not.toContain(PRIVATE_SENTINEL);
    });

    test('distinguishes CDP policy blocks from confirmed client blocks', () => {
        const journal = new NavigationFailureJournal();
        for (const reason of ['csp', 'mixed-content', 'corp-not-same-origin', 'coep-frame-resource-needs-coep-header', 'integrity']) {
            journal.recordRscFailure(false, PRIVATE_SENTINEL, reason, 'admin');
        }
        journal.recordRscFailure(false, 'net::ERR_BLOCKED_BY_CLIENT', 'csp', 'admin');
        journal.recordRscFailure(false, PRIVATE_SENTINEL, 'inspector', 'admin');
        journal.recordRscFailure(false, 'net::ERR_BLOCKED_BY_CLIENT', undefined, 'admin');
        expect(journal.snapshot().events.map((event) => event.kind === 'rsc-failed' && event.class)).toEqual([
            'blocked-by-policy', 'blocked-by-policy', 'blocked-by-policy', 'blocked-by-policy',
            'blocked-by-policy', 'blocked-by-policy', 'blocked-by-client', 'blocked-by-client',
        ]);
        expect(JSON.stringify(journal.snapshot())).not.toContain(PRIVATE_SENTINEL);
    });

    test('keeps unknown block reasons non-attributive without retaining their contents', () => {
        const journal = new NavigationFailureJournal();
        for (const reason of [PRIVATE_SENTINEL, 'other', '', null, undefined, { private: PRIVATE_SENTINEL }]) {
            journal.recordRscFailure(false, PRIVATE_SENTINEL, reason, 'home');
        }
        expect(journal.snapshot().events).toEqual(Array.from({ length: 6 }, () => ({
            kind: 'rsc-failed', canceled: false, class: 'other', scope: 'home',
        })));
        expect(JSON.stringify(journal.snapshot())).not.toContain(PRIVATE_SENTINEL);
    });

    test('collects tracked RSC failure and client full reload, then detaches actual listeners', async () => {
        const session = new EventEmitter() as EventEmitter & {
            detached?: boolean;
            send: (method: string) => Promise<unknown>;
            detach: () => Promise<void>;
        };
        session.send = async (method) => method === 'Page.getFrameTree'
            ? { frameTree: { frame: { id: 'main' } } }
            : {};
        session.detach = async () => { session.detached = true; };
        const pageEvents = new EventEmitter();
        const page = Object.assign(pageEvents, {
            context: () => ({
                browser: () => ({ browserType: () => ({ name: () => 'chromium' }) }),
                newCDPSession: async () => session,
            }),
        }) as unknown as Page;

        const observer = await startNavigationFailureObserver(page, 'http://localhost:3000');
        session.emit('Network.webSocketCreated', {
            requestId: 'ws', url: 'ws://localhost:3000/_next/hmr',
        });
        session.emit('Network.webSocketCreated', {
            requestId: 'other-ws', url: 'ws://localhost:3000/_next/hmr',
        });
        const receiveSync = (requestId: string, hash: string) => {
            session.emit('Network.webSocketFrameReceived', {
                requestId,
                response: { opcode: 1, payloadData: JSON.stringify({ type: 'sync', hash }) },
            });
        };
        receiveSync('ws', 'first');
        receiveSync('other-ws', 'second');
        receiveSync('ws', 'first');
        receiveSync('ws', 'changed');
        session.emit('Network.webSocketFrameSent', {
            requestId: 'ws',
            response: {
                opcode: 1,
                payloadData: JSON.stringify({
                    event: 'client-full-reload',
                    hadRuntimeError: true,
                    stackTrace: PRIVATE_SENTINEL,
                }),
            },
        });
        session.emit('Network.requestWillBeSent', {
            requestId: 'rsc', frameId: 'main', type: 'Fetch', initiator: {},
            request: {
                url: `http://localhost:3000/?_rsc=${PRIVATE_SENTINEL}`,
                headers: { RSC: '1', cookie: PRIVATE_SENTINEL },
            },
        });
        session.emit('Network.responseReceived', {
            requestId: 'rsc', response: { status: 200, mimeType: 'text/x-component' },
        });
        session.emit('Network.loadingFailed', {
            requestId: 'rsc', canceled: false, errorText: 'net::ERR_CONNECTION_RESET',
            blockedReason: undefined,
        });
        expect(observer.snapshot().events).toContainEqual({ kind: 'hmr-client-full-reload', hadRuntimeError: true });
        expect(observer.snapshot().events).toContainEqual({
            kind: 'rsc-response', status: 200, mime: 'rsc', redirect: false,
        });
        expect(observer.snapshot().events).toContainEqual({
            kind: 'rsc-failed', canceled: false, class: 'connection', scope: 'home',
        });
        expect(observer.snapshot().events.filter((event) => event.kind === 'hmr-message')
            .map((event) => event.kind === 'hmr-message'
                && [event.globalSyncHashChanged, event.socketSyncHashChanged]))
            .toEqual([[false, false], [true, false], [false, false], [true, true]]);
        expect(JSON.stringify(observer.snapshot())).not.toContain(PRIVATE_SENTINEL);

        await observer.stop();
        expect(session.detached).toBe(true);
        expect(session.listenerCount('Network.webSocketFrameSent')).toBe(0);
        expect(session.listenerCount('Network.loadingFailed')).toBe(0);
        expect(pageEvents.listenerCount('console')).toBe(0);
        session.emit('Network.loadingFailed', { requestId: 'rsc', canceled: true });
        expect(observer.snapshot().events).toHaveLength(7);
    });

    test('cleans up after setup failure and preserves outcomes when diagnostics throw', async () => {
        const originalFailure = new Error('setup failure');
        let stopped = false;
        let attachedFailure = false;
        const fakePage = {} as Page;
        try {
            await withNavigationFailureObserver(
                fakePage,
                undefined,
                async () => { throw originalFailure; },
                async (_snapshot, failed) => { attachedFailure = failed; },
                async () => ({
                    snapshot: () => new NavigationFailureJournal().snapshot(),
                    stop: async () => { stopped = true; },
                }),
            );
        } catch (error) {
            expect(error).toBe(originalFailure);
        }
        expect(stopped).toBe(true);
        expect(attachedFailure).toBe(true);

        const result = await withNavigationFailureObserver(
            fakePage,
            undefined,
            async () => 7,
            async (snapshot) => {
                expect(snapshot.availability).toBe('unavailable');
                throw new Error('attachment failure');
            },
            async () => ({
                snapshot: () => { throw new Error('snapshot failure'); },
                stop: async () => { throw new Error('stop failure'); },
            }),
        );
        expect(result).toBe(7);
    });
});
