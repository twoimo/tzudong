import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('restaurant visit count source contracts', () => {
    test('keeps compact home-map restaurant queries hydrated for visit badges', () => {
        const source = readFileSync(join(import.meta.dir, '..', 'hooks', 'use-restaurants.tsx'), 'utf8');

        expect(source).toContain('export function buildRestaurantSelectFields');
        expect(source).toContain('const RESTAURANT_COMPACT_SELECT');
        expect(source).toContain('review_count, youtube_link, tzuyang_review, source_type, status, created_at');
        expect(source).toContain('const selectFields = buildRestaurantSelectFields({');
    });
});
