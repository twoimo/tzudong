-- Add missing columns to restaurants table
ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS jjyang_visit_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS updated_by_admin_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS description TEXT;

-- Migrate data from tzuyang_review to description (if needed)
UPDATE public.restaurants
SET description = tzuyang_review
WHERE description IS NULL AND tzuyang_review IS NOT NULL;

-- Add missing columns to reviews table
ALTER TABLE public.reviews
ADD COLUMN IF NOT EXISTS is_edited_by_admin BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS edited_by_admin_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;

-- Migrate data from edited_by_admin to is_edited_by_admin
UPDATE public.reviews
SET is_edited_by_admin = edited_by_admin
WHERE is_edited_by_admin IS NULL;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_restaurants_jjyang_visit_count ON public.restaurants(jjyang_visit_count);
CREATE INDEX IF NOT EXISTS idx_reviews_is_edited_by_admin ON public.reviews(is_edited_by_admin);

-- Add trigger to set edited_at when is_edited_by_admin changes
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

DROP TRIGGER IF EXISTS trigger_set_review_edited_at ON reviews;
CREATE TRIGGER trigger_set_review_edited_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_review_edited_at();

