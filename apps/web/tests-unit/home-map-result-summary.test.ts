import { describe, expect, test } from 'bun:test';
import { buildHomeMapResultSummary, reconcileHomeMapContextualResults, hasActiveHomeMapResultFilters, homeMapResultCountLabel } from '../lib/home-map-result-summary';
import { applyHomeMapThemeFilter } from '../lib/home-map-theme-filters';
import type { FilterState } from '../components/filters/filter-state';
import type { Restaurant } from '../types/restaurant';
const filters: FilterState = { categories: [], minRating: 0, minReviews: 0, minUserVisits: 0, minJjyangVisits: 0, featuredTheme: 'hot-view' };
const row = (id: string, values: Partial<Restaurant> = {}) => ({ id, name: id, lat: 37.5, lng: 127, road_address: '서울특별시 중구', categories: ['한식'], ...values } as Restaurant);
const summary = (values: Partial<Parameters<typeof buildHomeMapResultSummary>[0]> = {}) => buildHomeMapResultSummary({ data: [row('a')], isPending: false, isError: false, mapMode: 'domestic', selectedCountry: null, filters, ...values });
describe('complete current map membership', () => {
    test('pending and errors cannot publish false zero or stale members', () => {
        for (const state of [{ isPending: true }, { isError: true }, { data: undefined }]) {
            const result = summary(state);
            expect(result.count).toBeNull();
            expect(result.restaurants).toEqual([]);
            expect(result.categoryCounts).toEqual({});
            expect(homeMapResultCountLabel(result, 0)).not.toBe('0');
        }
        expect(summary({ data: [] }).count).toBe(0);
    });
    test('counts and category facets use renderable domestic membership', () => {
        const result = summary({ data: [row('a', { categories: ['한식', '한식', '고기'] }), row('b'), row('bad', { lat: null }), row('tokyo', { lat: 35, lng: 139, road_address: '도쿄' })] });
        expect(result.restaurants.map((r) => r.id)).toEqual(['a', 'b']);
        expect(result.count).toBe(2);
        expect(result.regionCounts['서울특별시']).toBe(2);
        expect(result.categoryCounts).toEqual({ 한식: 2, 고기: 1 });
    });
    test('overseas requires a country and never reuses domestic members', () => {
        expect(summary({ mapMode: 'overseas' }).status).toBe('select-country');
        expect(summary({ mapMode: 'overseas' }).count).toBeNull();
        const result = summary({ mapMode: 'overseas', selectedCountry: '일본(도쿄)', data: [row('a'), row('tokyo', { lat: 35, lng: 139, road_address: '도쿄' })] });
        expect(result.restaurants.map((r) => r.id)).toEqual(['tokyo']);
        expect(result.count).toBe(1);
    });
    test('submitted marker visibility also applies to domestic counts', () => {
        const result = summary({ showUserSubmittedMarkers: false, data: [row('a'), row('submitted', { source_type: 'user_submission_new' })] });
        expect(result.restaurants.map((r) => r.id)).toEqual(['a']);
    });
    test('only actual query filters activate lists; clearing returns baseline', () => {
        const cleared = { ...filters, featuredTheme: null };
        expect(summary().active).toBe(true);
        expect(summary({ filters: cleared }).active).toBe(false);
        expect(hasActiveHomeMapResultFilters({ ...cleared, minRating: 5, minUserVisits: 9 })).toBe(false);
        expect(hasActiveHomeMapResultFilters({ ...cleared, categories: ['한식'] })).toBe(true);
        expect(hasActiveHomeMapResultFilters({ ...cleared, minReviews: 1 })).toBe(true);
    });
    test('percentile uses complete candidates, rounds up, includes ties, and runs once', () => {
        const rows = [100, 80, 80, 40, 30, 20].map((viewCount, i) => row(String(i), { youtube_meta: { viewCount } as Restaurant['youtube_meta'] }));
        const filtered = applyHomeMapThemeFilter(rows, 'hot-view');
        expect(filtered.map((r) => r.id)).toEqual(['0', '1', '2']);
        expect(summary({ data: filtered }).count).toBe(3);
        expect(summary({ data: filtered }).restaurants).toEqual(filtered);
    });
});

test('late viewport receipts cannot reintroduce old filter or mode membership', () => {
    const payload = { mode: 'domestic', isEligible: true, restaurants: [row('old')], totalVisibleCount: 12 } as Parameters<typeof reconcileHomeMapContextualResults>[1];
    expect(reconcileHomeMapContextualResults(summary(), payload, 'domestic')).toBeNull();
    expect(reconcileHomeMapContextualResults(summary({ isPending: true }), payload, 'domestic')).toBeNull();
    const current = row('old', { name: 'new name' });
    const accepted = reconcileHomeMapContextualResults(summary({ data: [current] }), payload, 'domestic');
    expect(accepted?.restaurants[0]).toBe(current);
    expect(accepted?.totalVisibleCount).toBe(1);
    expect(reconcileHomeMapContextualResults(summary({ data: [current] }), payload, 'overseas')).toBeNull();
});
