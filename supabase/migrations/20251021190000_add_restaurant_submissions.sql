-- 쯔양 맛집 제보 테이블 생성
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

-- 인덱스 생성
CREATE INDEX idx_restaurant_submissions_user_id ON public.restaurant_submissions(user_id);
CREATE INDEX idx_restaurant_submissions_status ON public.restaurant_submissions(status);
CREATE INDEX idx_restaurant_submissions_created_at ON public.restaurant_submissions(created_at DESC);

-- RLS (Row Level Security) 활성화
ALTER TABLE public.restaurant_submissions ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 일반 사용자는 자신의 제보만 조회 가능
DROP POLICY IF EXISTS "Users can view their own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can view their own submissions"
    ON public.restaurant_submissions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- RLS 정책: 관리자는 모든 제보 조회 가능
DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can view all submissions"
    ON public.restaurant_submissions
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- RLS 정책: 인증된 사용자는 제보 생성 가능
DROP POLICY IF EXISTS "Authenticated users can create submissions" ON public.restaurant_submissions;
CREATE POLICY "Authenticated users can create submissions"
    ON public.restaurant_submissions
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 pending 제보만 수정 가능
DROP POLICY IF EXISTS "Users can update their own pending submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can update their own pending submissions"
    ON public.restaurant_submissions
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id AND status = 'pending')
    WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- RLS 정책: 관리자는 모든 제보 수정 가능 (검토용)
DROP POLICY IF EXISTS "Admins can update all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can update all submissions"
    ON public.restaurant_submissions
    FOR UPDATE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- RLS 정책: 사용자는 자신의 pending 제보만 삭제 가능
DROP POLICY IF EXISTS "Users can delete their own pending submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can delete their own pending submissions"
    ON public.restaurant_submissions
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id AND status = 'pending');

-- RLS 정책: 관리자는 모든 제보 삭제 가능
DROP POLICY IF EXISTS "Admins can delete all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can delete all submissions"
    ON public.restaurant_submissions
    FOR DELETE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- 제보 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW public.submission_stats AS
SELECT
    user_id,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
    COUNT(*) AS total_count
FROM public.restaurant_submissions
GROUP BY user_id;

-- 샘플 데이터 삽입은 하지 않음 (실제 사용자 제보로 채워질 예정)

