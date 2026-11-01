import { describe, expect, test } from 'bun:test';
import { fetchCompleteRestaurantRows } from '../hooks/use-restaurants';
describe('complete map restaurant query', () => {
    test('reads through server caps below requested size until an empty page', async () => {
        const rows = Array.from({ length: 23 }, (_, index) => ({ id: String(index) }));
        const offsets: number[] = [];
        const result = await fetchCompleteRestaurantRows<{ id: string }>([], async (query) => {
            const offset = Number(query.find(([key]) => key === 'offset')?.[1]);
            offsets.push(offset);
            return rows.slice(offset, offset + 4);
        });
        expect(result).toEqual(rows);
        expect(offsets).toEqual([0, 4, 8, 12, 16, 20, 23]);
    });
    test('later page failures reject partial membership', async () => {
        let call = 0;
        await expect(fetchCompleteRestaurantRows([], async () => {
            if (call++ === 0) return [{ id: 'first' }];
            throw new Error('page_failed');
        })).rejects.toThrow('page_failed');
    });
    test('repeated pages fail instead of looping or claiming completeness', async () => {
        await expect(fetchCompleteRestaurantRows([], async () => [{ id: 'same' }])).rejects.toThrow('restaurant_pagination_changed');
    });
    test('a fully read empty query is real zero', async () => {
        expect(await fetchCompleteRestaurantRows([], async () => [])).toEqual([]);
    });
});
