-- Function to increment search count for a restaurant
CREATE OR REPLACE FUNCTION increment_search_count(restaurant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE restaurants
  SET search_count = COALESCE(search_count, 0) + 1
  WHERE id = restaurant_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_search_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_search_count(UUID) TO anon;
