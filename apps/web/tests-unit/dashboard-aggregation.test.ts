import { describe, expect, test } from 'bun:test';

import type { DashboardRestaurantRow } from '../lib/dashboard/supabase';
import { buildDashboardSummaryFromRows } from '../lib/dashboard/summary';
import { buildDashboardFunnelFromRows, buildDashboardFailuresFromRows } from '../lib/dashboard/evaluation';
import { buildDashboardQualityFromRows } from '../lib/dashboard/quality';

function makeRow(overrides: Partial<DashboardRestaurantRow>): DashboardRestaurantRow {
    return {
        id: overrides.id ?? 'row-id',
        name: overrides.name ?? 'restaurant',
        categories: overrides.categories ?? [],
        road_address: overrides.road_address ?? null,
        jibun_address: overrides.jibun_address ?? null,
        origin_address: overrides.origin_address ?? null,
        lat: overrides.lat ?? null,
        lng: overrides.lng ?? null,
        youtube_link: overrides.youtube_link ?? null,
        youtube_meta: overrides.youtube_meta ?? null,
        source_type: overrides.source_type ?? 'geminiCLI',
        status: overrides.status ?? 'approved',
        is_not_selected: overrides.is_not_selected ?? false,
        is_missing: overrides.is_missing ?? false,
        geocoding_success: overrides.geocoding_success ?? true,
        geocoding_false_stage: overrides.geocoding_false_stage ?? null,
        evaluation_results: overrides.evaluation_results ?? null,
        updated_at: overrides.updated_at ?? '2026-02-01T00:00:00.000Z',
        created_at: overrides.created_at ?? '2026-02-01T00:00:00.000Z',
    };
}

describe('dashboard aggregations', () => {
    test('buildDashboardSummaryFromRows aggregates totals/categories/videos', () => {
        const rows: DashboardRestaurantRow[] = [
            makeRow({
                id: 'r1',
                name: 'A',
                categories: ['한식'],
                lat: 37.0,
                lng: 127.0,
                youtube_link: 'https://youtu.be/vidAAA',
                youtube_meta: { title: 'Video A', publishedAt: '2024-01-01' },
                is_not_selected: false,
                geocoding_success: true,
                updated_at: '2026-02-01T00:00:00.000Z',
            }),
            makeRow({
                id: 'r2',
                name: 'B',
                categories: ['한식', '분식'],
                lat: null,
                lng: null,
                youtube_link: 'https://youtu.be/vidAAA',
                youtube_meta: { title: 'Video A', publishedAt: '2024-01-01' },
                is_not_selected: true,
                geocoding_success: false,
                updated_at: '2026-02-05T00:00:00.000Z',
            }),
            makeRow({
                id: 'r3',
                name: 'C',
                categories: ['일식'],
                lat: 35.0,
                lng: 129.0,
                youtube_link: 'https://www.youtube.com/watch?v=vidBBB',
                youtube_meta: { title: 'Video B', publishedAt: '2024-01-02' },
                is_not_selected: false,
                geocoding_success: true,
                updated_at: '2026-01-01T00:00:00.000Z',
            }),
        ];

        const result = buildDashboardSummaryFromRows(rows, new Date('2026-02-10T00:00:00.000Z'));

        expect(result.asOf).toBe('2026-02-05T00:00:00.000Z');
        expect(result.totals.restaurants).toBe(3);
        expect(result.totals.videos).toBe(2);
        expect(result.totals.categories).toBe(3);
        expect(result.totals.withCoordinates).toBe(2);

        expect(result.topCategories[0]).toEqual({ name: '한식', count: 2 });
        expect(result.topCategories).toEqual(expect.arrayContaining([
            { name: '분식', count: 1 },
            { name: '일식', count: 1 },
        ]));

        const topVideo = result.videos[0];
        expect(topVideo.videoId).toBe('vidAAA');
        expect(topVideo.restaurantCount).toBe(2);
        expect(topVideo.notSelectedCount).toBe(1);
        expect(topVideo.geocodingFailedCount).toBe(1);
    });

    test('buildDashboardFunnelFromRows computes funnel counts and conversion', () => {
        const now = new Date('2026-02-01T00:00:00.000Z');

        const ruleMetrics = { location_match_TF: { eval_value: true } };
        const laajMetrics = { category_TF: { eval_value: true }, review_faithfulness_score: { eval_value: 0.9 } };

        const rows: DashboardRestaurantRow[] = [
            // V1: selected + not-selected overlap
            makeRow({
                id: 'v1-a',
                youtube_link: 'https://youtu.be/vidV1A',
                source_type: 'geminiCLI',
                is_not_selected: false,
                evaluation_results: ruleMetrics,
            }),
            makeRow({
                id: 'v1-b',
                youtube_link: 'https://youtu.be/vidV1A',
                source_type: 'geminiCLI',
                is_not_selected: true,
                evaluation_results: null,
                is_missing: true,
            }),
            // V2: rule only (no laaj)
            makeRow({
                id: 'v2-a',
                youtube_link: 'https://www.youtube.com/watch?v=vidV2B',
                source_type: 'perplexity',
                is_not_selected: false,
                evaluation_results: { location_match_TF: { eval_value: false, falseMessage: 'addr mismatch' } },
            }),
            // V3: rule + laaj
            makeRow({
                id: 'v3-a',
                youtube_link: 'https://youtu.be/vidV3C',
                source_type: 'geminiCLI',
                is_not_selected: false,
                evaluation_results: { ...ruleMetrics, ...laajMetrics },
            }),
        ];

        const result = buildDashboardFunnelFromRows(rows, now);

        expect(result.asOf).toBe(now.toISOString());
        expect(result.counts.crawling).toBe(3);
        expect(result.counts.selection).toBe(3);
        expect(result.counts.notSelection).toBe(1);
        expect(result.counts.selectionUnion).toBe(3);
        expect(result.counts.selectionOverlap).toBe(1);
        expect(result.counts.rule).toBe(3);
        expect(result.counts.laaj).toBe(1);

        expect(result.conversion.selectionRate).toBe(100);
        expect(result.conversion.ruleRate).toBe(100);
        expect(result.conversion.laajRate).toBe(33.33);
    });

    test('buildDashboardFailuresFromRows buckets reasons, rule false messages, and laaj gaps', () => {
        const now = new Date('2026-02-01T00:00:00.000Z');

        const rows: DashboardRestaurantRow[] = [
            makeRow({
                id: 'v1-a',
                youtube_link: 'https://youtu.be/vidV1A',
                source_type: 'geminiCLI',
                is_not_selected: false,
                evaluation_results: { location_match_TF: { eval_value: true } },
            }),
            makeRow({
                id: 'v1-b',
                youtube_link: 'https://youtu.be/vidV1A',
                source_type: 'geminiCLI',
                is_not_selected: true,
                is_missing: true,
                evaluation_results: null,
            }),
            makeRow({
                id: 'v2-a',
                youtube_link: 'https://www.youtube.com/watch?v=vidV2B',
                source_type: 'perplexity',
                is_not_selected: false,
                evaluation_results: { location_match_TF: { eval_value: false, falseMessage: 'addr mismatch' } },
            }),
            makeRow({
                id: 'v3-a',
                youtube_link: 'https://youtu.be/vidV3C',
                source_type: 'geminiCLI',
                is_not_selected: false,
                evaluation_results: { location_match_TF: { eval_value: true }, category_TF: { eval_value: true } },
            }),
        ];

        const result = buildDashboardFailuresFromRows(rows, now);

        expect(result.asOf).toBe(now.toISOString());
        expect(result.notSelectionReasons).toEqual(expect.arrayContaining([
            { label: '평가 미대상(missing target)', count: 1 },
        ]));
        expect(result.ruleFalseMessages).toEqual(expect.arrayContaining([
            { label: 'addr mismatch', count: 1 },
        ]));
        expect(result.laajGaps.count).toBe(2);
        expect(result.laajGaps.videoIds).toEqual(['vidV1A', 'vidV2B']);
    });

    test('buildDashboardQualityFromRows tallies quality metrics', () => {
        const now = new Date('2026-02-01T00:00:00.000Z');

        const rows: DashboardRestaurantRow[] = [
            makeRow({
                id: 'q1',
                source_type: 'geminiCLI',
                youtube_link: 'https://youtu.be/vidQ1A',
                evaluation_results: {
                    location_match_TF: { eval_value: true },
                    category_validity_TF: { eval_value: false },
                    category_TF: { eval_value: true },
                    review_faithfulness_score: { eval_value: 0.8 },
                },
            }),
            makeRow({
                id: 'q2',
                source_type: 'perplexity',
                youtube_link: 'https://youtu.be/vidQ2B',
                evaluation_results: {
                    location_match_TF: { eval_value: false, falseMessage: 'm' },
                },
            }),
            makeRow({
                id: 'q3',
                source_type: 'geminiCLI',
                youtube_link: 'https://youtu.be/vidQ3C',
                evaluation_results: null,
            }),
        ];

        const result = buildDashboardQualityFromRows(rows, now);

        expect(result.asOf).toBe(now.toISOString());
        expect(result.totals.pipelineRows).toBe(3);
        expect(result.totals.withRuleMetrics).toBe(2);
        expect(result.totals.withLaajMetrics).toBe(1);

        expect(result.locationMatch).toEqual({ trueCount: 1, falseCount: 1, missingCount: 1 });
        expect(result.categoryValidity).toEqual({ trueCount: 0, falseCount: 1, missingCount: 2 });
        expect(result.categoryTF).toEqual({ trueCount: 1, falseCount: 0, missingCount: 2 });

        expect(result.reviewFaithfulness.count).toBe(1);
        expect(result.reviewFaithfulness.average).toBe(0.8);
        expect(result.reviewFaithfulness.median).toBe(0.8);
        expect(result.reviewFaithfulness.min).toBe(0.8);
        expect(result.reviewFaithfulness.max).toBe(0.8);
    });
});

