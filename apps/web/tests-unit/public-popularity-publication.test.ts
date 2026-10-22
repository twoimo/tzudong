import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GET } from '../app/api/public-popularity/route';
import { mergeRestaurants } from '../hooks/use-restaurants';
import { buildRestaurantDetailFromMergeRows } from '../hooks/use-restaurant-detail';
import {
    createPublishedPopularityLookup, parsePublicPopularityPublication,
    projectPublishedPopularityTier, publicPopularityPublication, resolvePublishedPopularityTier,
} from '../lib/evidence-engineering/published-popularity';
import { buildRestaurantMarkerKindSignature } from '../lib/restaurant-marker-kind';
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate } from '../lib/map-render-guard';
import type { Tables } from '../integrations/supabase/types';
import type { Restaurant } from '../types/restaurant';

const snapshot = () => ({ schemaVersion: 2, publicationVersion: 'test-cohort-1',
    sourceRevision: 'a'.repeat(40), entries: [{ restaurantId: 'public-a', memberRestaurantIds: ['public-a'], tier: 'fire' }] });
const dbRow = (id: string, extra = {}) => ({ id, approved_name: '검증 식당', status: 'approved',
    road_address: '공개 주소', lat: 37.5, lng: 127, categories: ['한식'],
    created_at: '2026-10-17T00:00:00Z', ...extra } as unknown as Tables<'restaurants'>);

describe('operator-published public popularity', () => {
    test('rejects private fields, duplicate IDs, invalid grades and unreviewed nonempty cohorts', () => {
        const valid = snapshot();
        const invalid = [
            { ...valid, metrics: { score: 100 } },
            { ...valid, entries: [{ ...valid.entries[0], raw_score: 100 }] },
            { ...valid, entries: [...valid.entries, ...valid.entries] },
            { ...valid, entries: [{ ...valid.entries[0], tier: 'private-shadow' }] },
            { ...valid, entries: [{ ...valid.entries[0], tier: { toString() { throw new Error('coerced'); } } }] },
            { ...valid, publicationVersion: 'unpublished' },
            { ...valid, schemaVersion: 1 },
            { ...valid, sourceRevision: null },
        ];
        for (const value of invalid) expect(() => parsePublicPopularityPublication(value)).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
    });

    test('bounds entry count and serialized bytes and freezes independent copies', () => {
        const valid = snapshot();
        const parsed = parsePublicPopularityPublication(valid);
        valid.entries[0].tier = 'rainbow';
        valid.entries[0].memberRestaurantIds.push('public-z');
        expect(parsed.entries[0].tier).toBe('fire');
        expect(parsed.entries[0].memberRestaurantIds).toEqual(['public-a']);
        expect(Object.isFrozen(parsed.entries[0])).toBe(true);
        expect(Object.isFrozen(parsed.entries)).toBe(true);
        expect(() => parsePublicPopularityPublication({ ...valid,
            entries: Array.from({ length: 5001 }, (_, i) => ({ restaurantId: `r-${i}`, tier: 'fire' })),
        })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
        expect(() => parsePublicPopularityPublication({ ...valid,
            entries: Array.from({ length: 4000 }, (_, i) => { const id = `${i}-`.padEnd(128, 'a');
                return { restaurantId: id, memberRestaurantIds: [id], tier: 'fire' }; }),
        })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
        expect(Object.isFrozen(parsed.entries[0].memberRestaurantIds)).toBe(true);
    });

    test('list and detail derive the same tier without a database tier column; stale/raw tiers cannot promote it', () => {
        const lookup = createPublishedPopularityLookup(snapshot());
        const rows = [dbRow('public-a'), dbRow('private-b', { approved_name: '다른 식당', road_address: '다른 주소', lng: 128, popularity_tier: 'rainbow' })];
        const before = structuredClone(rows);
        const list = mergeRestaurants(rows, lookup);
        expect(list.find((r) => r.id === 'public-a')?.popularity_tier).toBe('fire');
        expect(list.find((r) => r.id === 'private-b')?.popularity_tier).toBe('standard');
        for (const item of list) {
            const stale = { ...item, popularity_tier: 'rainbow' as const };
            expect(buildRestaurantDetailFromMergeRows(stale, rows.filter((r) => r.id === item.id), lookup)?.popularity_tier)
                .toBe(item.popularity_tier);
            expect(buildRestaurantDetailFromMergeRows(stale, [], lookup)?.popularity_tier).toBe(item.popularity_tier);
        }
        expect(rows).toEqual(before);
        expect(projectPublishedPopularityTier(list[0], lookup)).toBe(list[0]);
    });

    test('merged representatives use their published identity and do not inherit a child grade', () => {
        const lookup = createPublishedPopularityLookup(snapshot());
        const rows = [dbRow('public-a', { created_at: '2026-10-16T00:00:00Z' }), dbRow('new-primary')];
        const [merged] = mergeRestaurants(rows, lookup);
        expect(merged.mergedRestaurants).toHaveLength(2);
        expect(merged.popularity_tier).toBe('standard');
        expect(buildRestaurantDetailFromMergeRows(merged, rows, lookup)?.popularity_tier).toBe('standard');
    });

    test('explicit canonical membership keeps compact, full, partial, and direct-detail grades identical', () => {
        const data = snapshot();
        data.entries[0].memberRestaurantIds.push('public-z');
        const lookup = createPublishedPopularityLookup(data);
        const rows = [dbRow('public-a', { youtube_meta: { publishedAt: '2026-01-01' } }),
            dbRow('public-z', { youtube_meta: { publishedAt: '2026-10-01' } })];
        const compact = rows.map(({ youtube_meta: _, ...row }) => row) as Tables<'restaurants'>[];
        const [mapRow] = mergeRestaurants(compact, lookup);
        const [fullRow] = mergeRestaurants(rows, lookup);
        expect(mapRow.id).toBe('public-a');
        expect(fullRow.id).toBe('public-z'); // Preserve the existing representative selection.
        expect(mapRow.popularity_tier).toBe('fire');
        expect(fullRow.popularity_tier).toBe('fire');
        expect(mergeRestaurants([rows[1]], lookup)[0].popularity_tier).toBe('fire');
        expect(buildRestaurantDetailFromMergeRows(mapRow, rows, lookup)?.popularity_tier).toBe('fire');
        expect(projectPublishedPopularityTier(rows[1] as unknown as Restaurant, lookup).popularity_tier).toBe('fire');
        expect(lookup('unpublished-new-member')).toBe('standard');
    });

    test('new members or conflicting cohorts fail closed for either display representative', () => {
        const data = snapshot();
        data.entries.push({ restaurantId: 'public-z', memberRestaurantIds: ['public-z'], tier: 'rainbow' });
        const lookup = createPublishedPopularityLookup(data);
        for (const other of ['public-z', 'unpublished-new-member']) {
            const rows = [dbRow('public-a', { youtube_meta: { publishedAt: '2026-01-01' } }),
                dbRow(other, { youtube_meta: { publishedAt: '2026-10-01' } })];
            const compact = rows.map(({ youtube_meta: _, ...row }) => row) as Tables<'restaurants'>[];
            const [mapRow] = mergeRestaurants(compact, lookup);
            const [fullRow] = mergeRestaurants(rows, lookup);
            expect(mapRow.popularity_tier).toBe('standard');
            expect(fullRow.popularity_tier).toBe('standard');
            expect(buildRestaurantDetailFromMergeRows(mapRow, rows, lookup)?.popularity_tier).toBe('standard');
            expect(resolvePublishedPopularityTier(fullRow, lookup)).toBe('standard');
        }
    });

    test('rejects ambiguous/incomplete canonical membership and bounds the whole member index', () => {
        const data = snapshot();
        for (const members of [[], ['public-z'], ['public-z', 'public-a'], ['public-a', 'public-a']]) {
            expect(() => parsePublicPopularityPublication({ ...data,
                entries: [{ ...data.entries[0], memberRestaurantIds: members }] })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
        }
        expect(() => parsePublicPopularityPublication({ ...data, entries: [data.entries[0],
            { restaurantId: 'a', memberRestaurantIds: ['a', 'public-a'], tier: 'rainbow' }] })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
        const first = Array.from({ length: 2501 }, (_, i) => `a-${String(i).padStart(4, '0')}`);
        const second = first.map((id) => id.replace('a-', 'b-'));
        const atCapacity = Array.from({ length: 5000 }, (_, i) => `r-${String(i).padStart(4, '0')}`);
        expect(createPublishedPopularityLookup({ ...data, entries: [
            { restaurantId: atCapacity[0], memberRestaurantIds: atCapacity, tier: 'fire' },
        ] })(atCapacity[4999])).toBe('fire');
        expect(() => parsePublicPopularityPublication({ ...data, entries: [
            { restaurantId: first[0], memberRestaurantIds: first, tier: 'fire' },
            { restaurantId: second[0], memberRestaurantIds: second, tier: 'rainbow' },
        ] })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
    });

    test('published membership overrides a stale caller tier and the detail panel does not mention flame counts', () => {
        const data = snapshot(); data.entries[0].memberRestaurantIds.push('public-z');
        const lookup = createPublishedPopularityLookup(data);
        expect(resolvePublishedPopularityTier({ id: 'public-a' }, lookup)).toBe('fire');
        expect(resolvePublishedPopularityTier({ id: 'public-z' }, lookup)).toBe('fire');
        expect(resolvePublishedPopularityTier({ id: 'private' }, lookup)).toBe('standard');
        const panel = readFileSync(resolve(import.meta.dir, '../components/restaurant/RestaurantDetailPanel.tsx'), 'utf8');
        expect(panel).not.toContain('PopularityMention');
        expect(panel).not.toContain('불꽃 3개');
        expect(panel).not.toContain('제일 맛있는 맛집');
    });

    test('published endpoint returns the reviewed public snapshot and stable ETag without raw scores', async () => {
        const response = GET();
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(JSON.parse(body)).toEqual(publicPopularityPublication);
        expect(response.headers.get('etag')).toBe(`"${createHash('sha256').update(body).digest('hex')}"`);
        expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
        expect(publicPopularityPublication.entries.length).toBeGreaterThan(0);
        expect(publicPopularityPublication.publicationVersion).not.toBe('unpublished');
        for (const entry of publicPopularityPublication.entries) {
            for (const id of entry.memberRestaurantIds) expect(createPublishedPopularityLookup(publicPopularityPublication)(id)).toBe(entry.tier);
        }
        expect(createPublishedPopularityLookup(publicPopularityPublication)('missing')).toBe('standard');
    });
});

describe('public tier reaches the outer Naver render guard', () => {
    const signature = (tier: unknown, retained: { selected?: unknown; searched?: unknown } = {}) => buildMarkerRenderSignature({
        zoom: 14, bounds: null, displayRestaurantIds: ['public-a'], selectedRestaurantId: 'retained', searchedRestaurantId: null,
        isClusterMode: false, isRegionalClusterMode: false, isSeoulDistrictMode: false,
        markerLayerVersion: buildRestaurantMarkerKindSignature([
            { id: 'public-a', popularity_tier: tier as Restaurant['popularity_tier'] },
        ], undefined, retained),
    });
    test('same IDs/viewport/selection refreshes fire → rainbow → standard, while normalized missing values skip', () => {
        expect(shouldSkipMarkerUpdate(signature('fire'), signature('rainbow'))).toBe(false);
        expect(shouldSkipMarkerUpdate(signature('rainbow'), signature('standard'))).toBe(false);
        expect(shouldSkipMarkerUpdate(signature(null), signature(undefined))).toBe(true);
        expect(shouldSkipMarkerUpdate(signature('unknown'), signature('standard'))).toBe(true);
    });
    test('retained selection/search grades also invalidate the unchanged-query guard', () => {
        expect(shouldSkipMarkerUpdate(signature('standard', { selected: 'fire' }), signature('standard', { selected: 'rainbow' }))).toBe(false);
        expect(shouldSkipMarkerUpdate(signature('standard', { searched: 'fire' }), signature('standard', { searched: 'standard' }))).toBe(false);
    });
});
