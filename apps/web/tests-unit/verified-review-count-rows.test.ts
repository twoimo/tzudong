import { describe, expect, test } from 'bun:test';

import { fetchVerifiedReviewCountRows } from '../lib/verified-review-count-rows';
import { buildRelatedVerifiedReviewCountMap } from '../lib/restaurant-review-counts';

type Review = { id: string; restaurant_id: string };
type Query = Array<[string, string | number | boolean]>;
const uuid = (index: number) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
const review = (index: number, restaurantId = 'canonical'): Review => ({ id: uuid(index), restaurant_id: restaurantId });

function fixture(initialRows: Review[], cap = 1000) {
    let rows = [...initialRows];
    const queries: Query[] = [];
    return {
        queries,
        replaceRows(nextRows: Review[]) { rows = nextRows; },
        async fetch(query: Query): Promise<unknown> {
            queries.push(query);
            const params = new Map(query);
            expect(params.get('select')).toBe('id,restaurant_id');
            expect(params.get('order')).toBe('id.asc');
            expect(params.get('is_verified')).toBe('eq.true');
            expect(params.get('limit')).toBe(1000);
            const ids = JSON.parse(`[${String(params.get('restaurant_id')).slice(4, -1)}]`) as string[];
            const after = String(params.get('id') ?? '').replace(/^gt\./, '');
            return rows.filter(row => ids.includes(row.restaurant_id) && row.id > after)
                .sort((a, b) => a.id.localeCompare(b.id)).slice(0, Math.min(cap, Number(params.get('limit'))));
        },
    };
}

describe('verified review count pagination', () => {
    for (const [size, requests] of [[0, 1], [1, 2], [999, 2], [1000, 2], [1001, 3], [2000, 3], [2501, 4]]) {
        test(`reads all ${size} reviews with ${requests} bounded requests including EOF`, async () => {
            const f = fixture(Array.from({ length: size }, (_, i) => review(i)));
            const rows = await fetchVerifiedReviewCountRows(['canonical'], f.fetch);
            expect(rows).toHaveLength(size);
            expect(rows.every(row => row.restaurant_id === 'canonical')).toBe(true);
            expect(f.queries).toHaveLength(requests);
            expect(new Map(f.queries[0]).has('id')).toBe(false);
            if (size > 1000) expect(new Map(f.queries[1]).get('id')).toBe(`gt.${uuid(999)}`);
        });
    }

    test('does not mistake the server cap or a short nonempty page for EOF', async () => {
        const f = fixture(Array.from({ length: 1001 }, (_, i) => review(i)), 200);
        expect(await fetchVerifiedReviewCountRows(['canonical'], f.fetch)).toHaveLength(1001);
        expect(f.queries).toHaveLength(7);
    });

    test('empty input makes no requests', async () => {
        const f = fixture([]);
        expect(await fetchVerifiedReviewCountRows([], f.fetch)).toEqual([]);
        expect(f.queries).toHaveLength(0);
    });

    test('keeps every review on canonical/deleted duplicate IDs without counting another branch', async () => {
        const f = fixture(Array.from({ length: 1003 }, (_, i) => review(i, i % 2 ? 'deleted' : 'canonical')));
        const rows = await fetchVerifiedReviewCountRows(['canonical', 'deleted', 'canonical'], f.fetch);
        const canonical = { id: 'canonical', name: 'fixture', road_address: 'fixture-address' };
        const deleted = { ...canonical, id: 'deleted' };
        const other = { ...canonical, id: 'other', road_address: 'other-address' };
        const counts = buildRelatedVerifiedReviewCountMap([canonical, other], [canonical, canonical, deleted, other], rows);
        expect(rows).toHaveLength(1003);
        expect(counts.get('canonical')).toBe(1003);
        expect(counts.get('other')).toBe(0);
        expect(new Map(f.queries[0]).get('restaurant_id')).toBe('in.("canonical","deleted")');
    });

    test('changed input IDs between invocations start from an independent cursor', async () => {
        const f = fixture([review(1, 'old'), review(2, 'new')], 1);
        expect(await fetchVerifiedReviewCountRows(['old'], f.fetch)).toEqual([{ restaurant_id: 'old' }]);
        expect(await fetchVerifiedReviewCountRows(['new'], f.fetch)).toEqual([{ restaurant_id: 'new' }]);
        expect(new Map(f.queries[2]).has('id')).toBe(false);
    });

    test('caller mutations cannot change the filter halfway through a read', async () => {
        const ids = ['old'];
        const f = fixture([review(1, 'old'), review(2, 'old'), review(3, 'new')], 1);
        const rows = await fetchVerifiedReviewCountRows(ids, async query => {
            ids[0] = 'new';
            return f.fetch(query);
        });
        expect(rows).toEqual([{ restaurant_id: 'old' }, { restaurant_id: 'old' }]);
        expect(f.queries.every(query => new Map(query).get('restaurant_id') === 'in.("old")')).toBe(true);
    });

    test('deleting an earlier ID between pages does not shift away unread IDs', async () => {
        const f = fixture([review(1), review(2), review(3)], 1);
        const rows = await fetchVerifiedReviewCountRows(['canonical'], async query => {
            if (f.queries.length === 1) f.replaceRows([review(2), review(3)]);
            return f.fetch(query);
        });
        expect(rows).toHaveLength(3);
        expect(f.queries).toHaveLength(4);
    });

    for (const failingPage of [0, 1]) {
        test(`thrown page ${failingPage + 1} failure rejects instead of returning partial counts`, async () => {
            let requests = 0;
            await expect(fetchVerifiedReviewCountRows(['canonical'], async () => {
                if (requests++ === failingPage) throw new Error('fixture transport failure');
                return [review(1)];
            })).rejects.toThrow('VERIFIED_REVIEW_COUNT_UNAVAILABLE');
            expect(requests).toBe(failingPage + 1);
        });

        test(`returned page ${failingPage + 1} error rejects instead of treating it as empty`, async () => {
            let requests = 0;
            await expect(fetchVerifiedReviewCountRows(['canonical'], async () => {
                if (requests++ === failingPage) return { data: null, error: true };
                return [review(1)];
            })).rejects.toThrow('VERIFIED_REVIEW_COUNT_INVALID_PAGE');
            expect(requests).toBe(failingPage + 1);
        });
    }

    for (const invalid of [null, {}, [null], [review(1, 'unrequested')], [{ id: '', restaurant_id: 'canonical' }],
        [review(1), review(1)], [review(2), review(1)], Array.from({ length: 1001 }, (_, i) => review(i))]) {
        test('rejects a malformed, out-of-order, duplicate or oversized page', async () => {
            await expect(fetchVerifiedReviewCountRows(['canonical'], async () => invalid))
                .rejects.toThrow('VERIFIED_REVIEW_COUNT_INVALID_PAGE');
        });
    }

    test('a replayed last ID fails closed without an infinite loop or duplicate count', async () => {
        let requests = 0;
        await expect(fetchVerifiedReviewCountRows(['canonical'], async () => {
            requests++;
            return [review(1)];
        })).rejects.toThrow('VERIFIED_REVIEW_COUNT_INVALID_PAGE');
        expect(requests).toBe(2);
    });
});
