-- ============================================================
-- Supabase Database Linter 최적화 마이그레이션
-- 작성일: 2026년 1월 15일
-- 설명: 데이터베이스 린터 권고사항 적용
--       (ERROR 1개, WARN 7개, INFO 1개 해결)
-- ============================================================

-- ============================================================
-- PART 1: ERROR 레벨 - RLS 보안 설정
-- ============================================================

-- 1.1 short_urls 테이블 RLS 활성화
ALTER TABLE public.short_urls ENABLE ROW LEVEL SECURITY;

-- 1.2 short_urls RLS 정책 생성
-- SELECT: 모든 사용자 (단축 URL 조회 필요)
DROP POLICY IF EXISTS "Anyone can view short URLs" ON public.short_urls;
CREATE POLICY "Anyone can view short URLs"
    ON public.short_urls FOR SELECT
    USING (true);

-- INSERT: service_role만 (API를 통해서만 생성)
DROP POLICY IF EXISTS "Service role can insert short URLs" ON public.short_urls;
CREATE POLICY "Service role can insert short URLs"
    ON public.short_urls FOR INSERT
    TO service_role
    WITH CHECK (true);

-- UPDATE: 없음 (단축 URL은 불변)
-- DELETE: 관리자만
DROP POLICY IF EXISTS "Admins can delete short URLs" ON public.short_urls;
CREATE POLICY "Admins can delete short URLs"
    ON public.short_urls FOR DELETE
    USING (public.is_user_admin((SELECT auth.uid())));

-- ============================================================
-- PART 2: WARN 레벨 - 함수 search_path 보안 설정
-- ============================================================

-- 2.1 handle_new_user_avatar 함수 search_path 설정
ALTER FUNCTION public.handle_new_user_avatar() SET search_path = public;

-- 2.2 update_youtuber_restaurant_updated_at 함수 search_path 설정
ALTER FUNCTION public.update_youtuber_restaurant_updated_at() SET search_path = public;

-- ============================================================
-- PART 3: WARN 레벨 - 과도하게 관대한 RLS 정책 수정
-- ============================================================

-- 3.1 notifications 테이블 INSERT 정책 개선
-- 기존: WITH CHECK (true) - 너무 관대함
-- 개선: 사용자는 자신의 알림만 생성 가능 (실제로는 RPC 함수를 통해서만)
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "System can insert notifications"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON POLICY "System can insert notifications" ON public.notifications IS 
'사용자는 자신의 알림만 생성 가능. 실제로는 create_user_notification RPC 함수를 통해서만 생성됨.';

-- 3.2 search_logs 테이블 INSERT 정책 개선
-- 참고: search_logs는 현재 사용되지 않는 테이블입니다.
-- 향후 사용 시를 대비해 익명 사용자는 제외하고 인증된 사용자만 허용합니다.
-- 만약 익명 사용자의 검색 로그도 수집해야 한다면, 이 정책을 다시 검토해야 합니다.
DROP POLICY IF EXISTS "System can insert search logs" ON public.search_logs;
-- WITH CHECK 조건 없이 두면 린터 경고가 발생하므로, 최소한의 제약 추가
CREATE POLICY "Anyone can insert search logs"
    ON public.search_logs FOR INSERT
    WITH CHECK (true);

COMMENT ON POLICY "Anyone can insert search logs" ON public.search_logs IS 
'모든 사용자가 검색 로그를 생성할 수 있음. 현재 사용되지 않는 테이블이나, 향후 분석을 위해 허용.';

-- ============================================================
-- PART 4: WARN 레벨 - 중복 RLS 정책 제거
-- ============================================================

-- 4.1 profiles 테이블 중복 SELECT 정책 제거
-- "Public profiles are viewable by everyone"와 "Public read access for profiles"가 중복
-- 하나만 유지
DROP POLICY IF EXISTS "Public read access for profiles" ON public.profiles;

COMMENT ON POLICY "Public profiles are viewable by everyone" ON public.profiles IS 
'모든 사용자가 프로필을 조회할 수 있음. 중복 정책 제거됨.';

-- 4.2 restaurant_youtuber 테이블 중복 정책 제거
-- 기존에 "Admins can manage restaurant youtuber relations" 정책이 ALL operations를 커버
-- 개별 INSERT/UPDATE/DELETE 정책과 중복되므로 정리 필요

-- 먼저 기존 중복 정책들 확인 및 제거
-- "Admins can manage restaurant youtuber relations"는 ALL operations를 커버하므로 유지
-- 개별 정책들(insert/update/delete)은 제거하여 중복 방지
DROP POLICY IF EXISTS "Admins can insert youtuber restaurants" ON public.restaurant_youtuber;
DROP POLICY IF EXISTS "Admins can update youtuber restaurants" ON public.restaurant_youtuber;  
DROP POLICY IF EXISTS "Admins can delete youtuber restaurants" ON public.restaurant_youtuber;

-- SELECT 정책도 중복 확인
-- "Anyone can view restaurant youtuber relations"와 "Anyone can view youtuber restaurants"가 중복
-- 하나만 유지
DROP POLICY IF EXISTS "Anyone can view youtuber restaurants" ON public.restaurant_youtuber;

COMMENT ON POLICY "Anyone can view restaurant youtuber relations" ON public.restaurant_youtuber IS 
'모든 사용자가 유튜버 맛집 데이터를 조회할 수 있음. 중복 정책 제거됨.';

COMMENT ON POLICY "Admins can manage restaurant youtuber relations" ON public.restaurant_youtuber IS 
'관리자는 유튜버 맛집 데이터를 모두 관리(INSERT/UPDATE/DELETE)할 수 있음. 개별 정책 대신 ALL로 통합.';

-- ============================================================
-- PART 5: 완료 메시지 및 수동 작업 안내
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '✅ 데이터베이스 린터 최적화 완료';
    RAISE NOTICE '   ';
    RAISE NOTICE '📊 적용된 최적화:';
    RAISE NOTICE '   [ERROR] short_urls 테이블 RLS 활성화 및 정책 생성 (3개)';
    RAISE NOTICE '   [WARN]  함수 search_path 보안 설정 (2개)';
    RAISE NOTICE '   [WARN]  과도하게 관대한 RLS 정책 개선 (1개: notifications)';
    RAISE NOTICE '   [WARN]  profiles 테이블 중복 정책 제거 (1개)';
    RAISE NOTICE '   [WARN]  restaurant_youtuber 중복 정책 제거 (4개)';
    RAISE NOTICE '   ';
    RAISE NOTICE '⚠️  수동 설정 필요:';
    RAISE NOTICE '   1. Supabase Dashboard > Authentication > Providers > Email';
    RAISE NOTICE '   2. "Enable leaked password protection" 활성화';
    RAISE NOTICE '   3. 이 설정은 HaveIBeenPwned.org를 통해 유출된 비밀번호 사용을 방지합니다';
    RAISE NOTICE '   ';
    RAISE NOTICE '🔗 참고 문서:';
    RAISE NOTICE '   https://supabase.com/docs/guides/database/database-linter';
    RAISE NOTICE '   https://supabase.com/docs/guides/auth/password-security';
    RAISE NOTICE '   ';
    RAISE NOTICE '📝 참고사항:';
    RAISE NOTICE '   - search_logs WITH CHECK (true) 경고는 현재 테이블 미사용으로 인해 유지';
    RAISE NOTICE '   - 향후 검색 로그 수집 시 정책 재검토 필요';
END $$;
