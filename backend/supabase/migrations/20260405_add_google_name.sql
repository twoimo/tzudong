-- Migration: Add google_name to restaurants
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS google_name TEXT;