-- 유튜버 맛집 테이블 생성
-- 정육왕, 먹방 유튜버 등의 맛집 데이터를 저장

-- youtuber_restaurant 테이블 생성
CREATE TABLE IF NOT EXISTS public.youtuber_restaurant (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    unique_id TEXT NOT NULL UNIQUE,
    
    -- 기본 정보
    name TEXT NOT NULL,
    phone TEXT,
    categories TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    source_type TEXT DEFAULT 'youtuber_crawl',
    
    -- 유튜버 정보
    youtuber_name TEXT NOT NULL,
    youtuber_channel TEXT,
    
    -- 유튜브 정보
    youtube_link TEXT,
    youtube_meta JSONB DEFAULT '{}',
    
    -- 평가 정보
    reasoning_basis TEXT,
    tzuyang_review TEXT, -- 유튜버 리뷰/평가
    
    -- 주소 정보
    origin_address TEXT,
    road_address TEXT,
    jibun_address TEXT,
    english_address TEXT,
    address_elements JSONB DEFAULT '{}',
    
    -- 지오코딩 정보
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    geocoding_success BOOLEAN DEFAULT false,
    geocoding_false_stage INTEGER,
    
    -- 상태 플래그
    is_missing BOOLEAN DEFAULT false,
    is_not_selected BOOLEAN DEFAULT false,
    
    -- 추가 메타데이터
    map_url TEXT,
    map_type TEXT,
    confidence TEXT DEFAULT 'medium',
    address_source TEXT,
    
    -- 통계
    view_count INTEGER DEFAULT 0,
    
    -- 타임스탬프
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_youtuber_restaurant_youtuber_name ON public.youtuber_restaurant(youtuber_name);
CREATE INDEX IF NOT EXISTS idx_youtuber_restaurant_youtube_link ON public.youtuber_restaurant(youtube_link);
CREATE INDEX IF NOT EXISTS idx_youtuber_restaurant_lat_lng ON public.youtuber_restaurant(lat, lng);
CREATE INDEX IF NOT EXISTS idx_youtuber_restaurant_status ON public.youtuber_restaurant(status);
CREATE INDEX IF NOT EXISTS idx_youtuber_restaurant_name ON public.youtuber_restaurant(name);

-- RLS 활성화
ALTER TABLE public.youtuber_restaurant ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 모든 사용자가 읽기 가능
CREATE POLICY "youtuber_restaurant_select_policy" ON public.youtuber_restaurant
    FOR SELECT USING (true);

-- RLS 정책: 서비스 역할만 삽입/수정/삭제 가능
CREATE POLICY "youtuber_restaurant_insert_policy" ON public.youtuber_restaurant
    FOR INSERT WITH CHECK (
        (SELECT auth.role()) = 'service_role'
    );

CREATE POLICY "youtuber_restaurant_update_policy" ON public.youtuber_restaurant
    FOR UPDATE USING (
        (SELECT auth.role()) = 'service_role'
    );

CREATE POLICY "youtuber_restaurant_delete_policy" ON public.youtuber_restaurant
    FOR DELETE USING (
        (SELECT auth.role()) = 'service_role'
    );

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION public.update_youtuber_restaurant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_youtuber_restaurant_updated_at_trigger
    BEFORE UPDATE ON public.youtuber_restaurant
    FOR EACH ROW
    EXECUTE FUNCTION public.update_youtuber_restaurant_updated_at();

-- 코멘트
COMMENT ON TABLE public.youtuber_restaurant IS '유튜버 맛집 데이터 (정육왕, 먹방 유튜버 등)';
COMMENT ON COLUMN public.youtuber_restaurant.youtuber_name IS '유튜버 이름 (정육왕, 쯔양 등)';
COMMENT ON COLUMN public.youtuber_restaurant.youtuber_channel IS '유튜버 채널 핸들 (@meatcreator 등)';
COMMENT ON COLUMN public.youtuber_restaurant.confidence IS '데이터 신뢰도 (high, medium, low)';
COMMENT ON COLUMN public.youtuber_restaurant.address_source IS '주소 출처 (description, transcript, inferred)';
