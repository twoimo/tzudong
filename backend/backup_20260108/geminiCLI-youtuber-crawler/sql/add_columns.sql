-- Add missing columns to restaurant_youtuber table
-- Run this in your Supabase SQL Editor

ALTER TABLE restaurant_youtuber 
ADD COLUMN IF NOT EXISTS geocoding_source TEXT,
ADD COLUMN IF NOT EXISTS reasoning_basis TEXT,
ADD COLUMN IF NOT EXISTS map_type TEXT,
ADD COLUMN IF NOT EXISTS map_url TEXT,
ADD COLUMN IF NOT EXISTS business_hours TEXT,
ADD COLUMN IF NOT EXISTS closed_days TEXT,
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS parking TEXT,
ADD COLUMN IF NOT EXISTS signature_menu TEXT[],
ADD COLUMN IF NOT EXISTS price_range TEXT,
ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'medium';

-- Add comments for documentation
COMMENT ON COLUMN restaurant_youtuber.geocoding_source IS 'Source of the geocoding (e.g., kakao, naver, google)';
COMMENT ON COLUMN restaurant_youtuber.reasoning_basis IS 'Logic used to verify the location';
COMMENT ON COLUMN restaurant_youtuber.map_type IS 'Type of the map URL (e.g., naver, google, kakao)';
COMMENT ON COLUMN restaurant_youtuber.map_url IS 'Original map URL from the video';
