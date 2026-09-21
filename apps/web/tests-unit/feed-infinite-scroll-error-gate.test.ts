import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const feedSource = readFileSync(join(import.meta.dir, '../components/feed/FeedContent.tsx'), 'utf8');
const restaurantSource = readFileSync(join(import.meta.dir, '../hooks/use-restaurants.tsx'), 'utf8');
const stampSource = readFileSync(join(import.meta.dir, '../app/stamp/page.tsx'), 'utf8');
const stampOverlaySource = readFileSync(join(import.meta.dir, '../components/overlay-pages/StampOverlay.tsx'), 'utf8');

describe('피드 무한 스크롤 실패 처리', () => {
    test('다음 페이지 실패 뒤에는 관찰자가 즉시 재요청하지 않는다', () => {
        expect(feedSource).toContain('if (isError) {');
        expect(feedSource).toContain('}, [allReviews.length, fetchNextPage, hasNextPage, isFetchingNextPage, isError]);');
    });

    test('자동 재요청은 오류 구간당 한 번, 백오프를 두고 수행하고 명시적 재시도도 제공한다', () => {
        expect(feedSource).toContain('const FEED_AUTO_RETRY_LIMIT = 1;');
        expect(feedSource).toContain('const FEED_AUTO_RETRY_DELAY_MS = 2000;');
        expect(feedSource).toContain('autoRetryCountRef.current >= FEED_AUTO_RETRY_LIMIT');
        expect(feedSource).toContain('autoRetryCountRef.current = 0;');
        expect(feedSource).toContain('onClick={() => fetchNextPage()}');
        expect(feedSource).toContain('다시 시도');
    });
});

describe('도장 무한 스크롤 중복 트리거', () => {
    test('스탬프 페이지는 센티널 observer와 스크롤 폴백으로, 오버레이는 observer만 load-more를 호출한다', () => {
        // 스탬프 페이지는 IntersectionObserver 콜백을 전달하지 않는 임베디드 웹뷰를 위해
        // 스크롤 컨테이너의 onScroll 핸들러에서도 같은 여유(240px)로 다음 페이지를 요청한다.
        expect(stampSource.match(/loadMoreRestaurants\(\);/g)).toHaveLength(2);
        expect(stampSource).toContain('const STAMP_LOAD_MORE_SCROLL_MARGIN = 240;');
        expect(stampSource).toContain('scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight');
        expect(stampOverlaySource.match(/loadMoreRestaurants\(\);/g)).toHaveLength(1);
        expect(stampSource).not.toContain("addEventListener('scroll', loadMoreIfNearEnd");
        expect(stampOverlaySource).not.toContain("addEventListener('scroll', loadMoreIfNearEnd");
        expect(stampOverlaySource).not.toContain('onScroll={handleScroll}');
    });

    test('옵저버와 스크롤 폴백이 같은 프레임에 겹쳐도 페이지를 두 번 건너뛰지 않는다', () => {
        expect(stampSource).toContain('if (!hasMoreToDisplay || loadMorePendingRef.current) return;');
        expect(stampSource).toContain('loadMorePendingRef.current = true;');
        expect(stampSource).toContain('loadMorePendingRef.current = false;');
        expect(stampSource).toContain('}, [displayLimit]);');
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
