import { describe, expect, test } from 'bun:test';

import {
    countUniqueNaverPresenceUsers,
    getNaverPresenceIdentity,
} from '../lib/naver-map-presence-helpers';

describe('naver map presence helpers', () => {
    test('prefers user_id over presence_ref and presence key', () => {
        expect(getNaverPresenceIdentity({
            presence: { presence_ref: 'presence-1', user_id: 'user-1' },
            presenceKey: 'key-1',
        })).toBe('user-1');

        expect(getNaverPresenceIdentity({
            presence: { presence_ref: 'presence-1' },
            presenceKey: 'key-1',
        })).toBe('presence-1');

        expect(getNaverPresenceIdentity({
            presence: null,
            presenceKey: 'key-1',
        })).toBe('key-1');
    });

    test('counts unique users across presence state entries', () => {
        expect(countUniqueNaverPresenceUsers({
            keyA: [
                { user_id: 'user-1', presence_ref: 'presence-a' },
                { user_id: 'user-1', presence_ref: 'presence-b' },
                { presence_ref: 'presence-c' },
            ],
            keyB: [null, { user_id: 'user-2' }],
            keyC: 'not-array',
        })).toBe(4);
    });
});
