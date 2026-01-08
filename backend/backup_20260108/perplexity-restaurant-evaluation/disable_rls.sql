-- ============================================
-- RLS 정책 비활성화 (데이터 삽입 전)
-- ============================================

-- restaurants 테이블 RLS 비활성화
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;

-- profiles 테이블 RLS 비활성화 (필요한 경우)
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- 확인
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('restaurants', 'profiles');

-- rowsecurity가 false이면 RLS가 비활성화된 것입니다.
