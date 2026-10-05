-- Index helpers used by restaurants writes. Not public RPCs.
-- After PUBLIC default EXECUTE revoke, table writers still need EXECUTE
-- or hosted Step 13 fails with 42501 on extract_youtube_video_id.

REVOKE ALL ON FUNCTION public.extract_youtube_video_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_restaurant_identity_name(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_restaurant_identity_name(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.extract_youtube_video_id(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_restaurant_identity_name(text, text, text, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_restaurant_identity_name(text) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
