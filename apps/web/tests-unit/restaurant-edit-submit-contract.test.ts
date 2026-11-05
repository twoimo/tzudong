import { describe, expect, test } from 'bun:test';
import {
    canonicalizeRestaurantEditPayload,
    isRestaurantEditSubmitBody,
    restaurantEditPayloadFingerprint,
} from '../lib/restaurant-edit-submit-contract';

const target = '00000000-0000-4000-8000-000000000101';
const body = (phone: string, requestKind: 'edit' | 'closure' = 'edit') => ({
    clientRequestKey: 'edit-synthetic-phone-contract',
    restaurantId: target,
    payload: {
        requestKind,
        name: '합성 해외 사업장',
        address: '합성 사업장 주소',
        phone,
        category: ['분식'],
        youtube_reviews: [{ youtube_link: 'https://youtu.be/AbCdEfGhI12', tzuyang_review: '', restaurant_id: target }],
    },
});

describe('edit submission business-contact syntax', () => {
    for (const kind of ['edit', 'closure'] as const) test(`${kind} accepts bounded international candidates for the RPC business-source check`, () => {
        for (const phone of ['+886 2 2766 8876', '+81 (3) 1234-5678', '+82 2 1234 5678']) {
            expect(isRestaurantEditSubmitBody(body(phone, kind))).toBe(true);
        }
    });

    test('preserves the existing local business-contact boundary', () => {
        for (const phone of ['', '02-1234-5678', '031-123-4567', '1588-1234']) {
            expect(isRestaurantEditSubmitBody(body(phone))).toBe(true);
        }
        for (const phone of ['010-1234-5678', '+82 10 1234 5678', 'person@example.test']) {
            expect(isRestaurantEditSubmitBody(body(phone))).toBe(false);
        }
    });

    test('rejects malformed or oversized international candidates', () => {
        for (const phone of ['++886227668876', '+0 12345678', '+886 abc', '+12345', '+1234567890123456', '+886 / 2 2766 8876', '+886\u00a02 2766 8876', '+８８６ 2 2766 8876', '+886' + ' '.repeat(40)]) {
            expect(isRestaurantEditSubmitBody(body(phone))).toBe(false);
        }
    });

    test('retains the business display value in the canonical request and retry fingerprint', () => {
        const request = body('  +886 2 2766 8876  ', 'closure');
        expect(canonicalizeRestaurantEditPayload(request.payload).phone).toBe('+886 2 2766 8876');
        expect(restaurantEditPayloadFingerprint(target, request.payload)).toBe(
            restaurantEditPayloadFingerprint(target, body('+886 2 2766 8876', 'closure').payload),
        );
    });
});
