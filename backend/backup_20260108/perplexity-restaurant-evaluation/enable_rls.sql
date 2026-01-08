-- ============================================
-- RLS 정책 활성화 (데이터 삽입 후)
-- ============================================

-- restaurants 테이블 RLS 활성화
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

-- profiles 테이블 RLS 활성화
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 확인
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('restaurants', 'profiles');

-- rowsecurity가 true이면 RLS가 활성화된 것입니다.
