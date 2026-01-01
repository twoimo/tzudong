-- 북마크 테이블 생성
CREATE TABLE IF NOT EXISTS public.user_bookmarks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_restaurant_bookmark UNIQUE(user_id, restaurant_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user_id ON public.user_bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_restaurant_id ON public.user_bookmarks(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_created_at ON public.user_bookmarks(created_at DESC);

-- RLS 활성화
ALTER TABLE public.user_bookmarks ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 사용자는 자신의 북마크만 조회 가능
CREATE POLICY "Users can view their own bookmarks"
ON public.user_bookmarks FOR SELECT
USING (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 북마크만 생성 가능
CREATE POLICY "Users can create their own bookmarks"
ON public.user_bookmarks FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 북마크만 삭제 가능
CREATE POLICY "Users can delete their own bookmarks"
ON public.user_bookmarks FOR DELETE
USING (auth.uid() = user_id);

-- 테이블 코멘트
COMMENT ON TABLE public.user_bookmarks IS '사용자 맛집 북마크';
COMMENT ON COLUMN public.user_bookmarks.user_id IS '북마크한 사용자 ID';
COMMENT ON COLUMN public.user_bookmarks.restaurant_id IS '북마크된 맛집 ID';
COMMENT ON COLUMN public.user_bookmarks.created_at IS '북마크 생성 시간';
