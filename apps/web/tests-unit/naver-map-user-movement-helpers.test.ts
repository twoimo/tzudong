import { describe, expect, test } from 'bun:test';

import { buildResetUserMapMovementHandler } from '../lib/naver-map-user-movement-helpers';

describe('naver map user movement helpers', () => {
    test('resets user moved ref to false', () => {
        const ref = { current: true };
        const handler = buildResetUserMapMovementHandler(ref);

        handler();

        expect(ref.current).toBe(false);
    });
});
