-- 주간 검색 카운트 및 검색 남용 방지 시스템
-- 작성일: 2025-12-28

-- 1. weekly_search_count 컬럼 추가
ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS weekly_search_count INTEGER DEFAULT 0;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_restaurants_weekly_search_count 
ON public.restaurants(weekly_search_count DESC);

-- 현재 search_count를 weekly_search_count로 초기화 (첫 실행 시)
UPDATE public.restaurants
SET weekly_search_count = COALESCE(search_count, 0)
WHERE weekly_search_count = 0;

-- 2. 검색 로그 테이블 생성
CREATE TABLE IF NOT EXISTS public.search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT, -- 비로그인 사용자용
  searched_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET, -- 추가 남용 방지용
  user_agent TEXT, -- 추가 남용 방지용
  counted BOOLEAN DEFAULT true -- 카운트에 반영되었는지 여부
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_search_logs_restaurant_user 
ON public.search_logs(restaurant_id, user_id, searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_logs_restaurant_session 
ON public.search_logs(restaurant_id, session_id, searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_logs_searched_at 
ON public.search_logs(searched_at DESC);

-- RLS 정책
ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;

-- 자신의 로그만 조회 가능
CREATE POLICY "Users can view own search logs"
ON public.search_logs FOR SELECT
USING (auth.uid() = user_id);

-- 시스템만 삽입 가능 (서버 함수를 통해서만)
CREATE POLICY "System can insert search logs"
ON public.search_logs FOR INSERT
WITH CHECK (true);

-- 3. increment_search_count 함수 수정 (남용 방지 포함)
CREATE OR REPLACE FUNCTION public.increment_search_count(
  restaurant_id UUID,
  user_id UUID DEFAULT NULL,
  session_id TEXT DEFAULT NULL,
  ip_address INET DEFAULT NULL,
  user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  recent_search_count INTEGER;
  result JSONB;
BEGIN
  -- 남용 감지: 1시간 내 동일 맛집 검색 횟수 확인
  IF user_id IS NOT NULL THEN
    -- 로그인 사용자: user_id 기준
    SELECT COUNT(*)
    INTO recent_search_count
    FROM public.search_logs
    WHERE 
      search_logs.restaurant_id = increment_search_count.restaurant_id
      AND search_logs.user_id = increment_search_count.user_id
      AND searched_at > NOW() - INTERVAL '1 hour';
  ELSIF session_id IS NOT NULL THEN
    -- 비로그인 사용자: session_id 기준
    SELECT COUNT(*)
    INTO recent_search_count
    FROM public.search_logs
    WHERE 
      search_logs.restaurant_id = increment_search_count.restaurant_id
      AND search_logs.session_id = increment_search_count.session_id
      AND searched_at > NOW() - INTERVAL '1 hour';
  ELSE
    -- user_id와 session_id가 모두 없으면 제한 없음 (하지만 로그는 기록)
    recent_search_count := 0;
  END IF;

  -- 1시간 내 3회 이상 검색 시 카운트 증가 차단
  IF recent_search_count >= 3 THEN
    -- 로그는 기록하되 카운트는 증가하지 않음
    INSERT INTO public.search_logs (restaurant_id, user_id, session_id, ip_address, user_agent, counted)
    VALUES (
      increment_search_count.restaurant_id,
      increment_search_count.user_id,
      increment_search_count.session_id,
      increment_search_count.ip_address,
      increment_search_count.user_agent,
      false
    );
    
    result := jsonb_build_object(
      'success', false,
      'reason', 'rate_limit_exceeded',
      'message', '1시간 내 동일 맛집 검색이 3회를 초과했습니다.'
    );
  ELSE
    -- 정상 카운트 증가
    UPDATE public.restaurants
    SET 
      search_count = COALESCE(search_count, 0) + 1,
      weekly_search_count = COALESCE(weekly_search_count, 0) + 1
    WHERE id = increment_search_count.restaurant_id;
    
    -- 로그 기록
    INSERT INTO public.search_logs (restaurant_id, user_id, session_id, ip_address, user_agent, counted)
    VALUES (
      increment_search_count.restaurant_id,
      increment_search_count.user_id,
      increment_search_count.session_id,
      increment_search_count.ip_address,
      increment_search_count.user_agent,
      true
    );
    
    result := jsonb_build_object(
      'success', true,
      'reason', 'ok',
      'message', '검색 카운트가 증가했습니다.'
    );
  END IF;
  
  RETURN result;
END;
$$;

-- 권한 부여
GRANT EXECUTE ON FUNCTION public.increment_search_count(UUID, UUID, TEXT, INET, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_search_count(UUID, UUID, TEXT, INET, TEXT) TO anon;

-- 4. 주간 검색 카운트 초기화 함수
CREATE OR REPLACE FUNCTION public.reset_weekly_search_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- weekly_search_count를 0으로 초기화
  UPDATE public.restaurants
  SET weekly_search_count = 0;
  
  -- 로그 기록
  RAISE NOTICE 'Weekly search count has been reset at %', NOW();
END;
$$;

-- 권한 부여 (service_role만 실행 가능)
GRANT EXECUTE ON FUNCTION public.reset_weekly_search_count() TO service_role;

-- 5. 오래된 검색 로그 자동 삭제 함수
CREATE OR REPLACE FUNCTION public.cleanup_old_search_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.search_logs
  WHERE searched_at < NOW() - INTERVAL '90 days';
  
  RAISE NOTICE 'Old search logs have been cleaned up at %', NOW();
END;
$$;

-- 권한 부여
GRANT EXECUTE ON FUNCTION public.cleanup_old_search_logs() TO service_role;

-- 초기화 완료 메시지
DO $$
BEGIN
  RAISE NOTICE '주간 검색 카운트 및 남용 방지 시스템이 설치되었습니다.';
  RAISE NOTICE '- weekly_search_count 컬럼 추가 완료';
  RAISE NOTICE '- search_logs 테이블 생성 완료';
  RAISE NOTICE '- increment_search_count 함수 업데이트 완료 (남용 방지 포함)';
  RAISE NOTICE '- reset_weekly_search_count 함수 생성 완료';
  RAISE NOTICE '- cleanup_old_search_logs 함수 생성 완료';
END $$;
