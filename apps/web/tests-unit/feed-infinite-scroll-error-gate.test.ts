import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const feedSource = readFileSync(join(import.meta.dir, '../components/feed/FeedContent.tsx'), 'utf8');
const restaurantSource = readFileSync(join(import.meta.dir, '../hooks/use-restaurants.tsx'), 'utf8');
const stampSource = readFileSync(join(import.meta.dir, '../app/stamp/page.tsx'), 'utf8');

describe('피드 무한 스크롤 실패 처리', () => {
    test('다음 페이지 실패 뒤에는 관찰자가 즉시 재요청하지 않는다', () => {
        expect(feedSource).toContain('if (isError) {');
        expect(feedSource).toContain('}, [allReviews.length, fetchNextPage, hasNextPage, isFetchingNextPage, isError]);');
    });

    test('자동 재요청은 오류 구간당 한 번, 백오프를 두고 수행한다', () => {
        expect(feedSource).toContain('const FEED_AUTO_RETRY_LIMIT = 1;');
        expect(feedSource).toContain('const FEED_AUTO_RETRY_DELAY_MS = 2000;');
        expect(feedSource).toContain('autoRetryCountRef.current >= FEED_AUTO_RETRY_LIMIT');
        expect(feedSource).toContain('autoRetryCountRef.current = 0;');
    });
});

describe('조회 실패 로그', () => {
    test('피드 좋아요 실패는 원시 오류 대신 코드만 남긴다', () => {
        expect(feedSource).not.toContain("console.error('좋아요 토글 실패:', error)");
        expect(feedSource).toContain("console.error('좋아요 토글 실패:', describeErrorCodeForLog(error));");
    });

    test('식당/리뷰 조회 실패도 원시 오류 대신 코드만 남긴다', () => {
        expect(restaurantSource).not.toContain("console.error('레스토랑 데이터 조회 실패:', error)");
        expect(restaurantSource).toContain("console.error('레스토랑 데이터 조회 실패:', describeErrorCodeForLog(error));");

        expect(stampSource).not.toContain("console.error('맛집 검색 중 오류:', error)");
        expect(stampSource).not.toContain("console.error('리뷰 데이터 조회 중 오류:', error)");
        expect(stampSource).not.toContain("console.error('좋아요 토글 실패:', error)");
        expect(stampSource).toContain("console.error('맛집 검색 중 오류:', describeErrorCodeForLog(error));");
        expect(stampSource).toContain("console.error('리뷰 데이터 조회 중 오류:', describeErrorCodeForLog(error));");
    });
});
