import { describe, expect, test } from 'bun:test';

import { AUTH_UI_REQUEST_EVENT, createAuthUiRequestDetail, requestAuthUi } from '../lib/auth-ui-events';
import { HOME_AUTH_SESSION_UPDATED_EVENT, dispatchHomeAuthSessionUpdated } from '../lib/home-auth-events';

describe('auth ui request events', () => {
    test('uses a stable global event name for login prompts', () => {
        expect(AUTH_UI_REQUEST_EVENT).toBe('tzudong:auth-request');
    });

    test('preserves caller metadata and fills a timestamp', () => {
        const detail = createAuthUiRequestDetail({
            source: 'mobile-bottom-nav-my',
            route: '/feed',
            reason: 'mypage',
            ts: 123,
        });

        expect(detail).toEqual({
            source: 'mobile-bottom-nav-my',
            route: '/feed',
            reason: 'mypage',
            ts: 123,
        });
    });

    test('dispatches explicit home auth session state for lazy home providers', () => {
        const originalWindow = globalThis.window;
        let receivedEvent: Event | null = null;

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                dispatchEvent(event: Event) {
                    receivedEvent = event;
                    return true;
                },
            },
        });

        try {
            dispatchHomeAuthSessionUpdated({ hasSession: true, source: 'unit-test' });
        } finally {
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: originalWindow,
            });
        }

        expect(receivedEvent).toBeInstanceOf(CustomEvent);
        expect(receivedEvent?.type).toBe(HOME_AUTH_SESSION_UPDATED_EVENT);
        expect((receivedEvent as CustomEvent).detail).toEqual({
            hasSession: true,
            source: 'unit-test',
        });
    });

    test('defers login prompts briefly when a Supabase session hint exists', () => {
        const originalWindow = globalThis.window;
        const listeners = new Map<string, EventListener>();
        const dispatchedEvents: Event[] = [];
        let timeoutCallback: (() => void) | null = null;
        let clearTimeoutCalls = 0;

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                localStorage: {
                    length: 1,
                    key: () => 'sb-test-auth-token',
                    getItem: () => '{"access_token":"token"}',
                },
                addEventListener(type: string, listener: EventListener) {
                    listeners.set(type, listener);
                },
                removeEventListener(type: string) {
                    listeners.delete(type);
                },
                dispatchEvent(event: Event) {
                    dispatchedEvents.push(event);
                    return true;
                },
                setTimeout(callback: () => void) {
                    timeoutCallback = callback;
                    return 0;
                },
                clearTimeout() {
                    clearTimeoutCalls += 1;
                    timeoutCallback = null;
                },
            },
        });

        try {
            requestAuthUi({ source: 'bookmark-button', reason: 'bookmark' });
            expect(dispatchedEvents).toHaveLength(0);

            listeners.get(HOME_AUTH_SESSION_UPDATED_EVENT)?.(
                new CustomEvent(HOME_AUTH_SESSION_UPDATED_EVENT, { detail: { hasSession: true } }),
            );
            timeoutCallback?.();

            expect(dispatchedEvents).toHaveLength(0);
            expect(clearTimeoutCalls).toBe(1);
        } finally {
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: originalWindow,
            });
        }
    });

    test('opens the login prompt after the grace period when a session hint is stale', () => {
        const originalWindow = globalThis.window;
        const dispatchedEvents: Event[] = [];

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                localStorage: {
                    length: 1,
                    key: () => 'sb-test-auth-token',
                    getItem: () => '{"access_token":"token"}',
                },
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent(event: Event) {
                    dispatchedEvents.push(event);
                    return true;
                },
                setTimeout(callback: () => void) {
                    callback();
                    return 1;
                },
                clearTimeout() {},
            },
        });

        try {
            requestAuthUi({ source: 'desktop-map-user-menu', route: '/', reason: 'mypage' });
        } finally {
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: originalWindow,
            });
        }

        expect(dispatchedEvents).toHaveLength(1);
        expect(dispatchedEvents[0]).toBeInstanceOf(CustomEvent);
        expect(dispatchedEvents[0]?.type).toBe(AUTH_UI_REQUEST_EVENT);
    });

    test('forces known logged-out desktop prompts without waiting for stale session hints', () => {
        const originalWindow = globalThis.window;
        const dispatchedEvents: Event[] = [];
        let retryScheduled = false;

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                localStorage: {
                    length: 1,
                    key: () => 'sb-test-auth-token',
                    getItem: () => '{"access_token":"token"}',
                },
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent(event: Event) {
                    dispatchedEvents.push(event);
                    return true;
                },
                setTimeout() {
                    retryScheduled = true;
                    return 1;
                },
                clearTimeout() {},
            },
        });

        try {
            requestAuthUi({ source: 'desktop-map-user-menu', reason: 'mypage', force: true });
        } finally {
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: originalWindow,
            });
        }

        expect(retryScheduled).toBe(true);
        expect(dispatchedEvents).toHaveLength(1);
        expect((dispatchedEvents[0] as CustomEvent).detail).toMatchObject({
            source: 'desktop-map-user-menu',
            reason: 'mypage',
            force: true,
        });
    });
});
