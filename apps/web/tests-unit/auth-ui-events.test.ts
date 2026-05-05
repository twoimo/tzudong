import { describe, expect, test } from 'bun:test';

import { AUTH_UI_REQUEST_EVENT, createAuthUiRequestDetail } from '../lib/auth-ui-events';
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
});
