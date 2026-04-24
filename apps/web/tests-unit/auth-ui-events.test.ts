import { describe, expect, test } from 'bun:test';

import { AUTH_UI_REQUEST_EVENT, createAuthUiRequestDetail } from '../lib/auth-ui-events';

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
});
