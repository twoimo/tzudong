-- restaurant_youtuber 테이블 생성 (테이블이 없는 경우)
-- 실행: Supabase Dashboard > SQL Editor

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS public.restaurant_youtuber (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unique_id text NOT NULL,
    name text NOT NULL,
    categories text[],
    phone text,
    origin_address text,
    road_address text,
    jibun_address text,
    lat double precision,
    lng double precision,
    geocoding_success boolean DEFAULT false,
    geocoding_false_stage integer,
    youtuber_name text,
    youtuber_channel text,
    youtube_link text,
    youtube_meta jsonb,
    youtuber_review text,
    reasoning_basis text,
    confidence text DEFAULT 'medium'::text,
    status text DEFAULT 'pending'::text,
    source_type text DEFAULT 'youtuber_crawl'::text,
    is_missing boolean DEFAULT false,
    is_not_selected boolean DEFAULT false,
    map_url text,
    map_type text,
    address_source text DEFAULT 'inferred'::text,
    address_elements jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    business_hours text,
    closed_days text,
    is_closed boolean DEFAULT false,
    parking text,
    signature_menu text[],
    price_range text,
    geocoding_source text,
    evaluation_results jsonb DEFAULT '{}'::jsonb,
    
    PRIMARY KEY (id),
    UNIQUE (unique_id)
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_restaurant_youtuber_unique_id 
    ON public.restaurant_youtuber (unique_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_youtuber_youtube_link 
    ON public.restaurant_youtuber (youtube_link);
CREATE INDEX IF NOT EXISTS idx_restaurant_youtuber_name 
    ON public.restaurant_youtuber (name);
CREATE INDEX IF NOT EXISTS idx_restaurant_youtuber_eval 
    ON public.restaurant_youtuber USING gin(evaluation_results);

-- 3. 컬럼 코멘트
COMMENT ON TABLE public.restaurant_youtuber IS '유튜버 크롤링 맛집 데이터';
COMMENT ON COLUMN public.restaurant_youtuber.evaluation_results IS 
    'RULE 기반 평가 결과 (category_validity_TF, location_match_TF)';
COMMENT ON COLUMN public.restaurant_youtuber.reasoning_basis IS 
    'Logic used to verify the location';
COMMENT ON COLUMN public.restaurant_youtuber.map_url IS 
    'Original map URL from the video';
COMMENT ON COLUMN public.restaurant_youtuber.geocoding_source IS 
    'Source of the geocoding (e.g., kakao, naver, google)';

-- 4. RLS 활성화 (권장)
ALTER TABLE public.restaurant_youtuber ENABLE ROW LEVEL SECURITY;

-- 5. 서비스 역할에게 모든 권한 부여
GRANT ALL ON public.restaurant_youtuber TO service_role;
GRANT SELECT ON public.restaurant_youtuber TO anon, authenticated;

-- 6. 확인 쿼리
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'restaurant_youtuber' 
ORDER BY ordinal_position;
