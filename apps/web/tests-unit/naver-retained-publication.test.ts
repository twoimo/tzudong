import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createPublishedPopularityLookup, projectPublishedPopularityTier } from '../lib/evidence-engineering/published-popularity';
import { buildRestaurantsForSwipe } from '../lib/mobile-home-search-selection';
import { getNaverIndividualMarkerVisual } from '../lib/naver-map-marker-visuals';
import { buildRestaurantMarkerKindSignature, isUserSubmittedRestaurant } from '../lib/restaurant-marker-kind';
import { buildRestaurantLookup } from '../lib/map-restaurant-lookup';
import { buildHomeMapResultSummary } from '../lib/home-map-result-summary';
import type { Restaurant } from '../types/restaurant';

// Execute the actual component's retained-row -> signature/swipe bindings.
// Include the current result/selection guard; this is not a component mount or SDK test.
const source = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const names = new Set(['publishedSelectedRestaurant', 'publishedSearchedRestaurant',
    'markerKindSignature', 'restaurantLookup', 'displayRestaurantLookup', 'displayRestaurantIds',
    'mergedRestaurantById', 'allowSelectionMarker', 'markerVisibleActiveSearchedRestaurant',
    'markerVisibleSelectedRestaurant', 'restaurantsForSwipe']);
const declarations: string[] = [];
const foundNames = new Set<string>();
function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node)) {
        const bindings = ts.isIdentifier(node.name) ? [node.name.text]
            : node.name.elements.flatMap((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) ? [element.name.text] : []);
        if (bindings.some((name) => names.has(name))) {
            declarations.push(`const ${node.getText(file)};`);
            bindings.forEach((name) => foundNames.add(name));
        }
    }
    ts.forEachChild(node, visit);
}
visit(file);
for (const name of names) {
    if (!foundNames.has(name)) throw new Error(`Missing retained-map binding: ${name}`);
}
const compiled = ts.transpileModule(`${declarations.join('\n')}
exports.result = { markerKindSignature, restaurantsForSwipe, markerVisibleSelectedRestaurant, markerVisibleActiveSearchedRestaurant };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function run(selected: Restaurant | null, searched: Restaurant | null, tier: 'fire' | 'rainbow', showUserSubmittedMarkers = false,
    cohort: { active?: boolean; status?: 'ready' | 'pending' | 'error'; restaurants?: Restaurant[] } = {}) {
    const lookup = createPublishedPopularityLookup({ schemaVersion: 2, publicationVersion: 'test-retained',
        sourceRevision: 'a'.repeat(40), entries: [{ restaurantId: 'approved-a', memberRestaurantIds: ['approved-a'], tier }] });
    const resultSummary = buildHomeMapResultSummary({
        data: cohort.restaurants ?? [], isPending: cohort.status === 'pending', isError: cohort.status === 'error',
        mapMode: 'domestic', selectedCountry: null, showUserSubmittedMarkers,
        filters: { categories: cohort.active ? ['한식'] : [], minRating: 0, minReviews: 0, minUserVisits: 0, minJjyangVisits: 0 },
    });
    const exports = {} as { result: { markerKindSignature: string; restaurantsForSwipe: Restaurant[];
        markerVisibleSelectedRestaurant: Restaurant | null; markerVisibleActiveSearchedRestaurant: Restaurant | null } };
    vm.runInNewContext(compiled, { exports, selectedRestaurant: selected, activeSearchedRestaurant: searched,
        displayRestaurants: resultSummary.restaurants, resultSummary, showUserSubmittedMarkers,
        useMemo: (factory: () => unknown) => factory(), buildRestaurantsForSwipe, isUserSubmittedRestaurant,
        buildRestaurantMarkerKindSignature, buildRestaurantLookup,
        projectPublishedPopularityTier: (r: Restaurant) => projectPublishedPopularityTier(r, lookup),
    });
    return exports.result;
}
const row = (id = 'approved-a', extra = {}) => ({ id, name: `공개 식당 ${id}`, lat: 37.5, lng: 127,
    categories: ['한식'], ...extra } as Restaurant);

describe('retained Naver rows use the same publication for invalidation and visual rendering', () => {
    test('history-restored search and raw selection outside the result keep the published tier without mutation', () => {
        for (const selected of [false, true]) {
            const raw = Object.freeze(row());
            const fire = run(selected ? raw : null, selected ? null : raw, 'fire');
            const rainbow = run(selected ? raw : null, selected ? null : raw, 'rainbow');
            expect(fire.restaurantsForSwipe).toHaveLength(1);
            expect(fire.restaurantsForSwipe[0].popularity_tier).toBe('fire');
            expect(rainbow.restaurantsForSwipe[0].popularity_tier).toBe('rainbow');
            expect(fire.markerKindSignature).not.toBe(rainbow.markerKindSignature);
            expect(getNaverIndividualMarkerVisual(fire.restaurantsForSwipe[0], selected).content)
                .toContain('<div class="tz-popularity-marker" data-popularity-tier="fire">');
            expect(raw.popularity_tier).toBeUndefined();
            expect(fire.restaurantsForSwipe[0].lat).toBe(raw.lat);
            expect(fire.restaurantsForSwipe[0].name).toBe(raw.name);
        }
    });
    test('unpublished raw and newly merged members cannot promote a retained marker', () => {
        for (const raw of [row('unpublished', { popularity_tier: 'rainbow' }),
            row('approved-a', { popularity_tier: 'rainbow', mergedRestaurants: [row('new-member')] })]) {
            const result = run(raw, raw, 'fire');
            expect(result.restaurantsForSwipe).toHaveLength(1);
            expect(result.restaurantsForSwipe[0].popularity_tier).toBe('standard');
            expect(getNaverIndividualMarkerVisual(result.restaurantsForSwipe[0], true).content)
                .toContain('<div class="tz-popularity-marker" data-popularity-tier="standard">');
            expect(raw.popularity_tier).toBe('rainbow');
        }
    });
    test('existing user-submission visibility and duplicate selection semantics remain intact', () => {
        const raw = row('approved-a', { source_type: 'user_submission_new' });
        expect(run(raw, raw, 'fire').restaurantsForSwipe).toEqual([]);
        expect(run(raw, raw, 'fire', true).restaurantsForSwipe).toHaveLength(1);
        expect(run(null, null, 'fire').restaurantsForSwipe).toEqual([]);
    });
    test.each(['pending', 'error'] as const)('%s current results cannot retain selected or searched history markers', (status) => {
        for (const active of [false, true]) {
            const raw = row();
            const result = run(raw, raw, 'fire', false, { active, status, restaurants: [raw] });
            expect(result.markerVisibleSelectedRestaurant).toBeNull();
            expect(result.markerVisibleActiveSearchedRestaurant).toBeNull();
            expect(result.restaurantsForSwipe).toEqual([]);
        }
    });
    test('an active ready filter rejects out-of-cohort selections while keeping the current result', () => {
        const current = row('current');
        const result = run(row(), row(), 'fire', false, { active: true, restaurants: [current] });
        expect(result.markerVisibleSelectedRestaurant).toBeNull();
        expect(result.markerVisibleActiveSearchedRestaurant).toBeNull();
        expect(result.restaurantsForSwipe).toEqual([current]);
        const empty = run(row(), row(), 'fire', false, { active: true });
        expect(empty.restaurantsForSwipe).toEqual([]);
    });
    test('active current IDs keep their published tier and are not duplicated in swipe results', () => {
        const raw = Object.freeze(row());
        for (const tier of ['fire', 'rainbow'] as const) {
            const result = run(raw, raw, tier, false, { active: true, restaurants: [raw] });
            expect(result.markerVisibleSelectedRestaurant?.popularity_tier).toBe(tier);
            expect(result.markerVisibleActiveSearchedRestaurant?.popularity_tier).toBe(tier);
            expect(result.restaurantsForSwipe).toEqual([raw]);
            expect(raw.popularity_tier).toBeUndefined();
        }
    });
    test('an active merged-member selection is admitted without a duplicate or an unpublished tier', () => {
        const member = row('merged-member', { popularity_tier: 'rainbow' });
        const canonical = row('approved-a', { mergedRestaurants: [member] });
        const result = run(member, member, 'fire', false, { active: true, restaurants: [canonical] });
        expect(result.markerVisibleSelectedRestaurant?.id).toBe(member.id);
        expect(result.markerVisibleSelectedRestaurant?.popularity_tier).toBe('standard');
        expect(result.markerVisibleActiveSearchedRestaurant?.popularity_tier).toBe('standard');
        expect(result.restaurantsForSwipe).toEqual([canonical]);
        expect(member.popularity_tier).toBe('rainbow');
    });
    test('active membership does not bypass hidden user-submission markers', () => {
        const raw = row('approved-a', { source_type: 'user_submission_new' });
        const hidden = run(raw, raw, 'fire', false, { active: true, restaurants: [raw] });
        expect(hidden.markerVisibleSelectedRestaurant).toBeNull();
        expect(hidden.markerVisibleActiveSearchedRestaurant).toBeNull();
        expect(hidden.restaurantsForSwipe).toEqual([]);
        const visible = run(raw, raw, 'fire', true, { active: true, restaurants: [raw] });
        expect(visible.markerVisibleSelectedRestaurant?.id).toBe(raw.id);
        expect(visible.restaurantsForSwipe).toHaveLength(1);
    });
});
