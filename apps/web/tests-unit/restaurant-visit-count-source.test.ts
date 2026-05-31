import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('restaurant visit count source contracts', () => {
    test('keeps compact home-map restaurant queries hydrated for visit badges', () => {
        const source = readFileSync(join(import.meta.dir, '..', 'hooks', 'use-restaurants.tsx'), 'utf8');

        expect(source).toContain('const selectFields = compact');
        expect(source).toContain('review_count, youtube_link, tzuyang_review, status');
    });
});
