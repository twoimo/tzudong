-- ========================================
-- 쯔양 맛집 제보 시스템 설치 스크립트
-- ========================================

-- 1. 기존 정책 삭제 (있으면)
DROP POLICY IF EXISTS "Users can view their own submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Authenticated users can create submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users can update their own pending submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can update all submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users can delete their own pending submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can delete all submissions" ON public.restaurant_submissions;

-- 2. 기존 뷰 삭제 (있으면)
DROP VIEW IF EXISTS public.submission_stats;

-- 3. 테이블 생성
CREATE TABLE IF NOT EXISTS public.restaurant_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT,
    category TEXT NOT NULL CHECK (category IN (
        '치킨', '중식', '돈까스·회', '피자', '패스트푸드', 
        '찜·탕', '족발·보쌈', '분식', '카페·디저트', '한식', 
        '고기', '양식', '아시안', '야식', '도시락'
    )),
    youtube_link TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by_admin_id UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    approved_restaurant_id UUID REFERENCES public.restaurants(id)
);

-- 4. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_user_id ON public.restaurant_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_status ON public.restaurant_submissions(status);
CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_created_at ON public.restaurant_submissions(created_at DESC);

-- 5. RLS (Row Level Security) 활성화
ALTER TABLE public.restaurant_submissions ENABLE ROW LEVEL SECURITY;

-- 6. RLS 정책 생성 (최적화된 단일 정책)
-- 인증된 사용자는 자신의 제보나 관리자인 경우 모든 제보 조회 가능
CREATE POLICY "Users and admins can view submissions"
    ON public.restaurant_submissions
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));

-- 인증된 사용자는 제보 생성 가능
CREATE POLICY "Authenticated users can create submissions"
    ON public.restaurant_submissions
    FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);

-- 사용자는 자신의 pending 제보만 수정 가능, 관리자는 모든 제보 수정 가능
CREATE POLICY "Users and admins can update submissions"
    ON public.restaurant_submissions
    FOR UPDATE
    TO authenticated
    USING (((select auth.uid()) = user_id AND status = 'pending') OR public.has_role((select auth.uid()), 'admin'))
    WITH CHECK (((select auth.uid()) = user_id AND status = 'pending') OR public.has_role((select auth.uid()), 'admin'));

-- 사용자는 자신의 pending 제보만 삭제 가능, 관리자는 모든 제보 삭제 가능
CREATE POLICY "Users and admins can delete submissions"
    ON public.restaurant_submissions
    FOR DELETE
    TO authenticated
    USING (((select auth.uid()) = user_id AND status = 'pending') OR public.has_role((select auth.uid()), 'admin'));

-- 7. 제보 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW public.submission_stats AS
SELECT
    user_id,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
    COUNT(*) AS total_count
FROM public.restaurant_submissions
GROUP BY user_id;

-- 8. 완료 메시지
SELECT '✅ restaurant_submissions 테이블이 성공적으로 생성되었습니다!' as message;

