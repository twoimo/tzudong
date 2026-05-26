-- Retire admin-managed AI/OCR settings storage.
-- OCR runtime now resolves provider keys and models from environment variables only.

drop table if exists public.admin_ai_leaderboard_snapshots;
drop table if exists public.admin_ai_provider_keys;
drop table if exists public.admin_ai_settings;
drop function if exists public.set_admin_ai_updated_at();
;
