-- ========================================
-- 쯔양 맛집 지도 - 완전 통합 마이그레이션 파일
-- 작성일: 2025년 11월 7일
-- 설명: 모든 테이블, 함수, 정책을 포함한 완전한 데이터베이스 스키마
-- ========================================

-- ========================================
-- PART 1: 사용자 정의 타입(ENUM) 생성
-- ========================================

-- 1.1 앱 역할 타입 (관리자/일반 사용자)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('admin', 'user');
    END IF;
END
$$;

-- 1.2 알림 타입 (시스템/사용자/관리자 공지 등)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE public.notification_type AS ENUM (
            'system',              -- 시스템 알림
            'user',                -- 사용자 알림
            'admin_announcement',  -- 관리자 공지
            'new_restaurant',      -- 신규 맛집 등록
            'ranking_update',      -- 랭킹 업데이트
            'review_approved',     -- 리뷰 승인
            'review_rejected',     -- 리뷰 거부
            'submission_approved', -- 제출 승인
            'submission_rejected'  -- 제출 거부
        );
    END IF;
END
$$;

-- ========================================
-- PART 2: 테이블 생성
-- ========================================

-- 2.1 사용자 역할 테이블 (보안을 위해 프로필과 분리)
DROP TABLE IF EXISTS public.user_roles CASCADE;
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, role)
);

COMMENT ON TABLE public.user_roles IS '사용자 역할 관리 테이블 (admin, user)';
COMMENT ON COLUMN public.user_roles.user_id IS 'auth.users 테이블의 사용자 ID';
COMMENT ON COLUMN public.user_roles.role IS '사용자 역할 (admin: 관리자, user: 일반 사용자)';

-- 2.2 사용자 프로필 테이블
DROP TABLE IF EXISTS public.profiles CASCADE;
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    nickname TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    profile_picture TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_login TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.profiles IS '사용자 프로필 정보 테이블';
COMMENT ON COLUMN public.profiles.nickname IS '사용자 닉네임 (고유값)';
COMMENT ON COLUMN public.profiles.profile_picture IS '프로필 이미지 URL';
COMMENT ON COLUMN public.profiles.last_login IS '마지막 로그인 시간';

-- 2.3 맛집 정보 테이블
DROP TABLE IF EXISTS public.restaurants CASCADE;
CREATE TABLE public.restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    lat NUMERIC NOT NULL,
    lng NUMERIC NOT NULL,
    description TEXT,
    category TEXT[] NOT NULL,
    road_address TEXT,
    jibun_address TEXT,
    english_address TEXT,
    address_elements JSONB,
    youtube_links TEXT[] DEFAULT ARRAY[]::TEXT[],
    tzuyang_reviews JSONB DEFAULT '[]'::JSONB,
    youtube_metas JSONB DEFAULT '[]'::JSONB,
    review_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_by_admin_id UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.restaurants IS '맛집 정보 테이블';
COMMENT ON COLUMN public.restaurants.name IS '맛집 이름';
COMMENT ON COLUMN public.restaurants.lat IS '위도';
COMMENT ON COLUMN public.restaurants.lng IS '경도';
COMMENT ON COLUMN public.restaurants.category IS '맛집 카테고리 배열 (예: {한식, 고기})';
COMMENT ON COLUMN public.restaurants.road_address IS '도로명 주소';
COMMENT ON COLUMN public.restaurants.jibun_address IS '지번 주소';
COMMENT ON COLUMN public.restaurants.english_address IS '영문 주소';
COMMENT ON COLUMN public.restaurants.address_elements IS '주소 상세 정보 (JSON)';
COMMENT ON COLUMN public.restaurants.youtube_links IS '유튜브 영상 링크 배열';
COMMENT ON COLUMN public.restaurants.tzuyang_reviews IS '쯔양 리뷰 정보 (JSON 배열)';
COMMENT ON COLUMN public.restaurants.youtube_metas IS '유튜브 메타데이터 (JSON 배열)';
COMMENT ON COLUMN public.restaurants.review_count IS '리뷰 개수';

-- 2.4 리뷰 테이블
DROP TABLE IF EXISTS public.reviews CASCADE;
CREATE TABLE public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    visited_at TIMESTAMP WITH TIME ZONE NOT NULL,
    verification_photo TEXT NOT NULL,
    food_photos TEXT[] DEFAULT '{}',
    is_verified BOOLEAN DEFAULT false,
    admin_note TEXT,
    is_pinned BOOLEAN DEFAULT false,
    edited_by_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    is_edited_by_admin BOOLEAN DEFAULT false,
    edited_by_admin_id UUID REFERENCES auth.users(id),
    edited_at TIMESTAMP WITH TIME ZONE,
    category TEXT[],
    categories TEXT[]
);

COMMENT ON TABLE public.reviews IS '사용자 리뷰 테이블';
COMMENT ON COLUMN public.reviews.title IS '리뷰 제목';
COMMENT ON COLUMN public.reviews.content IS '리뷰 내용';
COMMENT ON COLUMN public.reviews.visited_at IS '방문 일시';
COMMENT ON COLUMN public.reviews.verification_photo IS '방문 인증 사진 URL';
COMMENT ON COLUMN public.reviews.food_photos IS '음식 사진 URL 배열';
COMMENT ON COLUMN public.reviews.is_verified IS '관리자 인증 여부';
COMMENT ON COLUMN public.reviews.admin_note IS '관리자 메모';
COMMENT ON COLUMN public.reviews.is_pinned IS '고정 여부';
COMMENT ON COLUMN public.reviews.edited_by_admin IS '관리자 수정 여부 (레거시)';
COMMENT ON COLUMN public.reviews.is_edited_by_admin IS '관리자 수정 여부';
COMMENT ON COLUMN public.reviews.edited_at IS '관리자 수정 시간';

-- 2.5 리뷰 좋아요 테이블
DROP TABLE IF EXISTS public.review_likes CASCADE;
CREATE TABLE public.review_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID REFERENCES public.reviews(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(review_id, user_id)
);

COMMENT ON TABLE public.review_likes IS '리뷰 좋아요 테이블';
COMMENT ON COLUMN public.review_likes.review_id IS '좋아요한 리뷰 ID';
COMMENT ON COLUMN public.review_likes.user_id IS '좋아요한 사용자 ID';

-- 2.6 서버 비용 테이블
DROP TABLE IF EXISTS public.server_costs CASCADE;
CREATE TABLE public.server_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name TEXT NOT NULL,
    monthly_cost NUMERIC NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.server_costs IS '서버 운영 비용 테이블';
COMMENT ON COLUMN public.server_costs.item_name IS '비용 항목명';
COMMENT ON COLUMN public.server_costs.monthly_cost IS '월 비용';
COMMENT ON COLUMN public.server_costs.description IS '비용 설명';

-- 2.7 사용자 통계 테이블 (리더보드용)
DROP TABLE IF EXISTS public.user_stats CASCADE;
CREATE TABLE public.user_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    review_count INTEGER DEFAULT 0,
    verified_review_count INTEGER DEFAULT 0,
    trust_score NUMERIC DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.user_stats IS '사용자 활동 통계 테이블';
COMMENT ON COLUMN public.user_stats.review_count IS '총 리뷰 작성 수';
COMMENT ON COLUMN public.user_stats.verified_review_count IS '인증된 리뷰 수';
COMMENT ON COLUMN public.user_stats.trust_score IS '신뢰도 점수 (0-100)';

-- 2.8 알림 테이블
DROP TABLE IF EXISTS public.notifications CASCADE;
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type notification_type NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.notifications IS '사용자 알림 테이블';
COMMENT ON COLUMN public.notifications.type IS '알림 타입 (system, user, admin_announcement 등)';
COMMENT ON COLUMN public.notifications.title IS '알림 제목';
COMMENT ON COLUMN public.notifications.message IS '알림 내용';
COMMENT ON COLUMN public.notifications.is_read IS '읽음 여부';
COMMENT ON COLUMN public.notifications.data IS '추가 데이터 (JSON)';

-- 2.9 관리자 공지사항 테이블
DROP TABLE IF EXISTS public.announcements CASCADE;
CREATE TABLE public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.announcements IS '관리자 공지사항 테이블';
COMMENT ON COLUMN public.announcements.admin_id IS '공지 작성 관리자 ID';
COMMENT ON COLUMN public.announcements.is_active IS '공지 활성화 여부';
COMMENT ON COLUMN public.announcements.data IS '추가 데이터 (JSON)';

-- 2.10 평가 기록 테이블 (Perplexity 크롤링 결과)
DROP TABLE IF EXISTS public.evaluation_records CASCADE;
CREATE TABLE public.evaluation_records (
    id BIGSERIAL PRIMARY KEY,
    unique_id TEXT NOT NULL UNIQUE,
    youtube_link TEXT NOT NULL,
    restaurant_name TEXT,
    status TEXT NOT NULL CHECK (status = ANY (ARRAY[
        'pending',
        'approved',
        'hold',
        'deleted',
        'missing',
        'db_conflict',
        'geocoding_failed',
        'not_selected'
    ])),
    source_type TEXT DEFAULT 'perplexity',
    youtube_meta JSONB,
    evaluation_results JSONB,
    restaurant_info JSONB,
    geocoding_success BOOLEAN DEFAULT false,
    geocoding_fail_reason TEXT,
    db_conflict_info JSONB,
    missing_message TEXT,
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.evaluation_records IS 'Perplexity AI 크롤링 평가 기록 테이블';
COMMENT ON COLUMN public.evaluation_records.unique_id IS '고유 식별자 (youtube_link 기반)';
COMMENT ON COLUMN public.evaluation_records.status IS '평가 상태 (pending, approved, hold 등)';
COMMENT ON COLUMN public.evaluation_records.geocoding_success IS '지오코딩 성공 여부';
COMMENT ON COLUMN public.evaluation_records.db_conflict_info IS 'DB 충돌 정보 (JSON)';

-- ========================================
-- PART 3: 인덱스 생성 (성능 최적화)
-- ========================================

-- 3.1 맛집 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_restaurants_lat_lng ON public.restaurants(lat, lng);
CREATE INDEX IF NOT EXISTS idx_restaurants_category ON public.restaurants USING GIN(category);

COMMENT ON INDEX idx_restaurants_lat_lng IS '지도 검색 최적화를 위한 위치 인덱스';
COMMENT ON INDEX idx_restaurants_category IS '카테고리 검색 최적화를 위한 GIN 인덱스';

-- 3.2 리뷰 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id ON public.reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON public.reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_is_verified ON public.reviews(is_verified);
CREATE INDEX IF NOT EXISTS idx_reviews_is_edited_by_admin ON public.reviews(is_edited_by_admin);

COMMENT ON INDEX idx_reviews_created_at IS '최신 리뷰 조회 최적화';

-- 3.3 리뷰 좋아요 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_review_likes_review_id ON public.review_likes(review_id);
CREATE INDEX IF NOT EXISTS idx_review_likes_user_id ON public.review_likes(user_id);

-- 3.4 사용자 통계 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_user_stats_trust_score ON public.user_stats(trust_score DESC);

COMMENT ON INDEX idx_user_stats_trust_score IS '리더보드 조회 최적화';

-- 3.5 알림 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

COMMENT ON INDEX idx_notifications_user_created IS '사용자별 최신 알림 조회 최적화';

-- 3.6 평가 기록 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_evaluation_records_status ON public.evaluation_records(status);
CREATE INDEX IF NOT EXISTS idx_evaluation_records_unique_id ON public.evaluation_records(unique_id);

-- ========================================
-- PART 4: Row Level Security (RLS) 활성화
-- ========================================

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;

-- ========================================
-- PART 5: 함수 생성
-- ========================================

-- 5.1 사용자 역할 확인 함수
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
        AND role = _role
    )
$$;

COMMENT ON FUNCTION public.has_role IS '특정 사용자가 특정 역할을 가지고 있는지 확인';

-- 5.2 관리자 여부 확인 함수
CREATE OR REPLACE FUNCTION public.is_user_admin(user_uuid UUID)
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

COMMENT ON FUNCTION public.is_user_admin IS '사용자가 관리자인지 확인';

-- 5.3 신규 사용자 처리 함수 (회원가입 시 자동 실행)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 프로필 생성
    INSERT INTO public.profiles (user_id, nickname, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'nickname', 'user_' || substr(NEW.id::text, 1, 8)),
        NEW.email
    );

    -- 일반 사용자 역할 부여
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    -- 사용자 통계 초기화
    INSERT INTO public.user_stats (user_id)
    VALUES (NEW.id);

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS '신규 사용자 가입 시 프로필, 역할, 통계 자동 생성';

-- 5.4 리뷰 개수 증가 함수
CREATE OR REPLACE FUNCTION public.increment_review_count(restaurant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.restaurants
    SET review_count = COALESCE(review_count, 0) + 1
    WHERE id = restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.increment_review_count IS '맛집의 리뷰 개수를 1 증가';

-- 5.5 리뷰 개수 감소 함수
CREATE OR REPLACE FUNCTION public.decrement_review_count(restaurant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.restaurants
    SET review_count = GREATEST(COALESCE(review_count, 0) - 1, 0)
    WHERE id = restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.decrement_review_count IS '맛집의 리뷰 개수를 1 감소 (최소 0)';

-- 5.6 사용자 통계 업데이트 함수 (리뷰 작성/인증/삭제 시)
CREATE OR REPLACE FUNCTION public.update_user_stats_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 리뷰 신규 작성
    IF TG_OP = 'INSERT' THEN
        UPDATE public.user_stats
        SET
            review_count = COALESCE(review_count, 0) + 1,
            last_updated = now()
        WHERE user_id = NEW.user_id;

        RETURN NEW;

    -- 리뷰 인증 처리
    ELSIF TG_OP = 'UPDATE' AND NEW.is_verified = true AND OLD.is_verified = false THEN
        UPDATE public.user_stats
        SET
            verified_review_count = COALESCE(verified_review_count, 0) + 1,
            trust_score = LEAST(COALESCE(trust_score, 0) + 5, 100), -- 인증 시 신뢰도 +5 (최대 100)
            last_updated = now()
        WHERE user_id = NEW.user_id;

        RETURN NEW;

    -- 리뷰 삭제
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.user_stats
        SET
            review_count = GREATEST(COALESCE(review_count, 0) - 1, 0),
            verified_review_count = CASE
                WHEN OLD.is_verified THEN GREATEST(COALESCE(verified_review_count, 0) - 1, 0)
                ELSE COALESCE(verified_review_count, 0)
            END,
            last_updated = now()
        WHERE user_id = OLD.user_id;

        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_user_stats_on_review IS '리뷰 작성/인증/삭제 시 사용자 통계 자동 업데이트';

-- 5.7 리뷰 관리자 수정 시간 설정 함수
CREATE OR REPLACE FUNCTION public.set_review_edited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_edited_by_admin = true AND (OLD.is_edited_by_admin IS NULL OR OLD.is_edited_by_admin = false) THEN
        NEW.edited_at = now();
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_review_edited_at IS '리뷰를 관리자가 수정할 때 수정 시간 자동 설정';

-- 5.8 updated_at 컬럼 자동 업데이트 함수
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

COMMENT ON FUNCTION public.update_updated_at_column IS '레코드 수정 시 updated_at 컬럼 자동 업데이트';

-- 5.9 리뷰 좋아요 개수 조회 함수
CREATE OR REPLACE FUNCTION public.get_review_like_count(review_id_param UUID)
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

COMMENT ON FUNCTION public.get_review_like_count IS '특정 리뷰의 좋아요 개수 조회';

-- 5.10 사용자가 리뷰에 좋아요 했는지 확인 함수
CREATE OR REPLACE FUNCTION public.is_review_liked_by_user(review_id_param UUID, user_id_param UUID)
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

COMMENT ON FUNCTION public.is_review_liked_by_user IS '특정 사용자가 특정 리뷰에 좋아요를 눌렀는지 확인';

-- 5.11 알림 읽음 처리 함수
CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = true
    WHERE id = notification_uuid AND user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.mark_notification_read IS '특정 알림을 읽음 처리';

-- 5.12 모든 알림 읽음 처리 함수
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = auth.uid() AND is_read = false;
END;
$$;

COMMENT ON FUNCTION public.mark_all_notifications_read IS '현재 사용자의 모든 알림을 읽음 처리';

-- 5.13 사용자 알림 생성 함수
CREATE OR REPLACE FUNCTION public.create_user_notification(
    p_user_id UUID,
    p_type notification_type,
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (p_user_id, p_type, p_title, p_message, p_data)
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;

COMMENT ON FUNCTION public.create_user_notification IS '특정 사용자에게 알림 생성';

-- 5.14 관리자 공지 알림 생성 함수 (모든 사용자에게)
CREATE OR REPLACE FUNCTION public.create_admin_announcement_notification(
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT
        p.user_id,
        'admin_announcement'::notification_type,
        p_title,
        p_message,
        p_data
    FROM public.profiles p;
END;
$$;

COMMENT ON FUNCTION public.create_admin_announcement_notification IS '모든 사용자에게 관리자 공지 알림 생성';

-- 5.15 신규 맛집 알림 생성 함수 (모든 사용자에게)
CREATE OR REPLACE FUNCTION public.create_new_restaurant_notification(
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT
        p.user_id,
        'new_restaurant'::notification_type,
        p_title,
        p_message,
        p_data
    FROM public.profiles p;
END;
$$;

COMMENT ON FUNCTION public.create_new_restaurant_notification IS '모든 사용자에게 신규 맛집 알림 생성';

-- 5.16 랭킹 업데이트 알림 생성 함수
CREATE OR REPLACE FUNCTION public.create_ranking_notification(
    p_user_id UUID,
    p_ranking INTEGER,
    p_period TEXT DEFAULT 'monthly'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    notification_id UUID;
    ranking_title TEXT;
    ranking_message TEXT;
BEGIN
    ranking_title := '랭킹 업데이트';
    ranking_message := p_period || ' 랭킹이 ' || p_ranking || '위로 업데이트되었습니다!';

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
        p_user_id,
        'ranking_update'::notification_type,
        ranking_title,
        ranking_message,
        jsonb_build_object('ranking', p_ranking, 'period', p_period)
    )
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;

COMMENT ON FUNCTION public.create_ranking_notification IS '특정 사용자에게 랭킹 업데이트 알림 생성';

-- 5.17 알림 삭제 함수
CREATE OR REPLACE FUNCTION public.delete_notification(notification_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.notifications
    WHERE id = notification_uuid AND user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.delete_notification IS '특정 알림 삭제';

-- 5.18 맛집 통계 조회 함수
CREATE OR REPLACE FUNCTION public.get_restaurant_stats()
RETURNS TABLE (
    total_restaurants BIGINT,
    total_reviews BIGINT,
    total_verified_reviews BIGINT,
    avg_rating NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT r.id)::BIGINT as total_restaurants,
        COUNT(rv.id)::BIGINT as total_reviews,
        COUNT(rv.id) FILTER (WHERE rv.is_verified = true)::BIGINT as total_verified_reviews,
        COALESCE(AVG(0), 0)::NUMERIC as avg_rating -- 평점 컬럼이 없으므로 0으로 설정
    FROM public.restaurants r
    LEFT JOIN public.reviews rv ON r.id = rv.restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.get_restaurant_stats IS '맛집 및 리뷰 전체 통계 조회';

-- 5.19 사용자 통계 조회 함수
CREATE OR REPLACE FUNCTION public.get_user_stats()
RETURNS TABLE (
    total_users BIGINT,
    total_reviews BIGINT,
    total_verified_reviews BIGINT,
    avg_trust_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT p.user_id)::BIGINT as total_users,
        COUNT(rv.id)::BIGINT as total_reviews,
        COUNT(rv.id) FILTER (WHERE rv.is_verified = true)::BIGINT as total_verified_reviews,
        COALESCE(AVG(us.trust_score), 0)::NUMERIC as avg_trust_score
    FROM public.profiles p
    LEFT JOIN public.reviews rv ON p.user_id = rv.user_id
    LEFT JOIN public.user_stats us ON p.user_id = us.user_id;
END;
$$;

COMMENT ON FUNCTION public.get_user_stats IS '사용자 및 리뷰 전체 통계 조회';

-- ========================================
-- PART 6: 트리거 생성
-- ========================================

-- 6.1 신규 사용자 트리거 (회원가입 시)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON TRIGGER on_auth_user_created ON auth.users IS '신규 사용자 가입 시 프로필/역할/통계 자동 생성';

-- 6.2 사용자 통계 업데이트 트리거 (리뷰 작성/인증/삭제 시)
DROP TRIGGER IF EXISTS trigger_update_user_stats ON public.reviews;
CREATE TRIGGER trigger_update_user_stats
    AFTER INSERT OR UPDATE OR DELETE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.update_user_stats_on_review();

COMMENT ON TRIGGER trigger_update_user_stats ON public.reviews IS '리뷰 작성/인증/삭제 시 사용자 통계 자동 업데이트';

-- 6.3 리뷰 관리자 수정 시간 트리거
DROP TRIGGER IF EXISTS trigger_set_review_edited_at ON public.reviews;
CREATE TRIGGER trigger_set_review_edited_at
    BEFORE UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.set_review_edited_at();

COMMENT ON TRIGGER trigger_set_review_edited_at ON public.reviews IS '리뷰 관리자 수정 시 edited_at 자동 설정';

-- 6.4 맛집 updated_at 트리거
DROP TRIGGER IF EXISTS update_restaurants_updated_at ON public.restaurants;
CREATE TRIGGER update_restaurants_updated_at
    BEFORE UPDATE ON public.restaurants
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TRIGGER update_restaurants_updated_at ON public.restaurants IS '맛집 정보 수정 시 updated_at 자동 업데이트';

-- 6.5 리뷰 updated_at 트리거
DROP TRIGGER IF EXISTS update_reviews_updated_at ON public.reviews;
CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TRIGGER update_reviews_updated_at ON public.reviews IS '리뷰 수정 시 updated_at 자동 업데이트';

-- 6.6 서버 비용 updated_at 트리거
DROP TRIGGER IF EXISTS update_server_costs_updated_at ON public.server_costs;
CREATE TRIGGER update_server_costs_updated_at
    BEFORE UPDATE ON public.server_costs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TRIGGER update_server_costs_updated_at ON public.server_costs IS '서버 비용 수정 시 updated_at 자동 업데이트';

-- 6.7 공지사항 updated_at 트리거
DROP TRIGGER IF EXISTS update_announcements_updated_at ON public.announcements;
CREATE TRIGGER update_announcements_updated_at
    BEFORE UPDATE ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TRIGGER update_announcements_updated_at ON public.announcements IS '공지사항 수정 시 updated_at 자동 업데이트';

-- 6.8 평가 기록 updated_at 트리거
DROP TRIGGER IF EXISTS update_evaluation_records_updated_at ON public.evaluation_records;
CREATE TRIGGER update_evaluation_records_updated_at
    BEFORE UPDATE ON public.evaluation_records
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TRIGGER update_evaluation_records_updated_at ON public.evaluation_records IS '평가 기록 수정 시 updated_at 자동 업데이트';

-- ========================================
-- PART 7: Row Level Security (RLS) 정책
-- ========================================

-- 7.1 사용자 역할 테이블 정책
DROP POLICY IF EXISTS "Users and admins can view roles" ON public.user_roles;
CREATE POLICY "Users and admins can view roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 7.2 프로필 테이블 정책
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone"
    ON public.profiles FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- 7.3 맛집 테이블 정책
DROP POLICY IF EXISTS "Restaurants are viewable by everyone" ON public.restaurants;
CREATE POLICY "Restaurants are viewable by everyone"
    ON public.restaurants FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Admins can insert restaurants" ON public.restaurants;
CREATE POLICY "Admins can insert restaurants"
    ON public.restaurants FOR INSERT
    TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update restaurants" ON public.restaurants;
CREATE POLICY "Admins can update restaurants"
    ON public.restaurants FOR UPDATE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete restaurants" ON public.restaurants;
CREATE POLICY "Admins can delete restaurants"
    ON public.restaurants FOR DELETE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- 7.4 리뷰 테이블 정책
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;
CREATE POLICY "Reviews are viewable by everyone"
    ON public.reviews FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Users can insert own reviews" ON public.reviews;
CREATE POLICY "Users can insert own reviews"
    ON public.reviews FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users and admins can update reviews" ON public.reviews;
CREATE POLICY "Users and admins can update reviews"
    ON public.reviews FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users and admins can delete reviews" ON public.reviews;
CREATE POLICY "Users and admins can delete reviews"
    ON public.reviews FOR DELETE
    TO authenticated
    USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 7.5 리뷰 좋아요 테이블 정책
DROP POLICY IF EXISTS "Anyone can view review likes" ON public.review_likes;
CREATE POLICY "Anyone can view review likes"
    ON public.review_likes FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert own review likes" ON public.review_likes;
CREATE POLICY "Authenticated users can insert own review likes"
    ON public.review_likes FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own review likes" ON public.review_likes;
CREATE POLICY "Users can delete own review likes"
    ON public.review_likes FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- 7.6 서버 비용 테이블 정책
DROP POLICY IF EXISTS "Server costs are viewable by everyone" ON public.server_costs;
CREATE POLICY "Server costs are viewable by everyone"
    ON public.server_costs FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Admins can manage server costs" ON public.server_costs;
CREATE POLICY "Admins can manage server costs"
    ON public.server_costs FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- 7.7 사용자 통계 테이블 정책
DROP POLICY IF EXISTS "User stats are viewable by everyone" ON public.user_stats;
CREATE POLICY "User stats are viewable by everyone"
    ON public.user_stats FOR SELECT
    TO public
    USING (true);

-- 7.8 알림 테이블 정책
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "System can insert notifications"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own notifications (read status)" ON public.notifications;
CREATE POLICY "Users can update own notifications (read status)"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
    ON public.notifications FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- 7.9 공지사항 테이블 정책
DROP POLICY IF EXISTS "Announcements are viewable by everyone" ON public.announcements;
CREATE POLICY "Announcements are viewable by everyone"
    ON public.announcements FOR SELECT
    TO public
    USING (is_active = true);

DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Admins can manage announcements"
    ON public.announcements FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- 7.10 평가 기록 테이블 정책
DROP POLICY IF EXISTS "Admins can view evaluation records" ON public.evaluation_records;
CREATE POLICY "Admins can view evaluation records"
    ON public.evaluation_records FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can manage evaluation records" ON public.evaluation_records;
CREATE POLICY "Admins can manage evaluation records"
    ON public.evaluation_records FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- PART 8: Storage 버킷 및 정책
-- ========================================

-- 8.1 리뷰 사진 저장 버킷 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-photos', 'review-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 8.2 리뷰 사진 Storage 정책
DROP POLICY IF EXISTS "Anyone can view review photos" ON storage.objects;
CREATE POLICY "Anyone can view review photos"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'review-photos');

DROP POLICY IF EXISTS "Authenticated users can upload review photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload review photos"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'review-photos');

DROP POLICY IF EXISTS "Users can update own review photos" ON storage.objects;
CREATE POLICY "Users can update own review photos"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete own review photos" ON storage.objects;
CREATE POLICY "Users can delete own review photos"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ========================================
-- PART 9: 권한 부여
-- ========================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ========================================
-- PART 10: 초기 데이터 및 관리자 설정
-- ========================================

-- 10.1 관리자 권한 부여 (twoimo@dgu.ac.kr)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'twoimo@dgu.ac.kr'
ON CONFLICT (user_id, role) DO NOTHING;

-- ========================================
-- 마이그레이션 완료
-- ========================================

-- 모든 테이블, 함수, 트리거, RLS 정책이 성공적으로 생성되었습니다.
-- 이 파일은 Supabase SQL Editor에서 한 번에 실행 가능합니다.
