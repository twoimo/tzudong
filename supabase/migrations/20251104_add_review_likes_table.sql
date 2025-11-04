    -- ========================================
    -- 리뷰 좋아요 기능 추가
    -- ========================================

    -- Create review_likes table
    DROP TABLE IF EXISTS public.review_likes CASCADE;
    CREATE TABLE public.review_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID REFERENCES public.reviews(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(review_id, user_id)
    );

    -- Enable RLS
    ALTER TABLE public.review_likes ENABLE ROW LEVEL SECURITY;

    -- RLS Policies
    CREATE POLICY "Anyone can view review likes"
    ON public.review_likes FOR SELECT
    TO public
    USING (true);

    CREATE POLICY "Authenticated users can insert own review likes"
    ON public.review_likes FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (select auth.uid()));

    CREATE POLICY "Users can delete own review likes"
    ON public.review_likes FOR DELETE
    TO authenticated
    USING (user_id = (select auth.uid()));

    -- Create function to get review like count
    CREATE OR REPLACE FUNCTION get_review_like_count(review_id_param UUID)
    RETURNS INTEGER
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
    SELECT COUNT(*)::INTEGER
    FROM public.review_likes
    WHERE review_id = review_id_param;
    $$;

    -- Create function to check if user liked review
    CREATE OR REPLACE FUNCTION is_review_liked_by_user(review_id_param UUID, user_id_param UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.review_likes
        WHERE review_id = review_id_param AND user_id = user_id_param
    );
    $$;
