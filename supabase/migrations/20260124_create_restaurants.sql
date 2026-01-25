-- Create restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approved_name TEXT,
    phone TEXT,
    categories TEXT[],
    lat NUMERIC,
    lng NUMERIC,
    road_address TEXT,
    jibun_address TEXT,
    english_address TEXT,
    address_elements JSONB DEFAULT '{}',
    origin_address JSONB,
    youtube_meta JSONB,
    trace_id TEXT UNIQUE,
    reasoning_basis TEXT,
    evaluation_results JSONB,
    source_type TEXT,
    geocoding_success BOOLEAN DEFAULT FALSE,
    geocoding_false_stage INTEGER,
    status TEXT DEFAULT 'pending',
    is_missing BOOLEAN DEFAULT FALSE,
    is_not_selected BOOLEAN DEFAULT FALSE,
    review_count INTEGER DEFAULT 0,
    created_by UUID,
    updated_by_admin_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    db_error_message TEXT,
    db_error_details JSONB,
    tzuyang_review TEXT,
    youtube_link TEXT,
    search_count INTEGER DEFAULT 0,
    weekly_search_count INTEGER DEFAULT 0,
    origin_name TEXT,
    naver_name TEXT,
    trace_id_name_source TEXT,
    channel_name TEXT,
    description_map_url TEXT,
    recollect_version JSONB
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_restaurants_created_at ON restaurants(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurants_name ON restaurants(approved_name);
CREATE INDEX IF NOT EXISTS idx_restaurants_review_count ON restaurants(review_count DESC);
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants(status);
CREATE INDEX IF NOT EXISTS idx_restaurants_unique_id ON restaurants(trace_id);
