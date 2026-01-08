-- Add search_count column to restaurants table
ALTER TABLE restaurants 
ADD COLUMN IF NOT EXISTS search_count INTEGER DEFAULT 0;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_restaurants_search_count 
ON restaurants(search_count DESC);

-- Update existing records to have search_count = 0
UPDATE restaurants 
SET search_count = 0 
WHERE search_count IS NULL;
