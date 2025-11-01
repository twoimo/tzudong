-- ========================================
-- Supabase 보안 경고 수정
-- function_search_path_mutable 경고 해결
-- ========================================

-- 1. update_updated_at_column 함수 search_path 설정
-- (이미 설정되어 있지만 재확인을 위해)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. get_restaurant_stats 함수 생성/수정
-- 이 함수가 존재하지 않으면 생성하고, search_path 설정
CREATE OR REPLACE FUNCTION public.get_restaurant_stats()
RETURNS TABLE (
    total_restaurants bigint,
    total_reviews bigint,
    total_verified_reviews bigint,
    avg_rating numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT r.id)::bigint as total_restaurants,
        COUNT(rv.id)::bigint as total_reviews,
        COUNT(rv.id) FILTER (WHERE rv.is_verified = true)::bigint as total_verified_reviews,
        COALESCE(AVG(rv.rating), 0)::numeric as avg_rating
    FROM restaurants r
    LEFT JOIN reviews rv ON r.id = rv.restaurant_id;
END;
$$;

-- 3. get_user_stats 함수 생성/수정
CREATE OR REPLACE FUNCTION public.get_user_stats()
RETURNS TABLE (
    total_users bigint,
    total_reviews bigint,
    total_verified_reviews bigint,
    avg_trust_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT p.user_id)::bigint as total_users,
        COUNT(rv.id)::bigint as total_reviews,
        COUNT(rv.id) FILTER (WHERE rv.is_verified = true)::bigint as total_verified_reviews,
        COALESCE(AVG(us.trust_score), 0)::numeric as avg_trust_score
    FROM profiles p
    LEFT JOIN reviews rv ON p.user_id = rv.user_id
    LEFT JOIN user_stats us ON p.user_id = us.user_id;
END;
$$;

-- 4. is_user_admin 함수 생성/수정 (기존 함수가 있으면 삭제 후 재생성)
DROP FUNCTION IF EXISTS public.is_user_admin(uuid);
CREATE FUNCTION public.is_user_admin(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = user_uuid
    AND role = 'admin'
  )
$$;

-- ========================================
-- 완료 메시지
-- ========================================

-- 모든 함수에 search_path = public이 설정되었습니다.
-- 이렇게 하면 SQL injection 공격으로부터 보호됩니다.

-- ========================================
-- 추가 설정 필요 사항
-- ========================================

-- 5. 유출된 비밀번호 보호 기능 활성화
-- 이 경고는 Supabase 대시보드에서 수동으로 해결해야 합니다:
--
-- 1. Supabase 대시보드 접속
-- 2. Authentication > Settings 이동
-- 3. "Enable password leak detection" 토글을 ON으로 설정
-- 4. 변경사항 저장
--
-- 이 기능은 사용자가 유출된 비밀번호를 사용할 때 경고를 표시합니다.
-- HaveIBeenPwned.org 서비스를 통해 확인됩니다.
