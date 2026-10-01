import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Semaphore, mapBounded, boundedLimit } from '../resource-budget.mjs';

test('nested jobs share one resource cap and retain input order', async () => {
    const pool = new Semaphore(2);
    let active = 0, peak = 0;
    const values = await mapBounded([0, 1, 2, 3], 4, async outer =>
        Promise.all([0, 1, 2].map(inner => pool.run(async () => {
            peak = Math.max(peak, ++active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--;
            return outer * 3 + inner;
        }))));
    assert.equal(peak, 2);
    assert.deepEqual(values.flat(), Array.from({ length: 12 }, (_, index) => index));
});
test('failure releases a permit and overrides cannot exceed ceilings', async () => {
    const pool = new Semaphore(1);
    await assert.rejects(pool.run(() => Promise.reject(new Error('fixture'))));
    assert.equal(await pool.run(() => 1), 1);
    assert.equal(boundedLimit('999', 2, 4), 4);
    assert.equal(boundedLimit('-1', 2, 4), 2);
});
