-- ============================================================
-- 리뷰 좋아요 개수 성능 최적화 마이그레이션
-- 작성일: 2026년 1월 15일
-- 설명: reviews 테이블에 like_count 컬럼 추가 및 트리거 동기화
--       매번 COUNT(*) 집계 대신 캐싱된 값 사용으로 성능 개선
-- ============================================================

-- ============================================================
-- PART 1: like_count 컬럼 추가
-- ============================================================

-- 1.1 reviews 테이블에 like_count 컬럼 추가
ALTER TABLE public.reviews 
ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.reviews.like_count IS 
'리뷰 좋아요 개수 (캐시). review_likes 테이블과 트리거로 동기화됨.';

-- 1.2 like_count 제약조건 추가
ALTER TABLE public.reviews 
ADD CONSTRAINT reviews_like_count_check CHECK (like_count >= 0);

-- ============================================================
-- PART 2: 기존 데이터 마이그레이션
-- ============================================================

-- 2.1 기존 리뷰의 좋아요 개수 계산 및 업데이트
DO $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    -- review_likes 테이블에서 실제 좋아요 개수를 계산해서 업데이트
    WITH like_counts AS (
        SELECT 
            review_id,
            COUNT(*) as cnt
        FROM public.review_likes
        GROUP BY review_id
    )
    UPDATE public.reviews r
    SET like_count = COALESCE(lc.cnt, 0)
    FROM like_counts lc
    WHERE r.id = lc.review_id;
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RAISE NOTICE '✅ 기존 리뷰 % 개의 like_count 업데이트 완료', v_updated_count;
END $$;

-- ============================================================
-- PART 3: 트리거 함수 생성
-- ============================================================

-- 3.1 좋아요 추가 시 like_count 증가
CREATE OR REPLACE FUNCTION public.increment_review_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.reviews
    SET like_count = like_count + 1
    WHERE id = NEW.review_id;
    
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.increment_review_like_count() IS 
'review_likes INSERT 시 해당 리뷰의 like_count 자동 증가';

-- 3.2 좋아요 삭제 시 like_count 감소
CREATE OR REPLACE FUNCTION public.decrement_review_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.reviews
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.review_id;
    
    RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.decrement_review_like_count() IS 
'review_likes DELETE 시 해당 리뷰의 like_count 자동 감소 (최소값 0)';

-- ============================================================
-- PART 4: 트리거 생성
-- ============================================================

-- 4.1 INSERT 트리거
DROP TRIGGER IF EXISTS review_like_insert_trigger ON public.review_likes;
CREATE TRIGGER review_like_insert_trigger
    AFTER INSERT ON public.review_likes
    FOR EACH ROW
    EXECUTE FUNCTION public.increment_review_like_count();

-- 4.2 DELETE 트리거
DROP TRIGGER IF EXISTS review_like_delete_trigger ON public.review_likes;
CREATE TRIGGER review_like_delete_trigger
    AFTER DELETE ON public.review_likes
    FOR EACH ROW
    EXECUTE FUNCTION public.decrement_review_like_count();

-- ============================================================
-- PART 5: 인덱스 추가 (선택적 성능 최적화)
-- ============================================================

-- 5.1 like_count 기준 정렬을 위한 인덱스 (인기 리뷰 조회 시 유용)
CREATE INDEX IF NOT EXISTS idx_reviews_like_count 
ON public.reviews(like_count DESC) 
WHERE is_verified = true;

COMMENT ON INDEX public.idx_reviews_like_count IS 
'인증된 리뷰를 좋아요 개수 기준 내림차순 정렬 시 사용';

-- ============================================================
-- PART 6: 데이터 정합성 검증
-- ============================================================

-- 6.1 데이터 정합성 검증 함수 (선택적 실행)
CREATE OR REPLACE FUNCTION public.verify_review_like_counts()
RETURNS TABLE (
    review_id UUID,
    cached_count INTEGER,
    actual_count BIGINT,
    difference INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        r.id as review_id,
        r.like_count as cached_count,
        COUNT(rl.id) as actual_count,
        (r.like_count - COUNT(rl.id))::INTEGER as difference
    FROM public.reviews r
    LEFT JOIN public.review_likes rl ON r.id = rl.review_id
    GROUP BY r.id, r.like_count
    HAVING r.like_count != COUNT(rl.id);
$$;

COMMENT ON FUNCTION public.verify_review_like_counts() IS 
'리뷰의 캐시된 like_count와 실제 review_likes 개수 불일치 검증';

-- ============================================================
-- PART 7: 완료 메시지
-- ============================================================

DO $$
DECLARE
    v_total_reviews INTEGER;
    v_total_likes INTEGER;
    v_max_likes INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_reviews FROM public.reviews;
    SELECT SUM(like_count) INTO v_total_likes FROM public.reviews;
    SELECT MAX(like_count) INTO v_max_likes FROM public.reviews;
    
    RAISE NOTICE '============================================================';
    RAISE NOTICE '✅ 리뷰 좋아요 개수 최적화 완료';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '   ';
    RAISE NOTICE '📊 통계:';
    RAISE NOTICE '   - 총 리뷰 개수: %', v_total_reviews;
    RAISE NOTICE '   - 총 좋아요 개수: %', COALESCE(v_total_likes, 0);
    RAISE NOTICE '   - 최대 좋아요 개수: %', COALESCE(v_max_likes, 0);
    RAISE NOTICE '   ';
    RAISE NOTICE '🔧 적용된 최적화:';
    RAISE NOTICE '   [1] reviews.like_count 컬럼 추가 (NOT NULL DEFAULT 0)';
    RAISE NOTICE '   [2] 기존 데이터 마이그레이션 완료';
    RAISE NOTICE '   [3] INSERT/DELETE 트리거 생성 (자동 동기화)';
    RAISE NOTICE '   [4] like_count 인덱스 추가 (인기 리뷰 정렬 최적화)';
    RAISE NOTICE '   ';
    RAISE NOTICE '⚡ 성능 개선:';
    RAISE NOTICE '   - 기존: SELECT COUNT(*) FROM review_likes (매번 집계)';
    RAISE NOTICE '   - 개선: SELECT like_count FROM reviews (캐시된 값)';
    RAISE NOTICE '   - 예상 성능 향상: 10~100배 (리뷰별 좋아요 개수에 비례)';
    RAISE NOTICE '   ';
    RAISE NOTICE '🧪 데이터 정합성 검증:';
    RAISE NOTICE '   SELECT * FROM public.verify_review_like_counts();';
    RAISE NOTICE '   ☝️ 불일치가 있으면 위 함수로 확인 가능';
    RAISE NOTICE '   ';
    RAISE NOTICE '📱 애플리케이션 코드 수정 필요:';
    RAISE NOTICE '   - feed/page.tsx: COUNT 대신 like_count 사용';
    RAISE NOTICE '   - 기타 리뷰 조회 쿼리: like_count 활용';
    RAISE NOTICE '============================================================';
END $$;
