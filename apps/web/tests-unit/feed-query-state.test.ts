import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const feedSource = readFileSync(join(import.meta.dir, '../components/feed/FeedContent.tsx'), 'utf8');

describe('public feed query state', () => {
    test('keeps a failed first page distinct from a confirmed empty feed', () => {
        const errorBranch = feedSource.indexOf('isError && allReviews.length === 0');
        const emptyBranch = feedSource.indexOf('allReviews.length === 0 ?');

        expect(feedSource).toContain('isError,');
        expect(errorBranch).toBeGreaterThan(-1);
        expect(emptyBranch).toBeGreaterThan(errorBranch);
        expect(feedSource).toContain('리뷰 데이터를 불러오지 못했습니다.');
        expect(feedSource).toContain('아직 승인된 리뷰가 없습니다.');
        expect(feedSource).toContain('role="alert"');
    });
});
