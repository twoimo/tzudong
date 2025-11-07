-- ========================================
-- 쯔양 맛집 지도 - 완전 통합 마이그레이션 파일 (v3.0)
-- 작성일: 2025년 11월 7일
-- 버전: 3.0 - restaurants + evaluation_records 테이블 통합
-- 설명: 모든 테이블, 함수, 정책을 포함한 완전한 데이터베이스 스키마
-- 
-- 주요 변경사항:
-- - restaurants와 evaluation_records 테이블 통합
-- - 승인 시스템 추가 (status: pending, approved, rejected)
-- - RLS 정책: 일반 사용자는 승인된 맛집만 조회
-- - 관리자 전용 승인/거부 함수 추가
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
    nickname TEXT NOT NULL UNIQUE CHECK (length(nickname) >= 2 AND length(nickname) <= 20),
    email TEXT NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    profile_picture TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_login TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS '사용자 프로필 정보 테이블';
COMMENT ON COLUMN public.profiles.nickname IS '사용자 닉네임 (고유값, 2-20자)';
COMMENT ON COLUMN public.profiles.email IS '이메일 주소 (형식 검증)';
COMMENT ON COLUMN public.profiles.profile_picture IS '프로필 이미지 URL';
COMMENT ON COLUMN public.profiles.last_login IS '마지막 로그인 시간';

-- 2.3 맛집 정보 테이블 (통합: restaurants + evaluation_records)
DROP TABLE IF EXISTS public.restaurants CASCADE;
CREATE TABLE public.restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 기본 정보
    name TEXT NOT NULL CHECK (length(name) >= 2 AND length(name) <= 100),
    phone TEXT CHECK (phone IS NULL OR phone ~ '^\d{2,3}-\d{3,4}-\d{4}$'),
    description TEXT,
    category TEXT[] CHECK (category IS NULL OR (array_length(category, 1) > 0 AND array_length(category, 1) <= 5)),
    
    -- 위치 정보
    lat NUMERIC CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
    lng NUMERIC CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
    
    -- 주소 정보
    road_address TEXT,
    jibun_address TEXT,
    english_address TEXT,
    address_elements JSONB DEFAULT '{}'::JSONB,
    origin_address JSONB,  -- AI 크롤링 원본 주소 정보 (JSON: {address, lat, lng})
    
    -- 유튜브 관련 정보
    youtube_links TEXT[] DEFAULT ARRAY[]::TEXT[],
    youtube_meta JSONB,  -- 개별 유튜브 메타데이터 (AI 크롤링용)
    youtube_metas JSONB DEFAULT '[]'::JSONB,  -- 복수 유튜브 메타데이터 배열
    unique_id TEXT UNIQUE,  -- AI 크롤링 고유 식별자 (youtube_link 기반)
    
    -- 쯔양 리뷰 정보
    tzuyang_reviews JSONB DEFAULT '[]'::JSONB,  -- 쯔양 리뷰 정보 (JSONB 배열)
    reasoning_basis TEXT,  -- AI 평가 근거
    
    -- AI 평가 정보
    evaluation_results JSONB,  -- AI 평가 결과 (JSON)
    
    -- 지오코딩 정보
    geocoding_success BOOLEAN NOT NULL DEFAULT false,
    geocoding_false_stage INTEGER CHECK (geocoding_false_stage IS NULL OR geocoding_false_stage IN (0, 1, 2)),
    
    -- 상태 관리
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    is_missing BOOLEAN NOT NULL DEFAULT false,  -- 맛집 정보 누락 여부
    is_not_selected BOOLEAN NOT NULL DEFAULT false,  -- 선택되지 않음 여부
    
    -- 리뷰 통계
    review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    
    -- 관리자 정보
    admin_notes TEXT,  -- 관리자 메모
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- 타임스탬프
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    
    -- 데이터 무결성을 위한 제약조건
    CONSTRAINT restaurants_approved_data_check CHECK (
        -- status가 'approved'인 경우 필수 데이터 검증
        (status = 'approved' AND 
         lat IS NOT NULL AND 
         lng IS NOT NULL AND 
         category IS NOT NULL AND
         (road_address IS NOT NULL OR jibun_address IS NOT NULL)) OR
        -- 그 외의 status는 제약 없음
        status IN ('pending', 'rejected')
    ),
    CONSTRAINT restaurants_geocoding_stage_check CHECK (
        (geocoding_success = true AND geocoding_false_stage IS NULL) OR
        (geocoding_success = false AND geocoding_false_stage IS NOT NULL) OR
        (geocoding_success = false AND geocoding_false_stage IS NULL)
    ),
    CONSTRAINT restaurants_missing_data_check CHECK (
        (is_missing = false AND (road_address IS NOT NULL OR jibun_address IS NOT NULL)) OR
        is_missing = true
    )
);

COMMENT ON TABLE public.restaurants IS '맛집 정보 통합 테이블 (restaurants + evaluation_records)';
COMMENT ON COLUMN public.restaurants.name IS '맛집 이름 (2-100자)';
COMMENT ON COLUMN public.restaurants.phone IS '전화번호 (형식: 02-1234-5678 또는 010-1234-5678)';
COMMENT ON COLUMN public.restaurants.lat IS '위도 (범위: -90 ~ 90, status=approved일 때 필수)';
COMMENT ON COLUMN public.restaurants.lng IS '경도 (범위: -180 ~ 180, status=approved일 때 필수)';
COMMENT ON COLUMN public.restaurants.category IS '맛집 카테고리 배열 (1-5개, status=approved일 때 필수)';
COMMENT ON COLUMN public.restaurants.road_address IS '도로명 주소';
COMMENT ON COLUMN public.restaurants.jibun_address IS '지번 주소';
COMMENT ON COLUMN public.restaurants.english_address IS '영문 주소';
COMMENT ON COLUMN public.restaurants.address_elements IS '주소 상세 정보 (JSONB)';
COMMENT ON COLUMN public.restaurants.origin_address IS 'AI 크롤링 원본 주소 정보 (JSON: {address, lat, lng})';
COMMENT ON COLUMN public.restaurants.youtube_links IS '유튜브 영상 링크 배열';
COMMENT ON COLUMN public.restaurants.youtube_meta IS '개별 유튜브 메타데이터 (AI 크롤링용)';
COMMENT ON COLUMN public.restaurants.youtube_metas IS '복수 유튜브 메타데이터 배열';
COMMENT ON COLUMN public.restaurants.unique_id IS 'AI 크롤링 고유 식별자 (youtube_link 기반)';
COMMENT ON COLUMN public.restaurants.tzuyang_reviews IS '쯔양 리뷰 정보 (JSONB 배열)';
COMMENT ON COLUMN public.restaurants.reasoning_basis IS 'AI 평가 근거';
COMMENT ON COLUMN public.restaurants.evaluation_results IS 'AI 평가 결과 (JSON)';
COMMENT ON COLUMN public.restaurants.geocoding_success IS '지오코딩 성공 여부';
COMMENT ON COLUMN public.restaurants.geocoding_false_stage IS '지오코딩 실패 단계 (0: 초기, 1: 중간, 2: 최종)';
COMMENT ON COLUMN public.restaurants.status IS '승인 상태 (pending: 대기, approved: 승인, rejected: 거부)';
COMMENT ON COLUMN public.restaurants.is_missing IS '맛집 정보 누락 여부';
COMMENT ON COLUMN public.restaurants.is_not_selected IS '선택되지 않음 여부';
COMMENT ON COLUMN public.restaurants.review_count IS '리뷰 개수 (0 이상)';
COMMENT ON COLUMN public.restaurants.admin_notes IS '관리자 메모';

-- 2.4 리뷰 테이블
DROP TABLE IF EXISTS public.reviews CASCADE;
CREATE TABLE public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL CHECK (length(title) >= 2 AND length(title) <= 200),
    content TEXT NOT NULL CHECK (length(content) >= 10),
    visited_at TIMESTAMP WITH TIME ZONE NOT NULL CHECK (visited_at <= now()),
    verification_photo TEXT NOT NULL,
    food_photos TEXT[] DEFAULT ARRAY[]::TEXT[],
    categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    is_verified BOOLEAN NOT NULL DEFAULT false,
    admin_note TEXT,
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    is_edited_by_admin BOOLEAN NOT NULL DEFAULT false,
    edited_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    edited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    
    -- 데이터 무결성을 위한 제약조건
    CONSTRAINT reviews_edited_consistency CHECK (
        (is_edited_by_admin = false AND edited_by_admin_id IS NULL AND edited_at IS NULL) OR
        (is_edited_by_admin = true AND edited_by_admin_id IS NOT NULL AND edited_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.reviews IS '사용자 리뷰 테이블';
COMMENT ON COLUMN public.reviews.title IS '리뷰 제목 (2-200자)';
COMMENT ON COLUMN public.reviews.content IS '리뷰 내용 (최소 10자)';
COMMENT ON COLUMN public.reviews.visited_at IS '방문 일시 (미래 날짜 불가)';
COMMENT ON COLUMN public.reviews.verification_photo IS '방문 인증 사진 URL';
COMMENT ON COLUMN public.reviews.food_photos IS '음식 사진 URL 배열';
COMMENT ON COLUMN public.reviews.categories IS '리뷰 카테고리 배열';
COMMENT ON COLUMN public.reviews.is_verified IS '관리자 인증 여부';
COMMENT ON COLUMN public.reviews.admin_note IS '관리자 메모';
COMMENT ON COLUMN public.reviews.is_pinned IS '고정 여부';
COMMENT ON COLUMN public.reviews.is_edited_by_admin IS '관리자 수정 여부';
COMMENT ON COLUMN public.reviews.edited_by_admin_id IS '수정한 관리자 ID';
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
    item_name TEXT NOT NULL CHECK (length(item_name) >= 2),
    monthly_cost NUMERIC NOT NULL CHECK (monthly_cost >= 0),
    description TEXT,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.server_costs IS '서버 운영 비용 테이블';
COMMENT ON COLUMN public.server_costs.item_name IS '비용 항목명 (최소 2자)';
COMMENT ON COLUMN public.server_costs.monthly_cost IS '월 비용 (0 이상)';
COMMENT ON COLUMN public.server_costs.description IS '비용 설명';

-- 2.7 사용자 통계 테이블 (리더보드용)
DROP TABLE IF EXISTS public.user_stats CASCADE;
CREATE TABLE public.user_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    verified_review_count INTEGER NOT NULL DEFAULT 0 CHECK (verified_review_count >= 0),
    trust_score NUMERIC NOT NULL DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 100),
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    
    -- 데이터 무결성을 위한 제약조건
    CONSTRAINT user_stats_count_consistency CHECK (verified_review_count <= review_count)
);

COMMENT ON TABLE public.user_stats IS '사용자 활동 통계 테이블';
COMMENT ON COLUMN public.user_stats.review_count IS '총 리뷰 작성 수 (0 이상)';
COMMENT ON COLUMN public.user_stats.verified_review_count IS '인증된 리뷰 수 (0 이상, review_count 이하)';
COMMENT ON COLUMN public.user_stats.trust_score IS '신뢰도 점수 (0-100)';

-- 2.8 알림 테이블
DROP TABLE IF EXISTS public.notifications CASCADE;
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type notification_type NOT NULL DEFAULT 'system',
    title TEXT NOT NULL CHECK (length(title) >= 1 AND length(title) <= 100),
    message TEXT NOT NULL CHECK (length(message) >= 1 AND length(message) <= 500),
    is_read BOOLEAN NOT NULL DEFAULT false,
    data JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS '사용자 알림 테이블';
COMMENT ON COLUMN public.notifications.type IS '알림 타입 (system, user, admin_announcement 등)';
COMMENT ON COLUMN public.notifications.title IS '알림 제목 (1-100자)';
COMMENT ON COLUMN public.notifications.message IS '알림 내용 (1-500자)';
COMMENT ON COLUMN public.notifications.is_read IS '읽음 여부';
COMMENT ON COLUMN public.notifications.data IS '추가 데이터 (JSONB)';

-- 2.9 관리자 공지사항 테이블
DROP TABLE IF EXISTS public.announcements CASCADE;
CREATE TABLE public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (length(title) >= 1 AND length(title) <= 100),
    message TEXT NOT NULL CHECK (length(message) >= 1),
    data JSONB DEFAULT '{}'::JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.announcements IS '관리자 공지사항 테이블';
COMMENT ON COLUMN public.announcements.admin_id IS '공지 작성 관리자 ID';
COMMENT ON COLUMN public.announcements.title IS '공지 제목 (1-100자)';
COMMENT ON COLUMN public.announcements.message IS '공지 내용 (1자 이상)';
COMMENT ON COLUMN public.announcements.is_active IS '공지 활성화 여부';
COMMENT ON COLUMN public.announcements.data IS '추가 데이터 (JSONB)';

-- 2.10 evaluation_records 테이블은 restaurants 테이블과 통합되었습니다.
-- 모든 평가 기록은 restaurants 테이블에서 status 필드로 관리됩니다.
-- - status = 'pending': 승인 대기 중
-- - status = 'approved': 승인됨 (일반 사용자에게 조회 가능)
-- - status = 'rejected': 거부됨

-- ========================================
-- PART 3: 인덱스 생성 (성능 최적화)
-- ========================================

-- 3.0 프로필 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_nickname ON public.profiles(nickname);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles(created_at DESC);

COMMENT ON INDEX idx_profiles_nickname IS '닉네임 검색 최적화';
COMMENT ON INDEX idx_profiles_email IS '이메일 검색 최적화';

-- 3.1 맛집 테이블 인덱스
-- 기본 인덱스
CREATE INDEX IF NOT EXISTS idx_restaurants_name ON public.restaurants(name);
CREATE INDEX IF NOT EXISTS idx_restaurants_lat_lng ON public.restaurants(lat, lng);
CREATE INDEX IF NOT EXISTS idx_restaurants_category ON public.restaurants USING GIN(category);
CREATE INDEX IF NOT EXISTS idx_restaurants_created_at ON public.restaurants(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurants_review_count ON public.restaurants(review_count DESC);

-- 상태 관리 인덱스
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON public.restaurants(status);
CREATE INDEX IF NOT EXISTS idx_restaurants_unique_id ON public.restaurants(unique_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_geocoding_success ON public.restaurants(geocoding_success);
CREATE INDEX IF NOT EXISTS idx_restaurants_geocoding_false_stage ON public.restaurants(geocoding_false_stage) WHERE geocoding_success = false;

-- 부분 인덱스 (승인된 맛집만 - 일반 사용자 조회용)
CREATE INDEX IF NOT EXISTS idx_restaurants_approved ON public.restaurants(created_at DESC, review_count DESC) 
    WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_restaurants_approved_with_reviews ON public.restaurants(review_count DESC, created_at DESC) 
    WHERE status = 'approved' AND review_count > 0;

-- 부분 인덱스 (관리자용 - 승인 대기, 거부된 맛집)
CREATE INDEX IF NOT EXISTS idx_restaurants_pending ON public.restaurants(created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_restaurants_rejected ON public.restaurants(created_at DESC) WHERE status = 'rejected';
CREATE INDEX IF NOT EXISTS idx_restaurants_missing ON public.restaurants(created_at DESC) WHERE is_missing = true;
CREATE INDEX IF NOT EXISTS idx_restaurants_not_selected ON public.restaurants(created_at DESC) WHERE is_not_selected = true;

-- JSONB 인덱스 (빠른 검색을 위한 GIN 인덱스)
CREATE INDEX IF NOT EXISTS idx_restaurants_address_elements ON public.restaurants USING GIN(address_elements);
CREATE INDEX IF NOT EXISTS idx_restaurants_youtube_metas ON public.restaurants USING GIN(youtube_metas);
CREATE INDEX IF NOT EXISTS idx_restaurants_tzuyang_reviews ON public.restaurants USING GIN(tzuyang_reviews);
CREATE INDEX IF NOT EXISTS idx_restaurants_youtube_meta ON public.restaurants USING GIN(youtube_meta);
CREATE INDEX IF NOT EXISTS idx_restaurants_evaluation_results ON public.restaurants USING GIN(evaluation_results);
CREATE INDEX IF NOT EXISTS idx_restaurants_origin_address ON public.restaurants USING GIN(origin_address);

-- 복합 인덱스 (자주 함께 조회되는 컬럼)
CREATE INDEX IF NOT EXISTS idx_restaurants_category_location ON public.restaurants USING GIN(category) INCLUDE (lat, lng, name);
CREATE INDEX IF NOT EXISTS idx_restaurants_location_review_count ON public.restaurants(lat, lng, review_count DESC);
CREATE INDEX IF NOT EXISTS idx_restaurants_status_created ON public.restaurants(status, created_at DESC);

-- 전문 검색 인덱스 (pg_trgm 사용)
CREATE INDEX IF NOT EXISTS idx_restaurants_name_trgm ON public.restaurants USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_restaurants_road_address_trgm ON public.restaurants USING GIN(road_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_restaurants_jibun_address_trgm ON public.restaurants USING GIN(jibun_address gin_trgm_ops);

COMMENT ON INDEX idx_restaurants_name IS '맛집 이름 검색 최적화';
COMMENT ON INDEX idx_restaurants_lat_lng IS '지도 검색 최적화를 위한 위치 인덱스';
COMMENT ON INDEX idx_restaurants_category IS '카테고리 검색 최적화를 위한 GIN 인덱스';
COMMENT ON INDEX idx_restaurants_status IS '상태별 검색 최적화 (pending, approved, rejected)';
COMMENT ON INDEX idx_restaurants_unique_id IS 'AI 크롤링 고유 ID 검색 최적화';
COMMENT ON INDEX idx_restaurants_approved IS '승인된 맛집 조회 최적화 (일반 사용자용)';
COMMENT ON INDEX idx_restaurants_approved_with_reviews IS '리뷰가 있는 승인된 맛집 조회 최적화';
COMMENT ON INDEX idx_restaurants_pending IS '승인 대기 맛집 조회 최적화 (관리자용)';
COMMENT ON INDEX idx_restaurants_geocoding_false_stage IS '지오코딩 실패 단계별 조회 최적화';
COMMENT ON INDEX idx_restaurants_address_elements IS 'JSONB 주소 요소 검색 최적화';
COMMENT ON INDEX idx_restaurants_name_trgm IS '맛집 이름 유사도 검색 인덱스';
COMMENT ON INDEX idx_restaurants_category_location IS '카테고리+위치 복합 검색 최적화';

-- 3.2 리뷰 테이블 인덱스
-- 기본 인덱스
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id ON public.reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON public.reviews(created_at DESC);

-- 부분 인덱스 (특정 조건의 데이터만)
CREATE INDEX IF NOT EXISTS idx_reviews_verified ON public.reviews(restaurant_id, created_at DESC) WHERE is_verified = true;
CREATE INDEX IF NOT EXISTS idx_reviews_pinned ON public.reviews(restaurant_id, created_at DESC) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_reviews_admin_edited ON public.reviews(edited_by_admin_id, edited_at DESC) WHERE is_edited_by_admin = true;

-- 복합 인덱스 (자주 함께 조회되는 컬럼)
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_created ON public.reviews(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user_created ON public.reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_categories ON public.reviews USING GIN(categories);

COMMENT ON INDEX idx_reviews_created_at IS '최신 리뷰 조회 최적화';
COMMENT ON INDEX idx_reviews_verified IS '인증된 리뷰 조회 최적화';
COMMENT ON INDEX idx_reviews_pinned IS '고정된 리뷰 조회 최적화';
COMMENT ON INDEX idx_reviews_restaurant_created IS '맛집별 최신 리뷰 조회 최적화';
COMMENT ON INDEX idx_reviews_user_created IS '사용자별 최신 리뷰 조회 최적화';

-- 3.3 리뷰 좋아요 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_review_likes_review_id ON public.review_likes(review_id);
CREATE INDEX IF NOT EXISTS idx_review_likes_user_id ON public.review_likes(user_id);

-- 3.4 사용자 통계 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_user_stats_trust_score ON public.user_stats(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_review_count ON public.user_stats(review_count DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_verified_count ON public.user_stats(verified_review_count DESC);

-- 복합 인덱스 (리더보드 정렬 최적화)
CREATE INDEX IF NOT EXISTS idx_user_stats_leaderboard ON public.user_stats(trust_score DESC, verified_review_count DESC, review_count DESC);

COMMENT ON INDEX idx_user_stats_trust_score IS '신뢰도순 리더보드 조회 최적화';
COMMENT ON INDEX idx_user_stats_leaderboard IS '종합 리더보드 조회 최적화';

-- 3.5 알림 테이블 인덱스
-- 기본 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);

-- 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON public.notifications(user_id, type);

-- 부분 인덱스 (읽지 않은 알림만)
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, created_at DESC) WHERE is_read = false;

-- JSONB 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_data ON public.notifications USING GIN(data);

COMMENT ON INDEX idx_notifications_user_created IS '사용자별 최신 알림 조회 최적화';
COMMENT ON INDEX idx_notifications_unread IS '읽지 않은 알림 조회 최적화';

-- 3.6 evaluation_records 테이블 인덱스 섹션 제거됨 (restaurants 테이블과 통합)

-- ========================================
-- PART 3.7: Materialized View (성능 최적화)
-- ========================================

-- 3.7.1 맛집 통계 Materialized View (승인된 맛집만)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_restaurant_stats AS
SELECT 
    r.id,
    r.name,
    r.category,
    r.lat,
    r.lng,
    r.road_address,
    r.status,
    r.review_count,
    COUNT(rv.id) AS actual_review_count,
    COUNT(rv.id) FILTER (WHERE rv.is_verified = true) AS verified_review_count,
    COUNT(DISTINCT rv.user_id) AS unique_reviewers,
    MAX(rv.created_at) AS last_review_at,
    array_agg(DISTINCT unnest(rv.categories)) FILTER (WHERE rv.categories IS NOT NULL) AS all_review_categories
FROM public.restaurants r
LEFT JOIN public.reviews rv ON r.id = rv.restaurant_id
WHERE r.status = 'approved'  -- 승인된 맛집만 포함
GROUP BY r.id, r.name, r.category, r.lat, r.lng, r.road_address, r.status, r.review_count;

-- Materialized View 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_restaurant_stats_id ON public.mv_restaurant_stats(id);
CREATE INDEX IF NOT EXISTS idx_mv_restaurant_stats_review_count ON public.mv_restaurant_stats(actual_review_count DESC);
CREATE INDEX IF NOT EXISTS idx_mv_restaurant_stats_verified ON public.mv_restaurant_stats(verified_review_count DESC);
CREATE INDEX IF NOT EXISTS idx_mv_restaurant_stats_location ON public.mv_restaurant_stats(lat, lng);

COMMENT ON MATERIALIZED VIEW public.mv_restaurant_stats IS '승인된 맛집 통계 Materialized View (status=approved만 포함, 주기적 REFRESH 필요)';

-- 3.7.2 사용자 리더보드 Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_user_leaderboard AS
SELECT 
    p.user_id,
    p.nickname,
    p.profile_picture,
    us.review_count,
    us.verified_review_count,
    us.trust_score,
    COUNT(rl.id) AS total_likes_received,
    RANK() OVER (ORDER BY us.trust_score DESC, us.verified_review_count DESC, us.review_count DESC) AS rank
FROM public.profiles p
INNER JOIN public.user_stats us ON p.user_id = us.user_id
LEFT JOIN public.reviews rv ON p.user_id = rv.user_id
LEFT JOIN public.review_likes rl ON rv.id = rl.review_id
GROUP BY p.user_id, p.nickname, p.profile_picture, us.review_count, us.verified_review_count, us.trust_score;

-- Materialized View 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_leaderboard_user_id ON public.mv_user_leaderboard(user_id);
CREATE INDEX IF NOT EXISTS idx_mv_user_leaderboard_rank ON public.mv_user_leaderboard(rank);
CREATE INDEX IF NOT EXISTS idx_mv_user_leaderboard_trust_score ON public.mv_user_leaderboard(trust_score DESC);

COMMENT ON MATERIALIZED VIEW public.mv_user_leaderboard IS '사용자 리더보드 Materialized View (주기적 REFRESH 필요)';

-- 3.7.3 인기 리뷰 Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_popular_reviews AS
SELECT 
    rv.id,
    rv.restaurant_id,
    rv.user_id,
    rv.title,
    rv.content,
    rv.visited_at,
    rv.verification_photo,
    rv.food_photos,
    rv.is_verified,
    rv.is_pinned,
    rv.created_at,
    COUNT(rl.id) AS like_count,
    p.nickname AS user_nickname,
    p.profile_picture AS user_profile_picture,
    r.name AS restaurant_name,
    r.road_address AS restaurant_address
FROM public.reviews rv
INNER JOIN public.profiles p ON rv.user_id = p.user_id
INNER JOIN public.restaurants r ON rv.restaurant_id = r.id
LEFT JOIN public.review_likes rl ON rv.id = rl.review_id
GROUP BY rv.id, rv.restaurant_id, rv.user_id, rv.title, rv.content, rv.visited_at, 
         rv.verification_photo, rv.food_photos, rv.is_verified, rv.is_pinned, rv.created_at,
         p.nickname, p.profile_picture, r.name, r.road_address;

-- Materialized View 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_popular_reviews_id ON public.mv_popular_reviews(id);
CREATE INDEX IF NOT EXISTS idx_mv_popular_reviews_like_count ON public.mv_popular_reviews(like_count DESC);
CREATE INDEX IF NOT EXISTS idx_mv_popular_reviews_restaurant ON public.mv_popular_reviews(restaurant_id, like_count DESC);
CREATE INDEX IF NOT EXISTS idx_mv_popular_reviews_created_at ON public.mv_popular_reviews(created_at DESC);

COMMENT ON MATERIALIZED VIEW public.mv_popular_reviews IS '인기 리뷰 Materialized View (좋아요 수 포함)';

-- 3.7.4 Materialized View 자동 갱신 함수
CREATE OR REPLACE FUNCTION public.refresh_materialized_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_restaurant_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_user_leaderboard;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_popular_reviews;
END;
$$;

COMMENT ON FUNCTION public.refresh_materialized_views IS 'Materialized View들을 동시에 REFRESH (CONCURRENTLY)';

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
        
        -- 맛집 리뷰 카운트 증가
        UPDATE public.restaurants
        SET review_count = COALESCE(review_count, 0) + 1
        WHERE id = NEW.restaurant_id;

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
        
        -- 맛집 리뷰 카운트 감소
        UPDATE public.restaurants
        SET review_count = GREATEST(COALESCE(review_count, 0) - 1, 0)
        WHERE id = OLD.restaurant_id;

        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_user_stats_on_review IS '리뷰 작성/인증/삭제 시 사용자 통계 및 맛집 리뷰 카운트 자동 업데이트';

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

-- 5.20 데이터베이스 통계 업데이트 함수 (성능 최적화)
CREATE OR REPLACE FUNCTION public.update_table_statistics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 주요 테이블의 통계 정보 업데이트
    ANALYZE public.restaurants;
    ANALYZE public.reviews;
    ANALYZE public.review_likes;
    ANALYZE public.user_stats;
    ANALYZE public.notifications;
END;
$$;

COMMENT ON FUNCTION public.update_table_statistics IS '주요 테이블의 통계 정보 업데이트 (쿼리 플래너 최적화)';

-- 5.21 오래된 알림 삭제 함수 (데이터 정리)
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.notifications
    WHERE created_at < now() - (days_to_keep || ' days')::INTERVAL
    AND is_read = true;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_notifications IS '오래된 읽은 알림 삭제 (기본: 90일)';

-- 5.22 맛집 검색 최적화 함수 (전문 검색)
CREATE OR REPLACE FUNCTION public.search_restaurants(
    search_query TEXT,
    search_category TEXT[] DEFAULT NULL,
    max_results INTEGER DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    category TEXT[],
    road_address TEXT,
    jibun_address TEXT,
    lat NUMERIC,
    lng NUMERIC,
    review_count INTEGER,
    similarity REAL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.category,
        r.road_address,
        r.jibun_address,
        r.lat,
        r.lng,
        r.review_count,
        GREATEST(
            similarity(r.name, search_query),
            similarity(COALESCE(r.road_address, ''), search_query),
            similarity(COALESCE(r.jibun_address, ''), search_query)
        ) AS similarity
    FROM public.restaurants r
    WHERE 
        (search_category IS NULL OR r.category && search_category)
        AND (
            r.name ILIKE '%' || search_query || '%'
            OR r.road_address ILIKE '%' || search_query || '%'
            OR r.jibun_address ILIKE '%' || search_query || '%'
        )
    ORDER BY similarity DESC, r.review_count DESC
    LIMIT max_results;
END;
$$;

COMMENT ON FUNCTION public.search_restaurants IS '맛집 검색 함수 (이름, 주소 유사도 검색)';

-- 5.23 맛집 통계 조회 함수 (상태별)
CREATE OR REPLACE FUNCTION public.get_restaurant_stats_by_status()
RETURNS TABLE (
    total_records BIGINT,
    approved_count BIGINT,
    pending_count BIGINT,
    rejected_count BIGINT,
    geocoding_success_count BIGINT,
    geocoding_failed_count BIGINT,
    missing_count BIGINT,
    not_selected_count BIGINT,
    geocoding_success_rate NUMERIC,
    approval_rate NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_records,
        COUNT(*) FILTER (WHERE status = 'approved')::BIGINT as approved_count,
        COUNT(*) FILTER (WHERE status = 'pending')::BIGINT as pending_count,
        COUNT(*) FILTER (WHERE status = 'rejected')::BIGINT as rejected_count,
        COUNT(*) FILTER (WHERE geocoding_success = true)::BIGINT as geocoding_success_count,
        COUNT(*) FILTER (WHERE geocoding_success = false)::BIGINT as geocoding_failed_count,
        COUNT(*) FILTER (WHERE is_missing = true)::BIGINT as missing_count,
        COUNT(*) FILTER (WHERE is_not_selected = true)::BIGINT as not_selected_count,
        ROUND(
            (COUNT(*) FILTER (WHERE geocoding_success = true)::NUMERIC / 
            NULLIF(COUNT(*), 0)::NUMERIC * 100), 2
        ) as geocoding_success_rate,
        ROUND(
            (COUNT(*) FILTER (WHERE status = 'approved')::NUMERIC / 
            NULLIF(COUNT(*), 0)::NUMERIC * 100), 2
        ) as approval_rate
    FROM public.restaurants;
END;
$$;

COMMENT ON FUNCTION public.get_restaurant_stats_by_status IS '맛집 통계 조회 (상태별: approved, pending, rejected)';

-- 5.24 승인된 맛집 조회 함수
CREATE OR REPLACE FUNCTION public.get_approved_restaurants(
    limit_count INTEGER DEFAULT 100,
    offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    phone TEXT,
    lat NUMERIC,
    lng NUMERIC,
    category TEXT[],
    road_address TEXT,
    jibun_address TEXT,
    english_address TEXT,
    youtube_links TEXT[],
    tzuyang_reviews JSONB,
    review_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id,
        r.name,
        r.phone,
        r.lat,
        r.lng,
        r.category,
        r.road_address,
        r.jibun_address,
        r.english_address,
        r.youtube_links,
        r.tzuyang_reviews,
        r.review_count,
        r.created_at
    FROM public.restaurants r
    WHERE r.status = 'approved'
    ORDER BY r.created_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$;

COMMENT ON FUNCTION public.get_approved_restaurants IS '승인된 맛집만 조회 (일반 사용자용)';

-- 5.25 맛집 승인 처리 함수
CREATE OR REPLACE FUNCTION public.approve_restaurant(
    restaurant_id UUID,
    admin_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin BOOLEAN;
BEGIN
    -- 관리자 권한 확인
    SELECT EXISTS(
        SELECT 1 FROM public.user_roles 
        WHERE user_id = admin_user_id AND role = 'admin'
    ) INTO is_admin;
    
    IF NOT is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;
    
    -- 맛집 승인 처리
    UPDATE public.restaurants
    SET 
        status = 'approved',
        updated_at = now(),
        updated_by_admin_id = admin_user_id
    WHERE id = restaurant_id
    AND status = 'pending';
    
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.approve_restaurant IS '맛집 승인 처리 (관리자 전용)';

-- 5.26 맛집 거부 처리 함수
CREATE OR REPLACE FUNCTION public.reject_restaurant(
    restaurant_id UUID,
    admin_user_id UUID,
    reject_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin BOOLEAN;
BEGIN
    -- 관리자 권한 확인
    SELECT EXISTS(
        SELECT 1 FROM public.user_roles 
        WHERE user_id = admin_user_id AND role = 'admin'
    ) INTO is_admin;
    
    IF NOT is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;
    
    -- 맛집 거부 처리
    UPDATE public.restaurants
    SET 
        status = 'rejected',
        updated_at = now(),
        updated_by_admin_id = admin_user_id,
        admin_notes = COALESCE(reject_reason, admin_notes)
    WHERE id = restaurant_id
    AND status = 'pending';
    
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.reject_restaurant IS '맛집 거부 처리 (관리자 전용)';

-- 5.27 JSONL 데이터 삽입 헬퍼 함수 (AI 크롤링 결과 → DB)
CREATE OR REPLACE FUNCTION public.insert_restaurant_from_jsonl(
    jsonl_data JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_restaurant_id UUID;
    category_array TEXT[];
BEGIN
    -- category를 TEXT[]로 변환 (단일 값인 경우 배열로)
    IF jsonb_typeof(jsonl_data->'category') = 'string' THEN
        category_array := ARRAY[jsonl_data->>'category'];
    ELSE
        category_array := ARRAY(SELECT jsonb_array_elements_text(jsonl_data->'category'));
    END IF;
    
    -- restaurants 테이블에 삽입
    INSERT INTO public.restaurants (
        unique_id,
        name,
        phone,
        category,
        status,
        youtube_meta,
        evaluation_results,
        reasoning_basis,
        tzuyang_reviews,
        origin_address,
        road_address,
        jibun_address,
        english_address,
        address_elements,
        geocoding_success,
        geocoding_false_stage,
        is_missing,
        is_not_selected,
        lat,
        lng
    ) VALUES (
        jsonl_data->>'unique_id',
        jsonl_data->>'name',
        jsonl_data->>'phone',
        category_array,
        COALESCE(jsonl_data->>'status', 'pending'),
        jsonl_data->'youtube_meta',
        jsonl_data->'evaluation_results',
        jsonl_data->>'reasoning_basis',
        jsonb_build_array(jsonb_build_object('review', jsonl_data->>'tzuyang_review')),
        jsonl_data->'origin_address',
        jsonl_data->>'roadAddress',
        jsonl_data->>'jibunAddress',
        jsonl_data->>'englishAddress',
        jsonl_data->'addressElements',
        COALESCE((jsonl_data->>'geocoding_success')::boolean, false),
        (jsonl_data->>'geocoding_false_stage')::integer,
        COALESCE((jsonl_data->>'is_missing')::boolean, false),
        COALESCE((jsonl_data->>'is_notSelected')::boolean, false),  -- camelCase 지원
        (jsonl_data->'origin_address'->>'lat')::numeric,
        (jsonl_data->'origin_address'->>'lng')::numeric
    )
    ON CONFLICT (unique_id) 
    DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        category = EXCLUDED.category,
        youtube_meta = EXCLUDED.youtube_meta,
        evaluation_results = EXCLUDED.evaluation_results,
        reasoning_basis = EXCLUDED.reasoning_basis,
        road_address = EXCLUDED.road_address,
        jibun_address = EXCLUDED.jibun_address,
        english_address = EXCLUDED.english_address,
        address_elements = EXCLUDED.address_elements,
        geocoding_success = EXCLUDED.geocoding_success,
        geocoding_false_stage = EXCLUDED.geocoding_false_stage,
        is_missing = EXCLUDED.is_missing,
        is_not_selected = EXCLUDED.is_not_selected,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = now()
    RETURNING id INTO new_restaurant_id;
    
    -- youtube_links 배열에 추가 (중복 방지)
    UPDATE public.restaurants
    SET youtube_links = array_append(
        COALESCE(youtube_links, ARRAY[]::TEXT[]),
        jsonl_data->>'youtube_link'
    )
    WHERE id = new_restaurant_id
    AND NOT (jsonl_data->>'youtube_link' = ANY(COALESCE(youtube_links, ARRAY[]::TEXT[])));
    
    RETURN new_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.insert_restaurant_from_jsonl IS 'JSONL 크롤링 데이터를 restaurants 테이블에 삽입/업데이트 (unique_id 기준 UPSERT)';

-- 5.28 배치 삽입 함수 (여러 JSONL 레코드 한 번에 처리)
CREATE OR REPLACE FUNCTION public.batch_insert_restaurants_from_jsonl(
    jsonl_array JSONB[]
)
RETURNS TABLE (
    inserted_count INTEGER,
    updated_count INTEGER,
    failed_count INTEGER,
    failed_records JSONB[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    record JSONB;
    inserted INTEGER := 0;
    updated INTEGER := 0;
    failed INTEGER := 0;
    failed_list JSONB[] := ARRAY[]::JSONB[];
    result_id UUID;
BEGIN
    FOREACH record IN ARRAY jsonl_array
    LOOP
        BEGIN
            -- unique_id 존재 여부 확인
            IF EXISTS (SELECT 1 FROM public.restaurants WHERE unique_id = record->>'unique_id') THEN
                result_id := public.insert_restaurant_from_jsonl(record);
                updated := updated + 1;
            ELSE
                result_id := public.insert_restaurant_from_jsonl(record);
                inserted := inserted + 1;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                failed := failed + 1;
                failed_list := array_append(failed_list, jsonb_build_object(
                    'data', record,
                    'error', SQLERRM
                ));
        END;
    END LOOP;
    
    RETURN QUERY SELECT inserted, updated, failed, failed_list;
END;
$$;

COMMENT ON FUNCTION public.batch_insert_restaurants_from_jsonl IS 'JSONL 배열을 한 번에 처리하여 restaurants 테이블에 삽입/업데이트';

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

-- 7.3 맛집 테이블 정책 (승인된 맛집만 조회 가능)
DROP POLICY IF EXISTS "Restaurants are viewable by everyone" ON public.restaurants;
DROP POLICY IF EXISTS "Approved restaurants are viewable by everyone" ON public.restaurants;
CREATE POLICY "Approved restaurants are viewable by everyone"
    ON public.restaurants FOR SELECT
    TO public
    USING (status = 'approved');

DROP POLICY IF EXISTS "Admins can view all restaurants" ON public.restaurants;
CREATE POLICY "Admins can view all restaurants"
    ON public.restaurants FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

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

-- 7.10 evaluation_records 테이블 정책 제거됨 (restaurants 테이블과 통합)

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
-- PART 11: 성능 최적화 설정
-- ========================================

-- 11.1 pg_trgm 확장 설치 (유사도 검색용)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gin;

COMMENT ON EXTENSION pg_trgm IS '텍스트 유사도 검색을 위한 PostgreSQL 확장';
COMMENT ON EXTENSION "uuid-ossp" IS 'UUID 생성 함수 제공';
COMMENT ON EXTENSION btree_gin IS 'GIN 인덱스에서 B-tree 연산자 지원';

-- 11.2 맛집 이름/주소 유사도 검색 인덱스는 이미 PART 3.1에서 생성됨

-- 11.3 테이블 통계 정보 업데이트
ANALYZE public.restaurants;
ANALYZE public.reviews;
ANALYZE public.review_likes;
ANALYZE public.user_stats;
ANALYZE public.profiles;
ANALYZE public.notifications;

-- ========================================
-- PART 12: 유지보수 스케줄링 안내
-- ========================================

/*
=== 주기적 유지보수 작업 안내 ===

1. Materialized View 갱신 (매일 1회 권장):
   SELECT public.refresh_materialized_views();

2. 테이블 통계 업데이트 (매주 1회 권장):
   SELECT public.update_table_statistics();

3. 오래된 알림 정리 (매월 1회 권장):
   SELECT public.cleanup_old_notifications(90); -- 90일 이상 된 읽은 알림 삭제

4. VACUUM 작업 (매월 1회 권장):
   VACUUM ANALYZE public.restaurants;
   VACUUM ANALYZE public.reviews;
   VACUUM ANALYZE public.review_likes;
   VACUUM ANALYZE public.notifications;

5. 인덱스 재구성 (분기별 1회 권장):
   REINDEX TABLE CONCURRENTLY public.restaurants;
   REINDEX TABLE CONCURRENTLY public.reviews;

=== Supabase 대시보드에서 설정 가능 ===
- Database > Cron Jobs 메뉴에서 pg_cron을 사용하여 자동 스케줄링 설정 가능
*/

-- ========================================
-- PART 13: 성능 모니터링 뷰
-- ========================================

-- 13.1 테이블 크기 모니터링 뷰
CREATE OR REPLACE VIEW public.v_table_sizes AS
SELECT
    schemaname AS schema_name,
    tablename AS table_name,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

COMMENT ON VIEW public.v_table_sizes IS '테이블 및 인덱스 크기 모니터링 뷰';

-- 13.2 인덱스 사용 통계 뷰
CREATE OR REPLACE VIEW public.v_index_usage AS
SELECT
    schemaname AS schema_name,
    tablename AS table_name,
    indexname AS index_name,
    idx_scan AS index_scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

COMMENT ON VIEW public.v_index_usage IS '인덱스 사용 통계 뷰 (사용되지 않는 인덱스 확인)';

-- 13.3 느린 쿼리 모니터링을 위한 안내
/*
=== 느린 쿼리 모니터링 설정 ===

Supabase 대시보드 > Database > Query Performance에서 확인 가능

또는 직접 설정:
ALTER DATABASE postgres SET log_min_duration_statement = '1000'; -- 1초 이상 쿼리 로깅

주요 확인 사항:
1. Sequential Scan이 많은 쿼리 → 인덱스 추가 고려
2. 높은 실행 시간 → 쿼리 최적화 또는 Materialized View 사용
3. 높은 Buffer 사용량 → 메모리 설정 조정
*/

-- ========================================
-- PART 14: 데이터 백업 및 복구 안내
-- ========================================

/*
=== 백업 전략 ===

1. Supabase 자동 백업:
   - 모든 프로젝트는 자동으로 일일 백업됨
   - Settings > Database > Backups에서 확인

2. 중요 테이블 수동 백업 (필요시):
   -- CSV 내보내기
   COPY public.restaurants TO '/tmp/restaurants_backup.csv' WITH CSV HEADER;
   COPY public.reviews TO '/tmp/reviews_backup.csv' WITH CSV HEADER;

3. Point-in-Time Recovery (PITR):
   - Pro 플랜 이상에서 사용 가능
   - 지난 7일 내 특정 시점으로 복구 가능

=== 복구 절차 ===

1. Supabase 대시보드 > Settings > Database > Backups
2. 복구하려는 백업 선택
3. "Restore" 버튼 클릭

주의: 전체 데이터베이스가 복구되므로 최근 데이터가 손실될 수 있음
*/

-- ========================================
-- 마이그레이션 완료
-- ========================================

-- 모든 테이블, 함수, 트리거, RLS 정책이 성공적으로 생성되었습니다.
-- 이 파일은 Supabase SQL Editor에서 한 번에 실행 가능합니다.

/*
=== 최적화 요약 ===

✅ 데이터 무결성 강화:
   - CHECK 제약조건 추가 (lat/lng 범위, trust_score 범위, 문자열 길이, 이메일 형식, 전화번호 형식 등)
   - 외래 키 ON DELETE 동작 명확화 (CASCADE, SET NULL)
   - NOT NULL 제약조건 추가
   - 중복 컬럼 제거
   - 복합 제약조건 추가 (데이터 일관성 검증)

✅ 인덱스 최적화 (총 50+ 인덱스):
   - 복합 인덱스: 자주 함께 조회되는 컬럼
   - 부분 인덱스: 특정 조건만 (is_verified, is_pinned, is_read, geocoding_success 등)
   - GIN 인덱스: 배열 및 JSONB 검색
   - pg_trgm 인덱스: 유사도 검색
   - INCLUDE 인덱스: covering index 최적화

✅ 성능 최적화:
   - 3개의 Materialized View (맛집 통계, 리더보드, 인기 리뷰)
   - 26개의 최적화 함수 (승인/거부 함수 포함)
   - 자동 갱신 및 유지보수 함수
   - 유사도 검색 함수
   - 통계 정보 업데이트 함수

✅ restaurants 테이블 통합 (restaurants + evaluation_records):
   - 명확한 컬럼 구조 (name, phone, category 등)
   - JSONB 필드 최적화 (youtube_meta, evaluation_results, origin_address, address_elements)
   - 지오코딩 상태 추적 (geocoding_success, geocoding_false_stage)
   - 상태 관리 (status: pending, approved, rejected)
   - 상태 플래그 (is_missing, is_not_selected)
   - 부분 인덱스 및 복합 인덱스로 성능 최적화
   - 승인된 맛집만 일반 사용자에게 조회 가능 (RLS 정책)

✅ 테이블/컬럼명 일관성:
   - 스네이크 케이스(snake_case) 사용
   - 명확하고 직관적인 네이밍
   - 약어 최소화
   - 일관된 접두사/접미사 사용

✅ 유지보수 편의성:
   - 2개의 모니터링 뷰
   - 데이터 정리 함수
   - 상세한 한글 주석 (모든 테이블, 컬럼, 함수, 인덱스)
   - 유지보수 가이드 포함

=== 다음 단계 권장사항 ===

1. 이 마이그레이션 실행 후 Materialized View를 첫 갱신:
   SELECT public.refresh_materialized_views();

2. 맛집 통계 확인 (상태별):
   SELECT * FROM public.get_restaurant_stats_by_status();

3. 승인된 맛집 조회:
   SELECT * FROM public.get_approved_restaurants(100, 0);

4. Supabase 대시보드에서 pg_cron 설정:
   - 매일 새벽 2시: Materialized View 갱신
   - 매주 일요일: 통계 정보 업데이트
   - 매월 1일: 오래된 알림 정리

5. 성능 모니터링:
   - SELECT * FROM public.v_table_sizes;
   - SELECT * FROM public.v_index_usage;

6. 보안 설정:
   - Authentication > Settings에서 "Enable password leak detection" 활성화
   - RLS 정책이 모든 테이블에 올바르게 적용되었는지 확인
   - 일반 사용자는 status='approved'인 맛집만 조회 가능
   - 관리자는 모든 상태의 맛집 조회/수정 가능

7. 데이터 검증:
   - 전화번호 형식: 02-1234-5678 또는 010-1234-5678
   - 이메일 형식: example@domain.com
   - 닉네임 길이: 2-20자
   - 맛집 이름 길이: 2-100자
   - 카테고리 개수: 1-5개

=== JSONL 크롤링 데이터 삽입 예시 ===

-- 단일 레코드 삽입
SELECT insert_restaurant_from_jsonl('{
  "youtube_link": "https://www.youtube.com/watch?v=oRWZAJN4ZFQ",
  "status": "pending",
  "youtube_meta": {
    "title": "할머니가 끓여주시는 울트라라면?!🔥",
    "publishedAt": "2025-09-02T12:30:02Z",
    "is_shorts": false,
    "duration": 941
  },
  "name": "대성식품",
  "phone": "063-284-1486",
  "category": "분식",
  "reasoning_basis": "영상은 전주시에 위치한 대성식품 한 곳을 다루고 있습니다...",
  "tzuyang_review": "쯔양은 이곳의 음식들이 할머니가 해준 것 같은 깊은 손맛...",
  "origin_address": {
    "address": "전북 전주시 완산구 팔달로 157-5",
    "lat": 35.8162906,
    "lng": 127.1471678
  },
  "roadAddress": "전북특별자치도 전주시 완산구 팔달로 157-5",
  "jibunAddress": "전북특별자치도 전주시 완산구 경원동1가 104-26",
  "englishAddress": "157-5, Paldal-ro, Wansan-gu, Jeonju-si",
  "addressElements": [...],
  "geocoding_success": true,
  "geocoding_false_stage": null,
  "is_missing": false,
  "is_notSelected": false,
  "evaluation_results": {...},
  "unique_id": "4ed18d7db97160cecaf8ec7d848d2393a5268dba8029a193dd9309801ca522da"
}'::jsonb);

-- 배치 삽입
SELECT * FROM batch_insert_restaurants_from_jsonl(
  ARRAY[
    '{"youtube_link": "...", "name": "대성식품", ...}'::jsonb,
    '{"youtube_link": "...", "name": "전통춘천닭갈비", ...}'::jsonb
  ]
);

-- Python에서 사용 예시:
/*
import json
from supabase import create_client

# JSONL 파일 읽기
with open('restaurants.jsonl', 'r', encoding='utf-8') as f:
    records = [json.loads(line) for line in f]

# 배치 삽입
result = supabase.rpc('batch_insert_restaurants_from_jsonl', {
    'jsonl_array': records
}).execute()

print(f"삽입: {result.data[0]['inserted_count']}")
print(f"업데이트: {result.data[0]['updated_count']}")
print(f"실패: {result.data[0]['failed_count']}")
*/

즐거운 개발 되세요! 🚀
*/
