-- Function to increment review count
CREATE OR REPLACE FUNCTION increment_review_count(restaurant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE restaurants
  SET review_count = COALESCE(review_count, 0) + 1
  WHERE id = restaurant_id;
END;
$$;

-- Function to decrement review count
CREATE OR REPLACE FUNCTION decrement_review_count(restaurant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE restaurants
  SET review_count = GREATEST(COALESCE(review_count, 0) - 1, 0)
  WHERE id = restaurant_id;
END;
$$;

-- Function to update user stats after review submission
CREATE OR REPLACE FUNCTION update_user_stats_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE user_stats
    SET 
      review_count = COALESCE(review_count, 0) + 1,
      last_updated = now()
    WHERE user_id = NEW.user_id;
    
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_verified = true AND OLD.is_verified = false THEN
    UPDATE user_stats
    SET 
      verified_review_count = COALESCE(verified_review_count, 0) + 1,
      trust_score = LEAST(COALESCE(trust_score, 0) + 5, 100),
      last_updated = now()
    WHERE user_id = NEW.user_id;
    
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE user_stats
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

-- Create trigger for user stats
DROP TRIGGER IF EXISTS trigger_update_user_stats ON reviews;
CREATE TRIGGER trigger_update_user_stats
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_user_stats_on_review();

-- Create storage bucket for review photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-photos', 'review-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for review photos
CREATE POLICY "Anyone can view review photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'review-photos');

CREATE POLICY "Authenticated users can upload review photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'review-photos');

CREATE POLICY "Users can update own review photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own review photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

